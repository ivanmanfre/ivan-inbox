import { afterAll, beforeAll, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
// Invented people, tokens and slugs only (the repo is public).
const db = new PGlite()
const migration = readFileSync(new URL('../../../db/20261126b_inbox_report_opens.sql', import.meta.url), 'utf8')
const A = '00000000-0000-0000-0000-00000000000a', B = '00000000-0000-0000-0000-00000000000b', C = '00000000-0000-0000-0000-00000000000c'
const TOK = 'abcdefghijklmnopqrst'
beforeAll(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create function open_is_signal(p_class text, p_eligible boolean) returns boolean language sql immutable as $$ select coalesce(p_class = 'human' and p_eligible, false) $$;
    create table page_opens(id bigserial, created_at timestamptz, page text, city text, country text, open_class text, eligible boolean);
    create table scan_opens(id bigserial, company_slug text, opened_at timestamptz, open_class text, eligible boolean);
    create table swishdm_comparison_pages(token text, prospect_id uuid, status text);
    create table outreach_messages(prospect_id uuid, direction text, sent_at timestamptz, message_text text);
    insert into swishdm_comparison_pages values ('${TOK}', '${A}', 'published');
    insert into outreach_messages values
      ('${A}', 'outbound', '2026-11-10 09:00Z', 'here it is https://madebyswishdm.com/compare/${TOK}/'),
      ('${B}', 'outbound', '2026-11-10 09:00Z', 'your scan https://ivanmanfredi.com/scan/acme-shop'),
      ('${B}', 'outbound', '2026-11-10 09:00Z', 'shared https://ivanmanfredi.com/scan/two-people'),
      ('${C}', 'outbound', '2026-11-10 09:00Z', 'shared https://ivanmanfredi.com/scan/two-people');
    insert into page_opens(created_at, page, city, country, open_class, eligible) values
      ('2026-11-09 12:00Z', 'swishdm/compare/${TOK}', 'Lyon', 'France', 'human', true),   -- before we sent it
      ('2026-11-11 08:00Z', 'swishdm/compare/${TOK}', 'Lyon', 'France', 'human', true),   -- first open that day
      ('2026-11-11 15:00Z', 'swishdm/compare/${TOK}', 'Lyon', 'France', 'human', true),   -- same day again
      ('2026-11-12 07:00Z', 'swishdm/compare/${TOK}', null, null, 'link_scanner', false), -- a scanner
      ('2026-11-12 07:05Z', 'swishdm/compare/${TOK}', null, null, 'suspect', false),      -- unresolved
      ('2026-11-13 10:00Z', 'swishdm/compare/${TOK}', '', '', 'human', true);              -- next day, no place
    insert into scan_opens(company_slug, opened_at, open_class, eligible) values
      ('acme-shop', '2026-11-11 10:00Z', 'own_tool', false),
      ('acme-shop', '2026-11-11 11:00Z', 'human', true),
      ('acme-shop', '2026-11-11 23:30Z', 'human', true), -- 00:30 Warsaw: the next day there
      ('two-people', '2026-11-11 11:00Z', 'human', true);`)
  await db.exec(migration.slice(migration.indexOf('create or replace function'), migration.lastIndexOf('commit;')))
})
afterAll(() => db.close())

it('returns one row per report per Warsaw day at the first real open, after the send', async () => {
  const r = await db.query<{ prospect_id: string; report: string; at: Date; place: string | null }>('select * from inbox_report_opens() order by prospect_id, at')
  expect(r.rows.map(x => [x.prospect_id, x.report, x.at.toISOString(), x.place])).toEqual([
    [A, `swishdm/compare/${TOK}`, '2026-11-11T08:00:00.000Z', 'Lyon, France'],
    [A, `swishdm/compare/${TOK}`, '2026-11-13T10:00:00.000Z', null],
    [B, 'scan/acme-shop', '2026-11-11T11:00:00.000Z', null],
    [B, 'scan/acme-shop', '2026-11-11T23:30:00.000Z', null],
  ])
})

it('never returns a scanner, tool or unresolved open, nor a link that went to two people', async () => {
  const r = await db.query<{ n: number }>(`select count(*)::int n from inbox_report_opens() where (at >= '2026-11-12 00:00Z' and at < '2026-11-13 00:00Z') or report = 'scan/two-people' or prospect_id = '${C}'`)
  expect(r.rows[0].n).toBe(0)
})

it('is readable by the signed-in app and not by anon', async () => {
  const r = await db.query<{ anon: boolean; authed: boolean }>(`select has_function_privilege('anon','inbox_report_opens()','execute') anon, has_function_privilege('authenticated','inbox_report_opens()','execute') authed`)
  expect(r.rows[0]).toEqual({ anon: false, authed: true })
})
