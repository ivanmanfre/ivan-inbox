import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'

const migration = readFileSync('db/219_inbox_notification_lifecycle.sql', 'utf8')
const rollback = readFileSync('db/219_inbox_notification_lifecycle.rollback.sql', 'utf8')
const schema = `
create role anon; create role authenticated; create role service_role;
create table public.inbox_notifications (
 id uuid primary key default gen_random_uuid(), family text not null, source text,
 dedupe_key text, severity text not null default 'info', title text not null,
 body text, url text, media jsonb, group_key text, tenant text,
 count int not null default 1, first_seen_at timestamptz not null default now(),
 last_seen_at timestamptz not null default now(), created_at timestamptz not null default now(),
 read_at timestamptz, dismissed_at timestamptz, pushed_at timestamptz, push_result jsonb
);
create view public.inbox_notifications_v with (security_invoker = on) as
 select id, family, source, dedupe_key, severity, title, body, url, media, group_key,
 tenant, count, first_seen_at, last_seen_at, created_at, read_at, dismissed_at, pushed_at
 from public.inbox_notifications;
`

async function setup() { const db = new PGlite(); await db.exec(schema); return db }
const alert = (key: string, extras: Record<string, unknown> = {}) => JSON.stringify({
  family: 'system_infra_alarm', source: 'wa-relay:workflow', tenant: 'rise',
  incident_key: key, severity: 'attention', title: 'Failed', body: 'step A', ...extras,
})
const claim = (db: PGlite, input: string) => db.query<{ id: string; created: boolean; expires_at: string }>(
  'select * from public.claim_inbox_workflow_notification($1::jsonb)', [input])

describe('inbox notification lifecycle migration', () => {
  it('backfills only operational rows from creation, retains rows and does not alter task state', async () => {
    const db = await setup()
    await db.exec(`insert into inbox_notifications(family,title,created_at) values
      ('system_infra_alarm','old',now()-interval '7 hours'),
      ('claude_turn','answer',now()-interval '7 hours'),
      ('booking_notice','booking',now()-interval '7 hours')`)
    await db.exec(migration)
    const rows = await db.query<{ family: string; expired: boolean; expires_at: string | null }>(
      `select family, expires_at <= now() as expired, expires_at from inbox_notifications order by family`)
    expect(rows.rows.find(r => r.family === 'system_infra_alarm')?.expired).toBe(true)
    expect(rows.rows.filter(r => r.family !== 'system_infra_alarm').every(r => r.expires_at === null)).toBe(true)
    expect(rows.rows).toHaveLength(3)
    await db.close()
  })

  it('claims one row for concurrent/repeated delivery, including after dismiss and expiry', async () => {
    const db = await setup(); await db.exec(migration)
    const key = 'rise:workflow:step:failed:attention'
    const results = await Promise.all([claim(db, alert(key)), claim(db, alert(key))])
    expect(results.flatMap(r => r.rows).filter(r => r.created)).toHaveLength(1)
    const id = results[0].rows[0].id
    await db.query('update inbox_notifications set dismissed_at=now(), expires_at=now()-interval \'1 second\' where id=$1', [id])
    const repeat = (await claim(db, alert(key))).rows[0]
    expect(repeat).toMatchObject({ id, created: false })
    const row = (await db.query<{ count: number; dismissed_at: string; expires_at: string }>('select count,dismissed_at,expires_at from inbox_notifications where id=$1', [id])).rows[0]
    expect(row.count).toBe(3)
    expect(row.dismissed_at).toBeTruthy()
    expect(Date.parse(row.expires_at)).toBeLessThan(Date.now())
    await db.close()
  })

  it('keeps a 24-hour quiet-gap episode and distinct same-workflow conditions separate', async () => {
    const db = await setup(); await db.exec(migration)
    const a = (await claim(db, alert('rise:w:step-a:failed:attention'))).rows[0]
    const b = (await claim(db, alert('rise:w:step-b:failed:attention'))).rows[0]
    const c = (await claim(db, alert('rise:w:step-a:failed:error', { severity: 'error' }))).rows[0]
    expect(new Set([a.id, b.id, c.id]).size).toBe(3)
    await db.query(`update inbox_notifications set last_seen_at=now()-interval '25 hours' where id=$1`, [a.id])
    const episode = (await claim(db, alert('rise:w:step-a:failed:attention'))).rows[0]
    expect(episode.created).toBe(true)
    expect(episode.id).not.toBe(a.id)
    await db.close()
  })

  it('denies authenticated execution and keeps suppression rows through rollback', async () => {
    const db = await setup(); await db.exec(migration)
    const first = (await claim(db, alert('rise:w:step:failed:error'))).rows[0]
    const grant = await db.query<{ authed: boolean; anonymous: boolean; service: boolean }>(
      `select has_function_privilege('authenticated', 'public.claim_inbox_workflow_notification(jsonb)', 'EXECUTE') as authed,
              has_function_privilege('anon', 'public.claim_inbox_workflow_notification(jsonb)', 'EXECUTE') as anonymous,
              has_function_privilege('service_role', 'public.claim_inbox_workflow_notification(jsonb)', 'EXECUTE') as service`)
    expect(grant.rows[0]).toEqual({ authed: false, anonymous: false, service: true })
    await db.exec(rollback)
    const repeat = (await claim(db, alert('rise:w:step:failed:error'))).rows[0]
    expect(repeat).toMatchObject({ id: first.id, created: false })
    await db.close()
  })

  it('permits only one transition alert from a coarse legacy row, then suppresses repeats', async () => {
    const db = await setup()
    await db.exec(`insert into inbox_notifications(family,source,dedupe_key,title,body,created_at,last_seen_at)
      values ('system_infra_alarm','wa-relay:workflow','workflow:daily','Old failure','Step A failed',
        now()-interval '1 hour',now()-interval '1 hour')`)
    await db.exec(migration)
    const key = 'rise:workflow:step-a:failed:attention'
    const first = (await claim(db, alert(key))).rows[0]
    const repeat = (await claim(db, alert(key))).rows[0]
    expect(first.created).toBe(true)
    expect(repeat).toMatchObject({ id: first.id, created: false })
    const rows = await db.query<{ incident_key: string | null }>('select incident_key from inbox_notifications')
    expect(rows.rows).toHaveLength(2)
    expect(rows.rows.filter(r => r.incident_key === null)).toHaveLength(1)
    await db.close()
  })
})
