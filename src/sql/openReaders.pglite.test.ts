import type { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openDb } from './openTrackingSchema'

const EXTRA = `
create table public.scans (company_slug text, prospect_token text, report_json jsonb);
create table public.swishdm_comparison_pages (token text, prospect_id uuid, brand text, url text, status text);
create table public.profile_view_log (prospect_id uuid, seat text, viewed_at timestamptz, captured_at timestamptz default now());
create table public.post_engagers (prospect_id uuid, first_seen_at timestamptz, last_seen_at timestamptz, engagement_type text, comment_text text, post_social_id text);
create table public.client_post_metrics (title text, post_url text, social_id text, captured_at timestamptz);
`
const WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.7444.162 Safari/537.36'

describe('read-only readers count people (305)', () => {
  let db: PGlite
  beforeAll(async () => {
    db = await openDb(3, EXTRA)
    for (const c of ['human', 'link_scanner', 'owner'])
      await db.query(`insert into scan_opens(company_slug, opened_at, is_owner, user_agent, open_class) values ('three-rows', now() - interval '1 day', $1, $2, $3)`, [c === 'owner', WIN, c])
  }, 20_000)
  afterAll(async () => { await db?.close() })

  it('scan_open_stats counts only human opens as real', async () => {
    expect((await db.query(`select real_opens::int, total_opens::int, scanner_opens::int, own_tool_opens::int, real_open_days::int from scan_open_stats where company_slug='three-rows'`)).rows[0])
      .toEqual({ real_opens: 1, total_opens: 3, scanner_opens: 1, own_tool_opens: 0, real_open_days: 1 })
  })
  it('scan_open_stats keeps its first four columns in order', async () => {
    const cols = (await db.query<{ column_name: string }>(`select column_name from information_schema.columns where table_name='scan_open_stats' order by ordinal_position`)).rows.map(r => r.column_name)
    expect(cols).toEqual(['company_slug', 'real_opens', 'total_opens', 'last_real_open', 'real_open_days', 'scanner_opens', 'own_tool_opens'])
  })
  it('inbox tile counts only human opens', async () => {
    expect((await db.query(`select client_id, opens_total::int, opens_30d::int, distinct_prospects::int from inbox_scan_opens_v`)).rows).toEqual([{ client_id: 'ivan', opens_total: 1, opens_30d: 1, distinct_prospects: 1 }])
  })
  it('inbox tile keeps its six columns', async () => {
    const cols = (await db.query<{ column_name: string }>(`select column_name from information_schema.columns where table_name='inbox_scan_opens_v' order by ordinal_position`)).rows.map(r => r.column_name)
    expect(cols).toEqual(['client_id', 'opens_7d', 'opens_30d', 'opens_total', 'distinct_prospects', 'last_open'])
  })
})
