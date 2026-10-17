import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterEach, beforeEach, expect, it } from 'vitest'
let db: PGlite
const pid = '640aa615-3561-4f1e-8b27-a2180a8b161c', key = '101aa615-3561-4f1e-8b27-a2180a8b161c'
beforeEach(async () => {
  db = new PGlite()
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table outreach_campaigns(id uuid primary key,client_id text);
    create table outreach_prospects(id uuid primary key,campaign_id uuid,name text,email text,company text,call_booked_at timestamptz,stage text,blacklisted boolean,skip_reason text);
    create table ops_drafts(id uuid default gen_random_uuid(),client_id text,kind text,slack_channel text,body text,context jsonb,approved_at timestamptz,sent_at timestamptz);
    create unique index ops_drafts_booking_meeting_idx on ops_drafts(client_id,(context->>'meeting_id')) where kind='booking';
    insert into outreach_campaigns values('11111111-1111-4111-8111-111111111111','risedtc');
    insert into outreach_prospects(id,campaign_id,name,email,company,stage,blacklisted) values('${pid}','11111111-1111-4111-8111-111111111111','Ada Lovelace','ada@example.com','Company','replied',false);`)
  await db.exec(readFileSync('db/20261017_inbox_calendar.sql','utf8'))
})
afterEach(async () => { await db.close() })
const claim = (request = key, client = 'risedtc') => db.query<{ inbox_calendar_claim: boolean }>(`select inbox_calendar_claim($1,$2,$3,now()+interval '3 days','ada@example.com','UTC')`, [pid, client, request])
const finish = () => db.query(`select inbox_calendar_finish($1,'123','2026-10-17T00:09:50.192Z')`, [key])
it('allows one claim across repeated keys and blocks a different key for the same prospect', async () => {
  expect((await claim()).rows[0].inbox_calendar_claim).toBe(true)
  expect((await claim()).rows[0].inbox_calendar_claim).toBe(false)
  expect((await claim('201aa615-3561-4f1e-8b27-a2180a8b161c')).rows[0].inbox_calendar_claim).toBe(false)
})
it('does not cross tenancy or reopen existing bookings', async () => {
  expect((await claim(key,'arch')).rows[0].inbox_calendar_claim).toBe(false)
  await db.exec('update outreach_prospects set call_booked_at=now()')
  expect((await claim()).rows[0].inbox_calendar_claim).toBe(false)
})
it('uncertain claims block retries and unconfirmed receipts cannot finish', async () => {
  await claim(); await db.exec("update inbox_calendar_bookings set status='uncertain'")
  expect((await claim('201aa615-3561-4f1e-8b27-a2180a8b161c')).rows[0].inbox_calendar_claim).toBe(false)
  await expect(finish()).rejects.toThrow(/confirmed/)
})
it('uses real meeting creation time once and leaves one unapproved Ops handoff', async () => {
  await claim(); await db.exec("update inbox_calendar_bookings set status='confirmed',calendar_event_id='event-1'")
  await finish(); await finish()
  const p = (await db.query<{ call_booked_at: Date }>('select call_booked_at from outreach_prospects')).rows[0]
  expect(new Date(p.call_booked_at).toISOString()).toBe('2026-10-17T00:09:50.192Z')
  const ops = (await db.query('select * from ops_drafts')).rows
  expect(ops).toHaveLength(1); expect(ops[0]).toMatchObject({ client_id: 'rise', kind: 'booking', slack_channel: 'C0BJ72F58BY', approved_at: null, sent_at: null, context: { meeting_id: '123', prospect_id: pid } })
})
it('preserves an existing published stamp and never exposes the private ledger to ordinary sessions', async () => {
  await claim(); await db.exec("update inbox_calendar_bookings set status='confirmed',calendar_event_id='event-1'; update outreach_prospects set call_booked_at='2026-09-01T12:00Z'")
  await finish(); expect((await db.query<{ call_booked_at: Date }>('select call_booked_at from outreach_prospects')).rows[0].call_booked_at.toISOString()).toBe('2026-09-01T12:00:00.000Z')
  await db.exec('set role authenticated'); await expect(db.query('select * from inbox_calendar_bookings')).rejects.toThrow(/permission denied/)
  await expect(claim()).rejects.toThrow(/permission denied/)
})
