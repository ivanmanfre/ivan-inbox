import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, expect, it } from 'vitest'

// In-memory Postgres only. Every client, date and count below is invented.
const source = readFileSync('db/20261117b_lane_weekly_cohorts.sql', 'utf8')
const at = (iso: string) => source.replace('as_of timestamptz := statement_timestamp();', `as_of timestamptz := '${iso}'::timestamptz;`)
const mark = (effective_on: string, label = 'Example change', client_id = 'fixture_a') => ({ client_id, effective_on, label })
type Row = { client_id: string; period_from: string; period_to: string; label: string; invites: number; accept_base: number; accepted: number; reply_base: number; replied: number; replied_so_far: number; calls: number }
let pg: PGlite
const marks = (value: unknown) => pg.query('update public.integration_config set value=$1', [typeof value === 'string' ? value : JSON.stringify(value)])
const read = async () => (await pg.query<Row>(`select client_id, period_from::text, period_to::text, label, invites::int, accept_base::int, accepted::int,
  reply_base::int, replied::int, replied_so_far::int, calls::int from public.inbox_lane_adjustment_cohorts()`)).rows
const of = (rows: Row[], client: string) => rows.filter(r => r.client_id === client)

beforeEach(async () => {
  pg = new PGlite()
  await pg.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create function auth.role() returns text language sql as $$ select coalesce(nullif(current_setting('test.role', true), ''), 'service_role') $$;
    create function auth.uid() returns uuid language sql as $$ select null::uuid $$;
    create table public.outreach_agent_accounts(client_id text, operator_ids uuid[]);
    create table public.integration_config(key text primary key, value text);
    create table public.outreach_campaigns(id text primary key, client_id text);
    create table public.outreach_prospects(id text primary key, campaign_id text,
      connection_sent_at timestamptz, connected_at timestamptz, call_booked_at timestamptz);
    create table public.outreach_messages(prospect_id text, direction text,
      is_reaction boolean, reply_intent text, sent_at timestamptz);
    insert into public.integration_config values ('lane_adjustments', '[]');
    insert into public.outreach_campaigns values ('a', 'fixture_a'), ('b', 'fixture_b'), ('legacy', null);`)
  await pg.exec(source)
}, 120000)
afterEach(async () => { await pg?.close() })

// Read on Wednesday 1 April 2026 (Warsaw): the current week starts Monday 30 March,
// the day after the spring clock change.
it('returns the current Warsaw week and the 7 before it, split at Monday midnight across a clock change', async () => {
  await pg.exec(`insert into public.outreach_prospects(id, campaign_id, connection_sent_at, connected_at, call_booked_at) values
    ('too-old', 'a', '2026-02-08 22:59:59Z', null, null),
    ('first', 'a', '2026-02-08 23:00:00Z', null, null),
    ('start', 'a', '2026-03-22 23:00:00Z', '2026-03-25 23:00:00Z', '2026-04-01 00:00:00Z'),
    ('end', 'a', '2026-03-29 21:59:59Z', '2026-04-01 22:00:00Z', null),
    ('next', 'a', '2026-03-29 22:00:00Z', null, null);
    insert into public.outreach_messages values
      ('start', 'inbound', false, null, '2026-03-29 23:00:00Z'),
      ('end', 'inbound', false, 'vendor_pitch', '2026-03-30 10:00:00Z'),
      ('end', 'inbound', true, null, '2026-03-30 11:00:00Z');`)
  await pg.exec(at('2026-05-01 00:00:00Z'))
  // Pin the weeks to the 1 April read while every invite is old enough to judge.
  await pg.exec(at('2026-05-01 00:00:00Z').replace("date_trunc('week', (as_of at time zone 'Europe/Warsaw'))::date", "date '2026-03-30'"))
  const a = of(await read(), 'fixture_a')
  expect(a.map(r => [r.period_from, r.period_to])).toEqual([
    ['2026-02-09', '2026-02-15'], ['2026-02-16', '2026-02-22'], ['2026-02-23', '2026-03-01'], ['2026-03-02', '2026-03-08'],
    ['2026-03-09', '2026-03-15'], ['2026-03-16', '2026-03-22'], ['2026-03-23', '2026-03-29'], ['2026-03-30', '2026-04-05']])
  expect(a.map(r => r.invites)).toEqual([1, 0, 0, 0, 0, 0, 2, 1])
  expect(a[6]).toMatchObject({ accept_base: 2, accepted: 1, reply_base: 2, replied: 1, replied_so_far: 1, calls: 1 })
  expect(a[7]).toMatchObject({ accepted: 0, replied: 0, calls: 0 })
})

it('takes the current week from the Warsaw date of the read', async () => {
  await pg.exec(`insert into public.outreach_prospects(id, campaign_id, connection_sent_at) values ('p', 'a', '2026-03-29 23:30:00Z')`)
  // Sunday 23:30 UTC is already Monday 01:30 in Warsaw.
  await pg.exec(at('2026-03-29 23:30:00Z'))
  const a = of(await read(), 'fixture_a')
  expect(a[a.length - 1]).toMatchObject({ period_from: '2026-03-30', period_to: '2026-04-05', invites: 1, accept_base: 0, reply_base: 0 })
})

it('never mixes clients and files a campaign with no client under ivan', async () => {
  await pg.exec(`insert into public.outreach_prospects(id, campaign_id, connection_sent_at) values
    ('a1', 'a', '2026-03-24 10:00:00Z'), ('a2', 'a', '2026-03-25 10:00:00Z'),
    ('b1', 'b', '2026-03-24 10:00:00Z'), ('l1', 'legacy', '2026-03-24 10:00:00Z')`)
  await pg.exec(at('2026-04-01 10:00:00Z'))
  const rows = await read()
  expect([...new Set(rows.map(r => r.client_id))].sort()).toEqual(['fixture_a', 'fixture_b', 'ivan'])
  const week = (c: string) => of(rows, c).find(r => r.period_from === '2026-03-23')!.invites
  expect([week('fixture_a'), week('fixture_b'), week('ivan')]).toEqual([2, 1, 1])
  expect(of(rows, 'fixture_b')).toHaveLength(8)
})

it('notes a change on its own week and client only, skipping malformed entries', async () => {
  await pg.exec(`insert into public.outreach_prospects(id, campaign_id, connection_sent_at) values
    ('a1', 'a', '2026-03-24 10:00:00Z'), ('b1', 'b', '2026-03-24 10:00:00Z')`)
  await pg.exec(at('2026-04-01 10:00:00Z'))
  await marks([null, true, 42, [], {}, mark('2026-02-30', 'No such day'), mark('0000-01-01', 'Year zero'), mark('2026-03-25', '  '),
    mark('2026-03-25', 'Second'), mark('2026-03-23', 'First'), mark('2026-03-25', 'Second'), mark('2026-03-31', 'Other client', 'fixture_b'),
    mark('2025-01-01', 'Before the window')])
  const rows = await read()
  const labels = (c: string) => Object.fromEntries(of(rows, c).filter(r => r.label).map(r => [r.period_from, r.label]))
  expect(labels('fixture_a')).toEqual({ '2026-03-23': 'First (23 Mar); Second (25 Mar)' })
  expect(labels('fixture_b')).toEqual({ '2026-03-30': 'Other client (31 Mar)' })
  await marks('this is not JSON')
  const plain = await read()
  expect(plain).toHaveLength(16)
  expect(plain.every(r => r.label === '')).toBe(true)
})

it.each(['UTC', 'Europe/Warsaw'])('counts the reply window in elapsed hours with the session in %s', async zone => {
  await pg.exec(`set time zone '${zone}'`)
  // Sent 167.5 hours before the read, across the spring clock change: not yet judged.
  await pg.exec(`insert into public.outreach_prospects(id, campaign_id, connection_sent_at) values ('young', 'a', '2026-03-25 10:30:00Z')`)
  await pg.exec(at('2026-04-01 10:00:00Z'))
  const week = async () => of(await read(), 'fixture_a').find(r => r.period_from === '2026-03-23')!
  expect(await week()).toMatchObject({ invites: 1, accept_base: 1, reply_base: 0 })
  // 168.5 hours before the read: judged.
  await pg.exec(at('2026-04-01 11:00:00Z'))
  expect(await week()).toMatchObject({ invites: 1, reply_base: 1, replied: 0 })
})

it('refuses a caller who is not an operator', async () => {
  await pg.exec(`select set_config('test.role', 'authenticated', false)`)
  await expect(read()).rejects.toThrow(/operator_denied/)
})
