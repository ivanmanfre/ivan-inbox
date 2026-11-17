import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, expect, it } from 'vitest'

// In-memory Postgres only. Every client, date and count below is invented.
const source = readFileSync('db/20261117_lane_adjustment_cohorts.sql', 'utf8')
const at = (iso: string) => source.replace('as_of timestamptz := statement_timestamp();', `as_of timestamptz := '${iso}'::timestamptz;`)
const mark = (effective_on: string, label = 'Example change', client_id = 'fixture_a') => ({ client_id, effective_on, label })
type Row = { client_id: string; period_from: string; period_to: string | null; label: string; invites: number; accept_base: number; accepted: number; reply_base: number; replied: number; replied_so_far: number; calls: number }
let pg: PGlite
const marks = (value: unknown) => pg.query('update public.integration_config set value=$1', [typeof value === 'string' ? value : JSON.stringify(value)])
const read = async () => (await pg.query<Row>(`select client_id, period_from::text, period_to::text, label, invites::int, accept_base::int, accepted::int,
  reply_base::int, replied::int, replied_so_far::int, calls::int from public.inbox_lane_adjustment_cohorts()`)).rows

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

it('leaves out a malformed entry and still returns the valid ones', async () => {
  await marks([null, true, 42, [], {}, mark('2026-02-30', 'No such day', 'fixture_b'), mark('0000-01-01', 'Year zero', 'fixture_b'),
    mark('2026-01-01', '  '), mark('2026-01-01')])
  expect((await read()).map(r => [r.client_id, r.period_from, r.label])).toEqual([['fixture_a', '2026-01-01', 'Example change']])
  await marks('this is not JSON')
  expect(await read()).toEqual([])
})

it('splits periods at Warsaw midnight across a clock change and never mixes clients', async () => {
  await marks([mark('2026-03-28', 'Before'), mark('2026-03-30', 'After'), mark('2026-03-28', 'Other client', 'fixture_b'), mark('2026-03-28', 'No client on the campaign', 'ivan')])
  await pg.exec(`insert into public.outreach_prospects(id, campaign_id, connection_sent_at, connected_at) values
    ('before', 'a', '2026-03-27 22:59:59Z', null),
    ('start', 'a', '2026-03-27 23:00:00Z', '2026-03-30 23:00:00Z'),
    ('end', 'a', '2026-03-29 21:59:59Z', '2026-04-01 22:00:00Z'),
    ('next', 'a', '2026-03-29 22:00:00Z', null),
    ('other', 'b', '2026-03-28 00:00:00Z', null),
    ('legacy', 'legacy', '2026-03-28 00:00:00Z', null);
    insert into public.outreach_messages values
      ('start', 'inbound', false, null, '2026-04-03 23:00:00Z'),
      ('end', 'inbound', false, 'vendor_pitch', '2026-03-30 10:00:00Z'),
      ('end', 'inbound', true, null, '2026-03-30 11:00:00Z');`)
  await pg.exec(at('2026-05-01 00:00:00Z'))
  const rows = await read()
  const a = rows.filter(r => r.client_id === 'fixture_a')
  expect(a.map(r => [r.period_from, r.period_to, r.invites, r.accepted, r.replied])).toEqual([
    ['2026-03-28', '2026-03-29', 2, 1, 1], ['2026-03-30', null, 1, 0, 0]])
  expect(rows.find(r => r.client_id === 'fixture_b')!.invites).toBe(1)
  expect(rows.find(r => r.client_id === 'ivan')!.invites).toBe(1)
})

it.each(['UTC', 'Europe/Warsaw'])('counts the reply window in elapsed hours with the session in %s', async zone => {
  await pg.exec(`set time zone '${zone}'`)
  await marks([mark('2026-03-01')])
  // Sent 167.5 hours before the read, across the spring clock change: not yet judged.
  await pg.exec(`insert into public.outreach_prospects(id, campaign_id, connection_sent_at) values ('young', 'a', '2026-03-25 10:30:00Z')`)
  await pg.exec(at('2026-04-01 10:00:00Z'))
  expect((await read())[0]).toMatchObject({ invites: 1, accept_base: 1, reply_base: 0 })
  // 168.5 hours before the read: judged.
  await pg.exec(at('2026-04-01 11:00:00Z'))
  expect((await read())[0]).toMatchObject({ invites: 1, reply_base: 1, replied: 0 })
})

it('refuses a caller who is not an operator', async () => {
  await pg.exec(`select set_config('test.role', 'authenticated', false)`)
  await expect(read()).rejects.toThrow(/operator_denied/)
})
