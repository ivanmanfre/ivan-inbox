import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'

// db/20261107_arch_fill_next_week against a stand-in schema. operator_set_schedule_date and operator_set_board_visible
// are stand-ins with the live refusals that matter here (gate, status, past date); net.http_post is a no-op.
// Expected overlap ratios come from Python: difflib.SequenceMatcher(None, w(a), w(b), autojunk=False).ratio() with
// w = re.findall(r"[\w'€$%,.]+", s.lower()) (the check every ARCH rework was measured with, 28 Oct and 1 Nov).
const migration = readFileSync('db/20261107_arch_fill_next_week.sql', 'utf8')
const rollback = readFileSync('db/20261107_arch_fill_next_week_rollback.sql', 'utf8')

const schema = `
create role anon; create role authenticated; create role service_role;
create schema extensions; create schema auth; create schema net;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create function extensions.digest(t text, alg text) returns bytea language sql immutable as $$ select sha256(convert_to(t, 'UTF8')) $$;
create function net.http_post(url text, body jsonb, headers jsonb) returns bigint language sql as $$ select 1::bigint $$;
create function public.operator_gate_ok(p text) returns boolean language sql as $$ select p = 'clientops' $$;
create table public.carousel_drafts (
  id uuid primary key, client_id text, status text not null, title text, post_body text, taxonomy jsonb,
  published_at timestamptz, scheduled_at timestamptz, board_visible boolean, board_archived_at timestamptz,
  created_at timestamptz default now(), updated_at timestamptz default now());
create table public.content_plan_config (account text primary key, posts_per_week int);
insert into public.content_plan_config values ('arch', 3);
create table public.client_board_actions (id uuid primary key default gen_random_uuid(), board_slug text, client_id text, action text, ref text, payload jsonb, created_at timestamptz default clock_timestamp());
create function public.operator_set_schedule_date(p_gate text, p_draft_id uuid, p_scheduled_at timestamptz) returns jsonb language plpgsql as $f$
declare d carousel_drafts; begin
  if not operator_gate_ok(p_gate) then return jsonb_build_object('ok', false, 'error', 'bad_gate'); end if;
  select * into d from carousel_drafts where id = p_draft_id;
  if d.status not in ('review', 'scheduled') then return jsonb_build_object('ok', false, 'error', 'bad_status'); end if;
  if p_scheduled_at is not null and p_scheduled_at < now() - interval '5 minutes' then return jsonb_build_object('ok', false, 'error', 'past_date'); end if;
  update carousel_drafts set scheduled_at = p_scheduled_at where id = p_draft_id;
  return jsonb_build_object('ok', true, 'scheduled_at', p_scheduled_at);
end $f$;
create function public.operator_set_board_visible(p_gate text, p_draft_id uuid, p_visible boolean) returns jsonb language plpgsql as $f$
begin
  if not operator_gate_ok(p_gate) then return jsonb_build_object('ok', false, 'error', 'bad_gate'); end if;
  update carousel_drafts set board_visible = p_visible where id = p_draft_id;
  return jsonb_build_object('ok', true);
end $f$;
`
const A = "I don't approve a creator pitch on follower count. We check what comparable posts delivered, then work backwards from installs."
const B = 'Before we approve a pitch, I want three checks. What have comparable sponsored posts delivered? Then we work backwards from installs times what the game can pay.'
const ORIG = 'Our negotiators move fast. Before we approve a pitch, I still want three checks on comparable sponsored posts, similar products and repeat bookings.'
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
const ids = { orig: id(1), rework: id(2), copy: id(3), fresh: id(4), rise: id(5), origUnposted: id(6), reworkOfUnposted: id(7) }

async function setup() {
  const db = new PGlite()
  await db.exec(schema)
  await db.exec(migration)
  const ins = (i: string, client: string, status: string, body: string, tax: object | null, pub: string | null = null, bv = false) =>
    db.query(`insert into carousel_drafts (id, client_id, status, title, post_body, taxonomy, published_at, board_visible) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [i, client, status, `T ${i.slice(-2)}`, body, tax ? JSON.stringify(tax) : null, pub, bv])
  await ins(ids.orig, 'arch', 'published', ORIG, null, '2026-09-16T07:00:00Z', true) // 09:00 Zagreb
  await ins(ids.rework, 'arch', 'review', A, { origin: 'rework', rework_of: ids.orig })
  await ins(ids.copy, 'arch', 'review', ORIG + ' Repeat bookings matter.', { origin: 'rework', rework_of: ids.orig })
  await ins(ids.fresh, 'arch', 'review', 'A new post from a call with new numbers.', null, null, true)
  await ins(ids.rise, 'risedtc', 'review', A, { origin: 'rework', rework_of: ids.orig })
  await ins(ids.origUnposted, 'arch', 'review', ORIG, null)
  await ins(ids.reworkOfUnposted, 'arch', 'review', A, { origin: 'rework', rework_of: ids.origUnposted })
  await db.exec(`set test.uid = '11111111-1111-1111-1111-111111111111'`)
  return db
}
const one = async <T,>(db: PGlite, sql: string, p: unknown[] = []) => ((await db.query<{ v: T }>(sql, p)).rows[0].v)
// Next week's Zagreb weekdays at 09:00, as the database counts them (arch_fill_week).
const slots = async (db: PGlite) => (await db.query<{ at: Date }>(`select (((w->>'start')::date + n)::timestamp + time '09:00') at time zone 'Europe/Zagreb' at
  from (select public.arch_fill_week() w) x, generate_series(0, 6) n order by n`)).rows.map(r => r.at.toISOString())
const sha = async (db: PGlite, id: string) => one<string>(db, `select encode(extensions.digest(post_body, 'sha256'), 'hex') v from carousel_drafts where id = $1`, [id])
const BATCH = 'aaaaaaaa-0000-4000-8000-000000000001'

describe('arch_rework_overlap: the Python check, ported', { timeout: 60_000 }, () => {
  it('matches difflib ratios exactly', async () => {
    const db = await setup()
    const r = (a: string, b: string) => one<string>(db, 'select public.arch_rework_overlap($1,$2)::text v', [a, b]).then(Number)
    expect(await r(A, B)).toBeCloseTo(0.2553191489361702, 12)
    expect(await r(B, A)).toBeCloseTo(0.3829787234042553, 12)
    expect(await r('the the the a a b the a b c the', 'a the b the c the the a')).toBeCloseTo(0.42105263157894735, 12)
    expect(await r(A, A)).toBe(1)
    // Python's \\w takes ⅓ and ① (Unicode No); the port must too, whatever the database locale (review r1)
    expect(await r('alpha ⅓ ⅔', 'beta ⅓ ⅔')).toBeCloseTo(0.6666666666666666, 12)
    expect(await r('Znaš ① €900 it’s', 'znaš ① €900 its')).toBeCloseTo(0.6666666666666666, 12)
    expect(await r('', '')).toBe(1)
    expect(await r('x', '')).toBe(0)
  })
})

describe('arch_fill_read', { timeout: 60_000 }, () => {
  it('offers only an ARCH rework of a posted original at 0.40 or less; holds the near-copy; never a new post or another seat', async () => {
    const db = await setup()
    const v = await one<{ ok: boolean; slot_hm: string; offered: { id: string; overlap: number }[]; held: { id: string; reason: string }[]; waiting_davorin: number }>(db, `select public.arch_fill_read('clientops') v`)
    expect(v.ok).toBe(true)
    expect(v.slot_hm).toBe('09:00')
    expect(v.offered.map(o => o.id)).toEqual([ids.rework])
    expect(v.held.map(h => [h.id, h.reason])).toEqual([[ids.copy, 'overlap'], [ids.reworkOfUnposted, 'original_not_posted']])
    expect(v.waiting_davorin).toBe(1)
  })
  it('refuses without the gate or a signed-in user', async () => {
    const db = await setup()
    expect((await one<{ error: string }>(db, `select public.arch_fill_read('nope') v`)).error).toBe('bad_gate')
    await db.exec(`set test.uid = ''`)
    expect((await one<{ error: string }>(db, `select public.arch_fill_read('clientops') v`)).error).toBe('bad_gate')
  })
  it('a rework Davorin took off his board is held', async () => {
    const db = await setup()
    await db.query(`insert into client_board_actions (board_slug, client_id, action, ref, payload) values ('arch-agency','arch','note',$1,'{"event":"post_removed"}')`, [ids.rework])
    const v = await one<{ offered: unknown[]; held: { id: string; reason: string }[] }>(db, `select public.arch_fill_read('clientops') v`)
    expect(v.offered).toEqual([])
    expect(v.held.find(h => h.id === ids.rework)?.reason).toBe('removed_by_davorin')
  })
})

describe('arch_fill_commit and arch_fill_undo', { timeout: 60_000 }, () => {
  type Res = { ok: boolean; error?: string; reason?: string; batch?: string; again?: boolean; undone?: number; changed?: number; posted?: number; too_late?: number }
  const commit = (db: PGlite, items: { id: string; at: string; body_sha256?: string }[], batch = BATCH) =>
    one<Res>(db, `select public.arch_fill_commit('clientops', $1::uuid, $2::jsonb) v`, [batch, JSON.stringify(items)])
  const undo = (db: PGlite, batch = BATCH) => one<Res>(db, `select public.arch_fill_undo('clientops', $1::uuid) v`, [batch])
  const item = async (db: PGlite, id: string, at: string) => ({ id, at, body_sha256: await sha(db, id) })

  it('refuses a new post, a near-copy, another seat, a wrong time, a weekend, the week after, a changed body, and two posts within a day', async () => {
    const db = await setup()
    const [mon, , wed, , , sat] = await slots(db)
    expect(await commit(db, [await item(db, ids.fresh, mon)])).toMatchObject({ ok: false, error: 'not_eligible', reason: 'not_rework' })
    expect(await commit(db, [await item(db, ids.copy, mon)])).toMatchObject({ ok: false, error: 'not_eligible', reason: 'overlap' })
    expect(await commit(db, [await item(db, ids.rise, mon)])).toMatchObject({ ok: false, error: 'not_eligible', reason: 'not_arch' })
    expect(await commit(db, [{ ...(await item(db, ids.rework, mon)), at: new Date(Date.parse(mon) + 3600_000).toISOString() }])).toMatchObject({ ok: false, error: 'not_arch_slot' })
    expect(await commit(db, [await item(db, ids.rework, sat)])).toMatchObject({ ok: false, error: 'not_arch_slot' })
    expect(await commit(db, [await item(db, ids.rework, new Date(Date.parse(wed) + 7 * 86400_000).toISOString())])).toMatchObject({ ok: false, error: 'not_arch_slot' })
    expect(await commit(db, [{ id: ids.rework, at: wed, body_sha256: 'f'.repeat(64) }])).toMatchObject({ ok: false, error: 'changed' })
    await db.query(`update carousel_drafts set scheduled_at = $1 where id = $2`, [new Date(Date.parse(mon) + 7 * 3600_000).toISOString(), ids.fresh])
    expect(await commit(db, [await item(db, ids.rework, mon)])).toMatchObject({ ok: false, error: 'too_close' })
    // nothing was written by any refusal
    expect((await db.query(`select 1 from client_board_actions`)).rows.length).toBe(0)
    expect((await db.query(`select scheduled_at from carousel_drafts where id = $1`, [ids.rework])).rows[0]).toEqual({ scheduled_at: null })
  })

  it('refuses more posts than the week has room for', async () => {
    const db = await setup()
    await db.exec(`update content_plan_config set posts_per_week = 1`)
    const [mon] = await slots(db)
    await db.query(`update carousel_drafts set scheduled_at = $1 where id = $2`, [new Date(Date.parse(mon) + 2 * 86400_000).toISOString(), ids.fresh])
    expect(await commit(db, [await item(db, ids.rework, mon)])).toMatchObject({ ok: false, error: 'week_full' })
  })

  it('arms the rework the way the 27 Oct reworks were armed; a retry of the same batch writes nothing; Undo takes it all back', async () => {
    const db = await setup()
    const [, , wed] = await slots(db)
    const it1 = await item(db, ids.rework, wed)
    const c = await commit(db, [it1])
    expect(c).toMatchObject({ ok: true, batch: BATCH })
    expect(await commit(db, [it1])).toMatchObject({ ok: true, batch: BATCH, again: true })
    const row = (await db.query<{ scheduled_at: Date; board_visible: boolean; status: string }>(`select scheduled_at, board_visible, status from carousel_drafts where id = $1`, [ids.rework])).rows[0]
    expect(row.scheduled_at.toISOString()).toBe(wed)
    expect(row.board_visible).toBe(true)
    expect(row.status).toBe('review')
    const acts = (await db.query<{ action: string; client_id: string; payload: Record<string, unknown> }>(`select action, client_id, payload from client_board_actions order by created_at`)).rows
    expect(acts).toHaveLength(1)
    expect(acts[0]).toMatchObject({ action: 'approve', client_id: 'arch', payload: { by: 'Ivan', event: 'operator_release_approval', batch: BATCH, prev_board_visible: false, approved_body_sha256: it1.body_sha256 } })
    expect((await one<{ offered: unknown[] }>(db, `select public.arch_fill_read('clientops') v`)).offered).toEqual([])

    expect(await undo(db)).toMatchObject({ ok: true, undone: 1 })
    const back = (await db.query<{ scheduled_at: Date | null; board_visible: boolean }>(`select scheduled_at, board_visible from carousel_drafts where id = $1`, [ids.rework])).rows[0]
    expect(back).toEqual({ scheduled_at: null, board_visible: false })
    expect((await db.query<{ action: string }>(`select action from client_board_actions order by created_at desc limit 1`)).rows[0].action).toBe('undo_approve')
    expect(await undo(db)).toMatchObject({ ok: true, undone: 0, changed: 1 })
  })

  it('an edit after the fill takes the approval away until it is approved again (review r2)', async () => {
    const db = await setup()
    const [mon] = await slots(db)
    expect((await commit(db, [await item(db, ids.rework, mon)])).ok).toBe(true)
    await db.query(`update carousel_drafts set post_body = $1 where id = $2`, [ORIG, ids.rework])
    const last = (await db.query<{ action: string; payload: Record<string, unknown> }>(`select action, payload from client_board_actions order by created_at desc limit 1`)).rows[0]
    expect(last).toMatchObject({ action: 'undo_approve', payload: { event: 'body_changed_after_fill', batch_of: BATCH } })
    // a non-fill approval is left alone by the trigger
    await db.query(`insert into client_board_actions (board_slug, client_id, action, ref, payload) values ('arch-agency','arch','approve',$1,'{"by":"Davorin"}')`, [ids.fresh])
    await db.query(`update carousel_drafts set post_body = 'Edited.' where id = $1`, [ids.fresh])
    expect((await db.query(`select 1 from client_board_actions where ref = $1 and action = 'undo_approve'`, [ids.fresh])).rows.length).toBe(0)
  })

  it('Undo puts back an approval that was there before the fill', async () => {
    const db = await setup()
    await db.query(`insert into client_board_actions (board_slug, client_id, action, ref, payload) values ('arch-agency','arch','approve',$1,'{"by":"Davorin"}')`, [ids.rework])
    const [mon] = await slots(db)
    expect((await commit(db, [await item(db, ids.rework, mon)])).ok).toBe(true)
    expect(await undo(db)).toMatchObject({ ok: true, undone: 1 })
    const last = (await db.query<{ action: string; payload: Record<string, unknown> }>(`select action, payload from client_board_actions order by created_at desc limit 1`)).rows[0]
    expect(last).toMatchObject({ action: 'approve', payload: { by: 'Davorin', restored_by: 'inbox fill next week undo' } })
  })

  it('Undo leaves a post that was moved, edited, already posted, or is about to post', async () => {
    const db = await setup()
    const [mon, tue] = await slots(db)
    expect((await commit(db, [await item(db, ids.rework, mon)])).ok).toBe(true)
    await db.query(`update carousel_drafts set scheduled_at = $1 where id = $2`, [tue, ids.rework])
    expect(await undo(db)).toMatchObject({ ok: true, undone: 0, changed: 1 })
    expect((await db.query<{ board_visible: boolean }>(`select board_visible from carousel_drafts where id = $1`, [ids.rework])).rows[0].board_visible).toBe(true)
    await db.query(`update carousel_drafts set published_at = now(), status = 'published' where id = $1`, [ids.rework])
    expect(await undo(db)).toMatchObject({ ok: true, undone: 0, posted: 1 })
    expect((await db.query(`select 1 from client_board_actions where action = 'undo_approve'`)).rows.length).toBe(0)
  })

  it('Undo refuses inside the last 15 minutes before the time', async () => {
    const db = await setup()
    const [mon] = await slots(db)
    expect((await commit(db, [await item(db, ids.rework, mon)])).ok).toBe(true)
    const soon = new Date(Date.now() + 5 * 60_000).toISOString()
    await db.query(`update carousel_drafts set scheduled_at = $1 where id = $2`, [soon, ids.rework])
    await db.query(`update client_board_actions set payload = jsonb_set(payload, '{scheduled_at}', to_jsonb($1::text)) where ref = $2`, [soon, ids.rework])
    expect(await undo(db)).toMatchObject({ ok: true, undone: 0, too_late: 1 })
  })

  it('rolls back cleanly', async () => {
    const db = await setup()
    await db.exec(rollback)
    expect((await db.query(`select proname from pg_proc where proname like 'arch_fill%' or proname like 'arch_rework%' or proname like 'tg_arch_fill%'`)).rows).toEqual([])
  })
})
