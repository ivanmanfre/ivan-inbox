# Outreach Performance Alerts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A fifth Strategy view, `Outreach`, that shows per-lane DM reply performance with drift and sibling alarms, attribution to the suspect dimension, and a Monday WhatsApp line per fired alarm.

**Architecture:** One SQL function `outreach_perf_payload(p_client_id, p_days)` does every count and every alarm (single source for the page and the n8n digest). A thin typed fetch in `src/lib/outreachPerf.ts` plus pure presentation helpers. One React block mounted in `strategy.tsx`. One n8n workflow calling the same RPC weekly.

**Tech Stack:** Postgres (Supabase, applied through the Management API), PGlite for hermetic SQL tests, React 19 + vitest in ivan-inbox, n8n 2.18.5 through `n8nac`.

**Spec:** `docs/superpowers/specs/2026-09-16-outreach-performance-alerts-design.md`

## Global Constraints

- Active lanes only: campaign `is_active = true` and `coalesce(archived,false) = false`, with at least one matured DM send in the window.
- DM sends only: `outreach_messages.direction = 'outbound'`, `sent_at is not null`, `message_type in ('dm','inmail')`, `coalesce(ai_model,'') <> 'manual_mirror'`. Connection notes excluded.
- Matured send: `sent_at <= now() - interval '7 days'`. Current window: 14 days of matured sends. Baseline: the 60 days before the current window. Table: `p_days` (90).
- Floor: 20 matured sends per cell (was 30; lowered after the third live replay hid a 25-point fall at 22 sends) for any verdict. Attribution child floor: 15.
- Alarm test: rate below comparator, Wilson 80% upper bound (z = 1.2816) below comparator, absolute gap ≥ 0.03.
- Ivan lane: `p_client_id = 'ivan'` maps to `outreach_campaigns.client_id is null`.
- RPC: `security definer`, `set search_path = public`, `revoke all on function ... from anon, public`, grant execute to `authenticated, service_role`.
- Alert only. No workflow or page action pauses, swaps, or edits copy.
- Git: work on branch `outreach-perf` in `~/Desktop/ivan-inbox`. `git add` named files only (main has unrelated uncommitted edits in `src/lib/campaignControl*`; never stage them). No push to `main` until Task 7. Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Supabase project ref `bjbvqvzbzczjbatgmccb`. DDL goes through the Management API (see Task 3), never by hand-paste.
- No em dashes in any user-facing string. No banned filler words.

---

### Task 1: PGlite SQL harness + payload function (counts only)

**Files:**
- Create: `db/069_outreach_perf_payload.sql`
- Create: `src/sql/outreachPerf.pglite.test.ts`
- Create: `src/sql/fixtures/outreach-perf.sql`
- Modify: `package.json` (add devDependency `@electric-sql/pglite`)

**Model:** `opus`

**Interfaces:**
- Consumes: `lane_of(text)` from `db/056_lane_quiet_on_linkedin.sql` (loaded into PGlite by the test).
- Produces: `outreach_perf_payload(p_client_id text, p_days int default 90) returns jsonb` with shape
  ```
  { ok: true, client_id, days, generated_at, mature_before, cur_from, base_from, floor, child_floor,
    lanes: [{ lane, campaigns: [string],
      cells: [{ step, n, replies, rate, positive_n, positive_rate|null, base_n, base_replies, base_rate, status: 'ok'|'thin'|'drift' }],
      variants: [{ step, variant, n, replies, rate, others_n, others_rate, status: 'ok'|'thin'|'sibling' }],
      splits: [{ step, dim: 'source'|'variant'|'country'|'vertical', value, n, replies, rate }],
      alarms: [],
      table: [{ step, variant, source, country, vertical, n, replies, rate }] }],
    reply_basis: { threaded, stamp_only } }
  ```
  Task 2 fills `alarms` and the `drift`/`sibling` statuses; Task 1 returns `status: 'ok'|'thin'` only and `alarms: []`.

- [ ] **Step 1: Branch and install PGlite**

Run: `cd ~/Desktop/ivan-inbox && git checkout -b outreach-perf && npm i -D @electric-sql/pglite`
Expected: `package.json` devDependencies gains `@electric-sql/pglite`.

- [ ] **Step 2: Write the fixture**

`src/sql/fixtures/outreach-perf.sql` (dates are relative to `now()` so the test never rots):

```sql
create table outreach_campaigns (
  id uuid primary key default gen_random_uuid(), name text not null, client_id text,
  is_active boolean default true, archived boolean default false);
create table outreach_prospects (
  id uuid primary key default gen_random_uuid(), campaign_id uuid references outreach_campaigns(id),
  country text, enrichment_data jsonb default '{}'::jsonb, last_reply_at timestamptz);
create table outreach_messages (
  id uuid primary key default gen_random_uuid(), prospect_id uuid references outreach_prospects(id),
  direction text not null, message_type text default 'dm', channel text, sequence_step int,
  sent_at timestamptz, ai_model text, replies_to_message_id uuid, is_reaction boolean default false,
  reply_intent text);

insert into outreach_campaigns (id, name, client_id) values
  ('00000000-0000-0000-0000-0000000000c1', 'RiseDTC — Cold (DTC Sales Nav)', 'risedtc'),
  ('00000000-0000-0000-0000-0000000000c2', 'RiseDTC — Network Activation (ICP connections)', 'risedtc'),
  ('00000000-0000-0000-0000-0000000000c3', 'Poland — Agencies (Cold)', null),
  ('00000000-0000-0000-0000-0000000000c4', 'ARCH. Influencer Agency — Cold', 'arch');
update outreach_campaigns set archived = true where id = '00000000-0000-0000-0000-0000000000c4';

-- helper: n prospects in a campaign with a source, k of them replied to their DM
create or replace function fx_seed(p_camp uuid, p_source text, p_variant text, p_step int,
  p_n int, p_replied int, p_days_ago int, p_threaded boolean default true, p_intent text default null)
returns void language plpgsql as $$
declare i int; pid uuid; mid uuid;
begin
  for i in 1..p_n loop
    insert into outreach_prospects (campaign_id, country, enrichment_data)
      values (p_camp, 'US', jsonb_build_object('source', p_source)) returning id into pid;
    insert into outreach_messages (prospect_id, direction, message_type, channel, sequence_step, sent_at, ai_model)
      values (pid, 'outbound', 'dm', 'linkedin', p_step, now() - make_interval(days => p_days_ago), p_variant)
      returning id into mid;
    if i <= p_replied then
      if p_threaded then
        insert into outreach_messages (prospect_id, direction, sent_at, replies_to_message_id, reply_intent)
          values (pid, 'inbound', now() - make_interval(days => p_days_ago) + interval '1 day', mid, p_intent);
      else
        update outreach_prospects set last_reply_at = now() - make_interval(days => p_days_ago) + interval '1 day' where id = pid;
      end if;
    end if;
  end loop;
end $$;

-- RISE cold DM1, current window (sent 10-12 days ago): tanks on source competitor_engagers
select fx_seed('00000000-0000-0000-0000-0000000000c1', 'competitor_engagers', 'rise_dm1_a', 1, 71, 2, 10, true, 'positive');
select fx_seed('00000000-0000-0000-0000-0000000000c1', 'own_engagers',        'rise_dm1_a', 1, 40, 6, 12, true, 'positive');
-- RISE cold DM1 baseline (sent 40 days ago): 16.0% over 250
select fx_seed('00000000-0000-0000-0000-0000000000c1', 'own_engagers',        'rise_dm1_a', 1, 250, 40, 40, false);
-- RISE warm DM1 current: healthy 30% on variant B
select fx_seed('00000000-0000-0000-0000-0000000000c2', 'warm_engager_harvester', 'rise_dm1_b', 1, 40, 12, 9);
-- RISE warm DM1 sibling loser: variant C at 1/35 vs B
select fx_seed('00000000-0000-0000-0000-0000000000c2', 'warm_engager_harvester', 'rise_dm1_c', 1, 35, 1, 9);
-- under-floor cell: RISE warm nudge, 12 sends
select fx_seed('00000000-0000-0000-0000-0000000000c2', 'warm_engager_harvester', 'rise_dm2_nudge_v1', 2, 12, 3, 9);
-- immature sends (3 days ago) must be ignored everywhere
select fx_seed('00000000-0000-0000-0000-0000000000c1', 'own_engagers', 'rise_dm1_a', 1, 50, 0, 3);
-- manual mirrors must be ignored
select fx_seed('00000000-0000-0000-0000-0000000000c1', 'own_engagers', 'manual_mirror', 1, 20, 20, 10);
-- archived ARCH campaign must not appear
select fx_seed('00000000-0000-0000-0000-0000000000c4', 'cold', 'arch_dm1_a', 1, 40, 4, 10);
-- Ivan lane: 40 sends, 4 replies via stamp only (no threaded row), no baseline
select fx_seed('00000000-0000-0000-0000-0000000000c3', 'apify_search', 'template/agency_dm_v3_owned', 1, 40, 4, 10, false);
-- a reaction-only inbound must not count as a reply (RISE cold, one extra prospect)
do $$ declare pid uuid; mid uuid; begin
  insert into outreach_prospects (campaign_id, country, enrichment_data) values ('00000000-0000-0000-0000-0000000000c1','US','{"source":"own_engagers"}') returning id into pid;
  insert into outreach_messages (prospect_id, direction, message_type, channel, sequence_step, sent_at, ai_model) values (pid,'outbound','dm','linkedin',1, now() - interval '10 days','rise_dm1_a') returning id into mid;
  insert into outreach_messages (prospect_id, direction, sent_at, replies_to_message_id, is_reaction) values (pid,'inbound', now() - interval '9 days', mid, true);
end $$;
```

- [ ] **Step 3: Write the failing test**

`src/sql/outreachPerf.pglite.test.ts`:

```ts
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'

type Cell = { step: string; n: number; replies: number; rate: number; base_n: number; base_rate: number; status: string; positive_rate: number | null }
type Lane = { lane: string; campaigns: string[]; cells: Cell[]; variants: { step: string; variant: string; n: number; rate: number; status: string }[]; splits: { step: string; dim: string; value: string; n: number; replies: number }[]; alarms: unknown[]; table: unknown[] }
type Payload = { ok: boolean; lanes: Lane[]; reply_basis: { threaded: number; stamp_only: number } }

let db: PGlite
async function payload(client: string): Promise<Payload> {
  const r = await db.query<{ p: Payload }>('select outreach_perf_payload($1, 90) as p', [client])
  return r.rows[0].p
}
const lane = (p: Payload, name: string) => p.lanes.find(l => l.lane === name)
const cell = (p: Payload, l: string, step: string) => lane(p, l)?.cells.find(c => c.step === step)

beforeAll(async () => {
  db = new PGlite()
  await db.exec(readFileSync('src/sql/fixtures/outreach-perf.sql', 'utf8'))
  await db.exec(readFileSync('db/056_lane_quiet_on_linkedin.sql', 'utf8'))
  await db.exec(readFileSync('db/069_outreach_perf_payload.sql', 'utf8'))
})

describe('outreach_perf_payload counts', () => {
  it('counts matured DM sends per lane and step, excluding immature, mirrors, archived', async () => {
    const p = await payload('risedtc')
    expect(p.ok).toBe(true)
    // cold DM1 current = 71 + 40 + 1 reaction-prospect = 112 sends, 8 replies (reaction excluded)
    const cold = cell(p, 'cold', 'dm1')!
    expect(cold.n).toBe(112)
    expect(cold.replies).toBe(8)
    expect(cold.base_n).toBe(250)
    expect(cold.base_rate).toBeCloseTo(0.16, 3)
    expect(cold.positive_rate).toBeCloseTo(8 / 112, 3)
    expect(lane(p, 'cold')!.campaigns).toEqual(['RiseDTC — Cold (DTC Sales Nav)'])
  })
  it('marks an under-floor cell thin and never drift', async () => {
    const p = await payload('risedtc')
    const nudge = cell(p, 'warm', 'nudge')!
    expect(nudge.n).toBe(12)
    expect(nudge.status).toBe('thin')
  })
  it('hides archived campaigns entirely', async () => {
    const p = await payload('arch')
    expect(p.lanes).toEqual([])
  })
  it('maps ivan to client_id null and counts stamp-only replies', async () => {
    const p = await payload('ivan')
    const c = cell(p, 'cold', 'dm1')!
    expect(c.n).toBe(40)
    expect(c.replies).toBe(4)
    expect(c.positive_rate).toBeNull()
    expect(p.reply_basis.stamp_only).toBeGreaterThanOrEqual(4)
  })
  it('splits the current window by source with counts', async () => {
    const p = await payload('risedtc')
    const s = lane(p, 'cold')!.splits.filter(x => x.step === 'dm1' && x.dim === 'source')
    expect(s.find(x => x.value === 'competitor_engagers')).toMatchObject({ n: 71, replies: 2 })
    expect(s.find(x => x.value === 'own_engagers')).toMatchObject({ n: 41, replies: 6 })
  })
})
```

- [ ] **Step 4: Run it to verify it fails**

Run: `npx vitest run src/sql/outreachPerf.pglite.test.ts`
Expected: FAIL, `function outreach_perf_payload(unknown, integer) does not exist`.

- [ ] **Step 5: Write the function (counts only)**

`db/069_outreach_perf_payload.sql`:

```sql
-- 069: outreach_perf_payload — per-lane DM performance for the Strategy "Outreach" view and the
-- weekly WhatsApp digest. Spec: docs/superpowers/specs/2026-09-16-outreach-performance-alerts-design.md
-- Counts only DM/InMail sends (never connection notes), matured 7 days, active campaigns only.
-- Ivan 2026-09-16: "only show active lanes and dm sends". Alert only, never an action.

create or replace function perf_wilson_upper(k bigint, n bigint) returns numeric
language sql immutable as $$
  select case when n = 0 then 0 else
    ((k::numeric / n) + (1.2816^2) / (2 * n)
      + 1.2816 * sqrt(((k::numeric / n) * (1 - k::numeric / n)) / n + (1.2816^2) / (4 * n::numeric * n)))
    / (1 + (1.2816^2) / n) end
$$;

create or replace function outreach_perf_payload(p_client_id text, p_days int default 90)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_mature timestamptz := now() - interval '7 days';
  v_cur_from timestamptz := now() - interval '21 days';
  v_base_from timestamptz := now() - interval '81 days';
  v_table_from timestamptz := now() - make_interval(days => greatest(p_days, 21));
  v_floor int := 30;
  v_child_floor int := 15;
  v_lanes jsonb;
  v_threaded bigint;
  v_stamp bigint;
begin
  drop table if exists perf_sends; drop table if exists perf_scored;
  create temp table perf_sends on commit drop as
  select m.id, m.prospect_id, m.sent_at, coalesce(m.ai_model, 'unknown') as variant,
         case when m.channel = 'linkedin_inmail' then 'inmail'
              when coalesce(m.sequence_step, 1) <= 1 then 'dm1'
              when m.sequence_step = 2 then 'nudge'
              else 'dm3' end as step,
         lane_of(c.name) as lane, c.name as campaign,
         coalesce(pr.enrichment_data->>'source', pr.enrichment_data->>'source_kind', pr.enrichment_data->>'seed', 'unknown') as source,
         coalesce(nullif(pr.country, ''), 'unknown') as country,
         coalesce(pr.enrichment_data->'gate'->>'vertical', pr.enrichment_data->>'vertical', 'unknown') as vertical,
         pr.last_reply_at
  from outreach_messages m
  join outreach_prospects pr on pr.id = m.prospect_id
  join outreach_campaigns c on c.id = pr.campaign_id
  where m.direction = 'outbound'
    and m.sent_at is not null and m.sent_at >= v_table_from and m.sent_at <= v_mature
    and m.message_type in ('dm', 'inmail')
    and coalesce(m.ai_model, '') <> 'manual_mirror'
    and c.is_active and not coalesce(c.archived, false)
    and case when p_client_id = 'ivan' then c.client_id is null else c.client_id = p_client_id end;

  create temp table perf_scored on commit drop as
  select s.*,
    exists (select 1 from outreach_messages r where r.replies_to_message_id = s.id
              and r.direction = 'inbound' and not coalesce(r.is_reaction, false)) as threaded,
    (s.last_reply_at is not null and s.last_reply_at > s.sent_at
      and not exists (select 1 from perf_sends s2 where s2.prospect_id = s.prospect_id
                        and s2.sent_at > s.sent_at and s2.sent_at < s.last_reply_at)) as stamp_hit,
    (select r.reply_intent from outreach_messages r where r.replies_to_message_id = s.id
       and r.direction = 'inbound' and not coalesce(r.is_reaction, false)
       order by r.sent_at limit 1) as intent,
    (s.sent_at >= v_cur_from) as cur,
    (s.sent_at >= v_base_from and s.sent_at < v_cur_from) as base
  from perf_sends s;

  select count(*) filter (where threaded), count(*) filter (where stamp_hit and not threaded)
    into v_threaded, v_stamp from perf_scored;

  with cells as (
    select lane, step,
      count(*) filter (where cur) as n,
      count(*) filter (where cur and (threaded or stamp_hit)) as replies,
      count(*) filter (where cur and intent = 'positive') as positive_n,
      bool_or(cur and intent is not null) as has_intent,
      count(*) filter (where base) as base_n,
      count(*) filter (where base and (threaded or stamp_hit)) as base_replies
    from perf_scored group by lane, step
  ),
  variants as (
    select lane, step, variant,
      count(*) filter (where cur) as n,
      count(*) filter (where cur and (threaded or stamp_hit)) as replies
    from perf_scored group by lane, step, variant
  ),
  splits as (
    select lane, step, dim, value, count(*) as n, count(*) filter (where threaded or stamp_hit) as replies
    from perf_scored, lateral (values ('source', source), ('variant', variant), ('country', country), ('vertical', vertical)) d(dim, value)
    where cur group by lane, step, dim, value
  ),
  tbl as (
    select lane, step, variant, source, country, vertical, count(*) as n,
      count(*) filter (where threaded or stamp_hit) as replies
    from perf_scored group by lane, step, variant, source, country, vertical
  ),
  lanes as (select distinct lane from perf_scored)
  select coalesce(jsonb_agg(jsonb_build_object(
    'lane', l.lane,
    'campaigns', (select coalesce(jsonb_agg(distinct campaign), '[]'::jsonb) from perf_sends where lane = l.lane),
    'cells', (select coalesce(jsonb_agg(jsonb_build_object(
        'step', c.step, 'n', c.n, 'replies', c.replies,
        'rate', case when c.n = 0 then 0 else round(c.replies::numeric / c.n, 4) end,
        'positive_n', c.positive_n,
        'positive_rate', case when c.has_intent and c.n > 0 then round(c.positive_n::numeric / c.n, 4) else null end,
        'base_n', c.base_n, 'base_replies', c.base_replies,
        'base_rate', case when c.base_n = 0 then 0 else round(c.base_replies::numeric / c.base_n, 4) end,
        'status', case when c.n < v_floor or c.base_n < v_floor then 'thin' else 'ok' end
      ) order by c.step), '[]'::jsonb) from cells c where c.lane = l.lane),
    'variants', (select coalesce(jsonb_agg(jsonb_build_object(
        'step', v.step, 'variant', v.variant, 'n', v.n, 'replies', v.replies,
        'rate', case when v.n = 0 then 0 else round(v.replies::numeric / v.n, 4) end,
        'others_n', o.n, 'others_rate', case when o.n = 0 then 0 else round(o.replies::numeric / o.n, 4) end,
        'status', case when v.n < v_floor or o.n < v_floor then 'thin' else 'ok' end
      ) order by v.step, v.n desc), '[]'::jsonb)
      from variants v
      cross join lateral (select coalesce(sum(n), 0) as n, coalesce(sum(replies), 0) as replies
                          from variants w where w.lane = v.lane and w.step = v.step and w.variant <> v.variant) o
      where v.lane = l.lane and v.n > 0),
    'splits', (select coalesce(jsonb_agg(jsonb_build_object(
        'step', s.step, 'dim', s.dim, 'value', s.value, 'n', s.n, 'replies', s.replies,
        'rate', round(s.replies::numeric / s.n, 4)) order by s.step, s.dim, s.n desc), '[]'::jsonb)
      from splits s where s.lane = l.lane),
    'alarms', '[]'::jsonb,
    'table', (select coalesce(jsonb_agg(jsonb_build_object(
        'step', t.step, 'variant', t.variant, 'source', t.source, 'country', t.country, 'vertical', t.vertical,
        'n', t.n, 'replies', t.replies, 'rate', round(t.replies::numeric / t.n, 4)) order by t.step, t.n desc), '[]'::jsonb)
      from tbl t where t.lane = l.lane)
  ) order by l.lane), '[]'::jsonb)
  into v_lanes from lanes l;

  return jsonb_build_object(
    'ok', true, 'client_id', p_client_id, 'days', p_days, 'generated_at', now(),
    'mature_before', v_mature, 'cur_from', v_cur_from, 'base_from', v_base_from,
    'floor', v_floor, 'child_floor', v_child_floor,
    'lanes', v_lanes,
    'reply_basis', jsonb_build_object('threaded', v_threaded, 'stamp_only', v_stamp));
end $$;

revoke all on function outreach_perf_payload(text, int) from public, anon;
grant execute on function outreach_perf_payload(text, int) to authenticated, service_role;
revoke all on function perf_wilson_upper(bigint, bigint) from public, anon;
grant execute on function perf_wilson_upper(bigint, bigint) to authenticated, service_role;
```

The function is `volatile` on purpose: it creates temp tables, which Postgres refuses inside `stable`. PostgREST calls RPCs through POST, so volatility does not change how the page reads it.

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run src/sql/outreachPerf.pglite.test.ts`
Expected: PASS, 5 tests. If PGlite lacks `gen_random_uuid()`, prepend `create extension if not exists pgcrypto;` to the fixture.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json db/069_outreach_perf_payload.sql src/sql/outreachPerf.pglite.test.ts src/sql/fixtures/outreach-perf.sql
git commit -m "feat(outreach-perf): payload RPC counts + PGlite harness

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Drift and sibling alarms with attribution (SQL)

**Files:**
- Modify: `db/069_outreach_perf_payload.sql` (replace `'alarms', '[]'::jsonb` and the two `status` expressions; add four CTEs)
- Modify: `src/sql/outreachPerf.pglite.test.ts` (append tests)

**Model:** `fable`

**Interfaces:**
- Consumes: Task 1's temp table `perf_scored` and CTEs `cells`, `variants`, `splits`.
- Produces: `alarms: [{ kind: 'drift'|'sibling', step, variant: string|null, now_n, now_replies, now_rate, prior_n, prior_rate, gap, suspect_dim: string|null, suspect_share: number|null, split: [{ value, n, replies, rate }] }]`; cell `status` gains `'drift'`; variant `status` gains `'sibling'`.

- [ ] **Step 1: Write the failing tests**

Append to `src/sql/outreachPerf.pglite.test.ts`:

```ts
describe('outreach_perf_payload alarms', () => {
  it('fires drift on RISE cold DM1 and blames source competitor_engagers', async () => {
    const p = await payload('risedtc')
    const cold = lane(p, 'cold')!
    expect(cell(p, 'cold', 'dm1')!.status).toBe('drift')
    const a = cold.alarms.find((x: any) => x.kind === 'drift' && x.step === 'dm1') as any
    expect(a).toBeTruthy()
    expect(a.now_n).toBe(112)
    expect(a.prior_rate).toBeCloseTo(0.16, 3)
    expect(a.suspect_dim).toBe('source')
    expect(a.split.find((s: any) => s.value === 'competitor_engagers')).toMatchObject({ n: 71, replies: 2 })
    expect(a.suspect_share).toBeGreaterThan(0.5)
  })
  it('fires sibling on RISE warm DM1 variant C against B', async () => {
    const p = await payload('risedtc')
    const warm = lane(p, 'warm')!
    expect(warm.variants.find(v => v.variant === 'rise_dm1_c')!.status).toBe('sibling')
    expect(warm.variants.find(v => v.variant === 'rise_dm1_b')!.status).toBe('ok')
    const a = warm.alarms.find((x: any) => x.kind === 'sibling') as any
    expect(a.variant).toBe('rise_dm1_c')
    expect(a.prior_rate).toBeCloseTo(12 / 40, 3)
  })
  it('never fires on a thin cell or a healthy cell', async () => {
    const p = await payload('risedtc')
    expect(cell(p, 'warm', 'nudge')!.status).toBe('thin')
    expect(cell(p, 'warm', 'dm1')!.status).not.toBe('drift')
    const ivan = await payload('ivan')
    expect(cell(ivan, 'cold', 'dm1')!.status).toBe('thin') // no baseline rows
    expect(lane(ivan, 'cold')!.alarms).toEqual([])
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/sql/outreachPerf.pglite.test.ts`
Expected: the 3 new tests FAIL (`status` is `'ok'`, `alarms` empty).

- [ ] **Step 3: Implement alarms in the function**

In `db/069_outreach_perf_payload.sql`, add after the `tbl` CTE and before `lanes`:

```sql
  drift as (
    select c.*, round(c.replies::numeric / c.n, 4) as rate, round(c.base_replies::numeric / c.base_n, 4) as base_rate
    from cells c
    where c.n >= v_floor and c.base_n >= v_floor
      and (c.replies::numeric / c.n) < (c.base_replies::numeric / c.base_n)
      and perf_wilson_upper(c.replies, c.n) < (c.base_replies::numeric / c.base_n)
      and (c.base_replies::numeric / c.base_n) - (c.replies::numeric / c.n) >= 0.03
  ),
  attribution as (
    -- missing replies per child = expected at baseline rate minus observed; the worst child per dim,
    -- then the dim whose worst child explains the largest share of the cell's missing replies.
    -- A child equal to the whole cell (one variant, one country) is skipped: it can only restate the cell.
    select d.lane, d.step, s.dim,
      max((d.base_rate * s.n) - s.replies) as worst_missing
    from drift d join splits s on s.lane = d.lane and s.step = d.step
    where s.n >= v_child_floor and s.n < d.n   -- a child that IS the whole cell explains nothing
    group by d.lane, d.step, s.dim
  ),
  suspect as (
    select distinct on (lane, step) lane, step, dim, worst_missing
    from attribution order by lane, step, worst_missing desc
  ),
  sibling as (
    select v.lane, v.step, v.variant, v.n, v.replies, o.n as others_n, o.replies as others_replies
    from variants v
    cross join lateral (select coalesce(sum(n), 0) as n, coalesce(sum(replies), 0) as replies
                        from variants w where w.lane = v.lane and w.step = v.step and w.variant <> v.variant) o
    where v.n >= v_floor and o.n >= v_floor
      and (v.replies::numeric / v.n) < (o.replies::numeric / o.n)
      and perf_wilson_upper(v.replies, v.n) < (o.replies::numeric / o.n)
      and (o.replies::numeric / o.n) - (v.replies::numeric / v.n) >= 0.03
  ),
```

Replace the cell `status` expression with:

```sql
        'status', case when c.n < v_floor or c.base_n < v_floor then 'thin'
                       when exists (select 1 from drift d where d.lane = c.lane and d.step = c.step) then 'drift'
                       else 'ok' end
```

Replace the variant `status` expression with:

```sql
        'status', case when v.n < v_floor or o.n < v_floor then 'thin'
                       when exists (select 1 from sibling sb where sb.lane = v.lane and sb.step = v.step and sb.variant = v.variant) then 'sibling'
                       else 'ok' end
```

Replace `'alarms', '[]'::jsonb,` with:

```sql
    'alarms', (select coalesce(jsonb_agg(a order by a->>'kind', a->>'step'), '[]'::jsonb) from (
      select jsonb_build_object(
        'kind', 'drift', 'step', d.step, 'variant', null,
        'now_n', d.n, 'now_replies', d.replies, 'now_rate', d.rate,
        'prior_n', d.base_n, 'prior_rate', d.base_rate, 'gap', round(d.base_rate - d.rate, 4),
        'suspect_dim', su.dim,
        'suspect_share', case when su.dim is null or (d.base_rate * d.n - d.replies) <= 0 then null
                              else round(su.worst_missing / (d.base_rate * d.n - d.replies), 4) end,
        'split', case when su.dim is null then '[]'::jsonb else
          (select coalesce(jsonb_agg(jsonb_build_object('value', s.value, 'n', s.n, 'replies', s.replies,
                    'rate', round(s.replies::numeric / s.n, 4)) order by s.n desc), '[]'::jsonb)
           from splits s where s.lane = d.lane and s.step = d.step and s.dim = su.dim) end) as a
      from drift d left join suspect su on su.lane = d.lane and su.step = d.step
      where d.lane = l.lane
      union all
      select jsonb_build_object(
        'kind', 'sibling', 'step', sb.step, 'variant', sb.variant,
        'now_n', sb.n, 'now_replies', sb.replies, 'now_rate', round(sb.replies::numeric / sb.n, 4),
        'prior_n', sb.others_n, 'prior_rate', round(sb.others_replies::numeric / sb.others_n, 4),
        'gap', round(sb.others_replies::numeric / sb.others_n - sb.replies::numeric / sb.n, 4),
        'suspect_dim', 'variant', 'suspect_share', null, 'split', '[]'::jsonb)
      from sibling sb where sb.lane = l.lane
    ) x),
```

- [ ] **Step 4: Run the whole SQL test file**

Run: `npx vitest run src/sql/outreachPerf.pglite.test.ts`
Expected: PASS, 8 tests. Arithmetic check for the drift test: cell 8/112 = 7.1% vs baseline 16.0%, gap 8.9 points, Wilson 80% upper ≈ 10.9% < 16%. Cell missing at baseline = 0.16 × 112 − 8 ≈ 9.9; competitor_engagers child missing = 0.16 × 71 − 2 ≈ 9.4; own_engagers ≈ 0.6; the single-value dims (variant, country, vertical) are excluded because their one child is the whole cell. Share ≈ 0.94, which clears `> 0.5`. Never adjust the SQL to make the fixture fit; if a number is off, the fixture or the SQL has a real bug.

- [ ] **Step 5: Commit**

```bash
git add db/069_outreach_perf_payload.sql src/sql/outreachPerf.pglite.test.ts
git commit -m "feat(outreach-perf): drift + sibling alarms with source attribution

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Apply live and replay against the real corpus

**Files:**
- Create: `scripts/verify-outreach-perf.mjs`
- Create: `db/NOTES-outreach-perf-replay.md`

**Model:** `opus`

**Interfaces:**
- Consumes: `db/069_outreach_perf_payload.sql`; the live RPC `lane_chain_weekly` (its argument shape is read from `Outreach - Connect Cap Watchdog (both seats).workflow.ts:258-295` in the Content System workflows tree).
- Produces: the function live on `bjbvqvzbzczjbatgmccb`; a replay note with per-lane numbers. This task ENDS in a report to Ivan; nothing after it ships until he has seen the numbers.

- [ ] **Step 1: Apply the migration through the Management API**

```bash
cd ~/Desktop/ivan-inbox
RAW=$(security find-generic-password -s "Supabase CLI" -a "supabase" -w)
TOKEN=$(echo "$RAW" | sed 's/^go-keyring-base64://' | base64 -d)
python3 -c "import json;print(json.dumps({'query':open('db/069_outreach_perf_payload.sql').read()}))" > /tmp/req-069.json
curl -s -o /tmp/res-069.json -w '%{http_code}\n' -X POST "https://api.supabase.com/v1/projects/bjbvqvzbzczjbatgmccb/database/query" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" --data-binary @/tmp/req-069.json
cat /tmp/res-069.json
```
Expected: `201` and `[]`. Any other status: read the body, fix the SQL, re-run the PGlite test, re-apply. Never paste the SQL by hand.

- [ ] **Step 2: Confirm grants match the benchmark RPC (control)**

```bash
python3 -c "import json;print(json.dumps({'query':\"select p.proname, r.rolname, has_function_privilege(r.rolname, p.oid, 'execute') as can_exec from pg_proc p join pg_namespace n on n.oid=p.pronamespace cross join pg_roles r where n.nspname='public' and p.proname in ('outreach_perf_payload','audn_benchmark_payload') and r.rolname in ('anon','authenticated','service_role') order by 1,2\"}))" > /tmp/req-grants.json
curl -s -X POST "https://api.supabase.com/v1/projects/bjbvqvzbzczjbatgmccb/database/query" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" --data-binary @/tmp/req-grants.json
```
Expected: both functions `anon=false`, `authenticated=true`, `service_role=true`. If they differ, fix the grants in the SQL file and re-apply.

- [ ] **Step 3: Write the replay script**

`scripts/verify-outreach-perf.mjs`. Read the header of `scripts/verify-ops.mjs` first and take the service key the same way it does; if it reads an env var, keep `SUPABASE_SERVICE_KEY` below, otherwise copy its method.

```js
// Replay the new RPC against the LIVE corpus for all three lanes and cross-check the
// 14-day DM reply rate against lane_chain_weekly. Prints a table; exits 1 on any mismatch
// larger than 5 points (the maturation window explains small gaps; see the replay note).
const SB = 'https://bjbvqvzbzczjbatgmccb.supabase.co/rest/v1'
const KEY = process.env.SUPABASE_SERVICE_KEY
if (!KEY) { console.error('SUPABASE_SERVICE_KEY missing'); process.exit(2) }
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }
const rpc = async (name, body) => {
  const r = await fetch(`${SB}/rpc/${name}`, { method: 'POST', headers: H, body: JSON.stringify(body) })
  if (!r.ok) throw new Error(`${name} ${r.status} ${await r.text()}`)
  return r.json()
}
let bad = 0
for (const lane of ['ivan', 'risedtc', 'arch']) {
  const p = await rpc('outreach_perf_payload', { p_client_id: lane, p_days: 90 })
  console.log(`\n== ${lane} · threaded ${p.reply_basis.threaded} · stamp_only ${p.reply_basis.stamp_only}`)
  for (const l of p.lanes) {
    for (const c of l.cells) console.log(`${l.lane.padEnd(8)} ${c.step.padEnd(6)} now ${c.replies}/${c.n} (${(c.rate * 100).toFixed(1)}%)  prior ${c.base_replies}/${c.base_n} (${(c.base_rate * 100).toFixed(1)}%)  ${c.status}`)
    for (const a of l.alarms) console.log(`  ALARM ${a.kind} ${a.step} ${a.variant ?? ''} ${(a.now_rate * 100).toFixed(1)}% vs ${(a.prior_rate * 100).toFixed(1)}% suspect=${a.suspect_dim ?? 'none'} share=${a.suspect_share ?? '-'}`)
  }
  // cross-check: lane_chain_weekly argument shape copied from the cap watchdog
  const weekly = await rpc('lane_chain_weekly', { p_client_id: lane === 'ivan' ? null : lane })
  if (!Array.isArray(weekly) || !weekly.length) { console.log('  xcheck: lane_chain_weekly returned no rows'); continue }
  if (!('reply_rate' in weekly[0])) { console.log('  xcheck: raw row', JSON.stringify(weekly[0])); continue }
  for (const w of weekly) {
    const c = p.lanes.find(x => x.lane === w.lane)?.cells.find(x => x.step === 'dm1')
    if (!c) continue
    const wr = Number(w.reply_rate ?? 0)
    const diff = Math.abs(wr - c.rate)
    const flag = diff > 0.05 ? 'CHECK' : 'ok'
    if (flag === 'CHECK') bad++
    console.log(`  xcheck ${w.lane}: weekly reply_rate ${(wr * 100).toFixed(1)}% vs payload dm1 ${(c.rate * 100).toFixed(1)}% ${flag}`)
  }
}
process.exit(bad ? 1 : 0)
```

If `lane_chain_weekly` rejects the argument, open the cap watchdog file at the cited lines and copy its exact body. If the raw-row print shows different column names for lane or reply rate, adapt the two field reads and say so in the note.

- [ ] **Step 4: Run the replay**

Run: `SUPABASE_SERVICE_KEY=... node scripts/verify-outreach-perf.mjs | tee db/NOTES-outreach-perf-replay.md`
Expected: three lane blocks. Then write, above the pasted output in the note: (a) replies threaded vs stamp-only per lane, (b) every `CHECK` line and the reason in words (the weekly RPC is cohort-based on accepted and DM'd prospects and is unmatured; a gap the maturation window explains is fine, an unexplained one is a bug), (c) which alarms fired on live data today.

- [ ] **Step 5: Report to Ivan and STOP**

Post the three lane blocks and the fired alarms in chat. Do not start Task 4 until he has seen them. If a lane's numbers are impossible (rate above 1, a known-sending lane at n = 0, an active lane missing), that is a Task 1/2 bug: fix, re-test on PGlite, re-apply, re-run.

- [ ] **Step 6: Commit**

```bash
git add scripts/verify-outreach-perf.mjs db/NOTES-outreach-perf-replay.md
git commit -m "chore(outreach-perf): live replay script + first replay note

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Typed fetch and presentation helpers

**Files:**
- Create: `src/lib/outreachPerf.ts`
- Create: `src/lib/outreachPerf.test.ts`

**Model:** `sonnet`

**Interfaces:**
- Consumes: the RPC shape from Tasks 1-2; `supabase` client from `src/lib/supabase`; `ContentLane` from `src/lib/content`.
- Produces:
  ```ts
  export type PerfCell, PerfVariant, PerfSplit, PerfAlarm, PerfRow, PerfLane, PerfPayload
  export type PerfState = { kind: 'loading' } | { kind: 'failed'; message: string } | { kind: 'empty'; reason: string } | { kind: 'ready'; data: PerfPayload }
  export async function fetchOutreachPerf(lane: ContentLane): Promise<PerfState>
  export function pct(rate: number): string            // 0.0312 → '3.1%'
  export function stepLabel(step: string): string      // dm1 → 'DM1', nudge → 'Nudge', dm3 → 'DM3', inmail → 'InMail'
  export function alarmTitle(lane: string, a: PerfAlarm): string   // 'cold · DM1' or 'warm · DM1 · rise_dm1_c'
  export function alarmLine(a: PerfAlarm): string      // '3.1% now (4 of 128) vs 9.2% prior 60d'
  export function rankAlarms(lanes: PerfLane[]): { lane: string; alarm: PerfAlarm }[]  // drift before sibling, larger gap first
  ```

- [ ] **Step 1: Write the failing tests**

`src/lib/outreachPerf.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
vi.mock('./supabase', () => ({ supabase: {} }))
import { alarmLine, alarmTitle, pct, rankAlarms, stepLabel, type PerfAlarm, type PerfLane } from './outreachPerf'

const drift: PerfAlarm = { kind: 'drift', step: 'dm1', variant: null, now_n: 128, now_replies: 4, now_rate: 0.0312, prior_n: 250, prior_rate: 0.092, gap: 0.0608, suspect_dim: 'source', suspect_share: 0.8, split: [{ value: 'competitor_engagers', n: 71, replies: 2, rate: 0.0282 }] }
const sib: PerfAlarm = { kind: 'sibling', step: 'dm1', variant: 'rise_dm1_c', now_n: 35, now_replies: 1, now_rate: 0.0286, prior_n: 40, prior_rate: 0.3, gap: 0.2714, suspect_dim: 'variant', suspect_share: null, split: [] }

describe('outreachPerf helpers', () => {
  it('formats rates to one decimal', () => { expect(pct(0.0312)).toBe('3.1%'); expect(pct(0)).toBe('0.0%') })
  it('labels steps', () => { expect(stepLabel('dm1')).toBe('DM1'); expect(stepLabel('inmail')).toBe('InMail'); expect(stepLabel('nudge')).toBe('Nudge') })
  it('titles alarms with lane, step and variant when present', () => {
    expect(alarmTitle('cold', drift)).toBe('cold · DM1')
    expect(alarmTitle('warm', sib)).toBe('warm · DM1 · rise_dm1_c')
  })
  it('writes the alarm line with counts', () => {
    expect(alarmLine(drift)).toBe('3.1% now (4 of 128) vs 9.2% prior 60d')
    expect(alarmLine(sib)).toBe('2.9% now (1 of 35) vs 30.0% other variants')
  })
  it('ranks drift before sibling and larger gaps first', () => {
    const lanes = [{ lane: 'warm', alarms: [sib] }, { lane: 'cold', alarms: [drift, { ...drift, step: 'nudge', gap: 0.1 }] }] as unknown as PerfLane[]
    const r = rankAlarms(lanes)
    expect(r.map(x => `${x.lane}:${x.alarm.step}:${x.alarm.kind}`)).toEqual(['cold:nudge:drift', 'cold:dm1:drift', 'warm:dm1:sibling'])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/outreachPerf.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`src/lib/outreachPerf.ts`:

```ts
/* Outreach performance for the Strategy "Outreach" view. Every number comes from ONE
   database function (`outreach_perf_payload`); this file only types it and formats it.
   The alarm math lives in SQL so the weekly WhatsApp digest and this page can never disagree.
   Spec: docs/superpowers/specs/2026-09-16-outreach-performance-alerts-design.md */
import { supabase } from './supabase'
import type { ContentLane } from './content'

export type PerfCell = { step: string; n: number; replies: number; rate: number; positive_n: number; positive_rate: number | null; base_n: number; base_replies: number; base_rate: number; status: 'ok' | 'thin' | 'drift' }
export type PerfVariant = { step: string; variant: string; n: number; replies: number; rate: number; others_n: number; others_rate: number; status: 'ok' | 'thin' | 'sibling' }
export type PerfSplit = { step: string; dim: 'source' | 'variant' | 'country' | 'vertical'; value: string; n: number; replies: number; rate: number }
export type PerfAlarm = { kind: 'drift' | 'sibling'; step: string; variant: string | null; now_n: number; now_replies: number; now_rate: number; prior_n: number; prior_rate: number; gap: number; suspect_dim: string | null; suspect_share: number | null; split: { value: string; n: number; replies: number; rate: number }[] }
export type PerfRow = { step: string; variant: string; source: string; country: string; vertical: string; n: number; replies: number; rate: number }
export type PerfLane = { lane: string; campaigns: string[]; cells: PerfCell[]; variants: PerfVariant[]; splits: PerfSplit[]; alarms: PerfAlarm[]; table: PerfRow[] }
export type PerfPayload = { ok: boolean; client_id: string; days: number; generated_at: string; mature_before: string; cur_from: string; base_from: string; floor: number; child_floor: number; lanes: PerfLane[]; reply_basis: { threaded: number; stamp_only: number } }
export type PerfState = { kind: 'loading' } | { kind: 'failed'; message: string } | { kind: 'empty'; reason: string } | { kind: 'ready'; data: PerfPayload }

export async function fetchOutreachPerf(lane: ContentLane): Promise<PerfState> {
  const { data, error } = await supabase.rpc('outreach_perf_payload', { p_client_id: lane, p_days: 90 })
  if (error) return { kind: 'failed', message: error.message }
  const p = data as PerfPayload | null
  if (!p || p.ok !== true) return { kind: 'failed', message: 'No payload came back.' }
  if (!p.lanes.length) return { kind: 'empty', reason: 'No active lanes with DM sends in the last 90 days.' }
  return { kind: 'ready', data: p }
}

export function pct(rate: number): string { return `${(rate * 100).toFixed(1)}%` }

const STEP: Record<string, string> = { dm1: 'DM1', nudge: 'Nudge', dm3: 'DM3', inmail: 'InMail' }
export function stepLabel(step: string): string { return STEP[step] ?? step }

export function alarmTitle(lane: string, a: PerfAlarm): string {
  return a.variant ? `${lane} · ${stepLabel(a.step)} · ${a.variant}` : `${lane} · ${stepLabel(a.step)}`
}

export function alarmLine(a: PerfAlarm): string {
  const tail = a.kind === 'drift' ? 'prior 60d' : 'other variants'
  return `${pct(a.now_rate)} now (${a.now_replies} of ${a.now_n}) vs ${pct(a.prior_rate)} ${tail}`
}

export function rankAlarms(lanes: PerfLane[]): { lane: string; alarm: PerfAlarm }[] {
  const all = lanes.flatMap(l => l.alarms.map(alarm => ({ lane: l.lane, alarm })))
  const kindRank = (k: PerfAlarm['kind']) => (k === 'drift' ? 0 : 1)
  return all.sort((x, y) => kindRank(x.alarm.kind) - kindRank(y.alarm.kind) || y.alarm.gap - x.alarm.gap)
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/outreachPerf.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/outreachPerf.ts src/lib/outreachPerf.test.ts
git commit -m "feat(outreach-perf): typed fetch + alarm formatting helpers

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: OutreachBlock and Strategy wiring

**Files:**
- Create: `src/wb/content/OutreachBlock.tsx`
- Create: `src/wb/content/OutreachBlock.test.tsx`
- Create: `src/wb/content/outreach-perf.css`
- Modify: `src/wb/content/strategy.tsx:308-316` (view options) and `:325-333` (mount)
- Modify: `src/wb/content/strategy-evidence.css:8` (three columns on phone)

**Model:** `opus`

**Interfaces:**
- Consumes: everything exported from `src/lib/outreachPerf.ts`; `Failed`, `CalmEmpty` from `./parts` (signatures at `parts.tsx:28` and `:57`); `ContentLane`, `LANE_LABEL` from `../../lib/content`.
- Produces: `export function OutreachView({ lane, state, onRetry }: { lane: ContentLane; state: PerfState; onRetry?: () => void })` (pure, testable) and `export function OutreachBlock({ lane }: { lane: ContentLane })` (fetches, then renders `OutreachView`).

- [ ] **Step 1: Write the failing test**

`src/wb/content/OutreachBlock.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
vi.mock('../../lib/supabase', () => ({ supabase: {} }))
import { OutreachView } from './OutreachBlock'
import type { PerfPayload } from '../../lib/outreachPerf'

const drift = { kind: 'drift', step: 'dm1', variant: null, now_n: 128, now_replies: 4, now_rate: 0.0312, prior_n: 250, prior_rate: 0.092, gap: 0.0608, suspect_dim: 'source', suspect_share: 0.8, split: [{ value: 'competitor_engagers', n: 71, replies: 2, rate: 0.0282 }, { value: 'own_engagers', n: 40, replies: 6, rate: 0.15 }] } as const
const payload: PerfPayload = {
  ok: true, client_id: 'risedtc', days: 90, generated_at: '2026-09-16T00:00:00Z', mature_before: '', cur_from: '', base_from: '', floor: 30, child_floor: 15,
  reply_basis: { threaded: 10, stamp_only: 2 },
  lanes: [{
    lane: 'cold', campaigns: ['RiseDTC — Cold (DTC Sales Nav)'],
    cells: [{ step: 'dm1', n: 128, replies: 4, rate: 0.0312, positive_n: 3, positive_rate: 0.0234, base_n: 250, base_replies: 23, base_rate: 0.092, status: 'drift' },
            { step: 'nudge', n: 12, replies: 3, rate: 0.25, positive_n: 0, positive_rate: null, base_n: 0, base_replies: 0, base_rate: 0, status: 'thin' }],
    variants: [{ step: 'dm1', variant: 'rise_dm1_a', n: 128, replies: 4, rate: 0.0312, others_n: 0, others_rate: 0, status: 'thin' }],
    splits: [], alarms: [drift],
    table: [{ step: 'dm1', variant: 'rise_dm1_a', source: 'competitor_engagers', country: 'US', vertical: 'unknown', n: 71, replies: 2, rate: 0.0282 }],
  }],
}

describe('OutreachView', () => {
  it('puts the alarm card before the cells and names the suspect with its split', () => {
    const html = renderToStaticMarkup(<OutreachView lane="risedtc" state={{ kind: 'ready', data: payload }} />)
    expect(html.indexOf('cold · DM1')).toBeLessThan(html.indexOf('Lane and step'))
    expect(html).toContain('3.1% now (4 of 128) vs 9.2% prior 60d')
    expect(html).toContain('Suspect: source')
    expect(html).toContain('competitor_engagers')
    expect(html).toContain('2 of 71')
  })
  it('labels a thin cell too few to call and dashes a missing positive rate', () => {
    const html = renderToStaticMarkup(<OutreachView lane="risedtc" state={{ kind: 'ready', data: payload }} />)
    expect(html).toContain('too few to call')
    expect(html).toContain('no reply classification on this seat')
  })
  it('renders the empty and failed states as words', () => {
    expect(renderToStaticMarkup(<OutreachView lane="arch" state={{ kind: 'empty', reason: 'No active lanes with DM sends in the last 90 days.' }} />)).toContain('No active lanes')
    expect(renderToStaticMarkup(<OutreachView lane="arch" state={{ kind: 'failed', message: 'boom' }} />)).toContain('boom')
  })
  it('keeps the raw table behind a disclosure', () => {
    const html = renderToStaticMarkup(<OutreachView lane="risedtc" state={{ kind: 'ready', data: payload }} />)
    expect(html.indexOf('<details')).toBeLessThan(html.indexOf('competitor_engagers</td>'))
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/wb/content/OutreachBlock.test.tsx`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the block**

`src/wb/content/outreach-perf.css`:

```css
/* Outreach performance view. .ct-card is a 4-column anchor grid (faithful.css §7.1);
   every card here opts out with display:block or its children auto-place into columns. */
.a-op-card { display: block; padding: 12px 14px; border-radius: 12px; background: var(--ds-surface-2, rgba(127,127,127,.08)); margin-bottom: 10px; }
.a-op-card.a-op-alarm { border-left: 3px solid var(--ds-danger, #d9534f); }
.a-op-h { font-weight: 600; margin-bottom: 4px; }
.a-op-line { font-variant-numeric: tabular-nums; }
.a-op-split { margin: 6px 0 0; padding: 0; list-style: none; font-variant-numeric: tabular-nums; }
.a-op-split li { display: flex; justify-content: space-between; gap: 12px; padding: 2px 0; }
.a-op-tiles { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-bottom: 8px; }
.a-op-tile { display: block; padding: 10px 12px; border-radius: 10px; background: var(--ds-surface-2, rgba(127,127,127,.08)); }
.a-op-tile .a-op-rate { font-size: 1.25rem; font-weight: 600; font-variant-numeric: tabular-nums; }
.a-op-tile.is-drift .a-op-rate { color: var(--ds-danger, #d9534f); }
.a-op-tile.is-thin { opacity: .7; }
.a-op-table { width: 100%; border-collapse: collapse; font-size: .85rem; font-variant-numeric: tabular-nums; }
.a-op-table th, .a-op-table td { text-align: left; padding: 4px 6px; border-bottom: 1px solid rgba(127,127,127,.2); white-space: nowrap; }
.a-op-scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; }
```

`src/wb/content/OutreachBlock.tsx`:

```tsx
import { useCallback, useEffect, useState } from 'react'
import { Failed, CalmEmpty } from './parts'
import { alarmLine, alarmTitle, fetchOutreachPerf, pct, rankAlarms, stepLabel, type PerfLane, type PerfPayload, type PerfState } from '../../lib/outreachPerf'
import { LANE_LABEL, type ContentLane } from '../../lib/content'
import './content.css'
import './outreach-perf.css'

function Alarms({ p }: { p: PerfPayload }) {
  const ranked = rankAlarms(p.lanes)
  if (!ranked.length) return <div className="a-op-card"><div className="a-op-h">Nothing off</div><div className="a-ct-sub">No lane or variant is below its comparator at the {p.floor}-send floor. Cells under the floor are listed below as too few to call.</div></div>
  return <>{ranked.map(({ lane, alarm }, i) => (
    <div className="a-op-card a-op-alarm" key={`${lane}-${alarm.kind}-${alarm.step}-${alarm.variant ?? ''}-${i}`}>
      <div className="a-op-h">{alarmTitle(lane, alarm)}</div>
      <div className="a-op-line">{alarmLine(alarm)}</div>
      {alarm.kind === 'drift' && (alarm.suspect_dim
        ? <>
            <div className="a-ct-sub">Suspect: {alarm.suspect_dim}</div>
            <ul className="a-op-split">{alarm.split.map(s => <li key={s.value}><span>{s.value}</span><span>{s.replies} of {s.n} ({pct(s.rate)})</span></li>)}</ul>
          </>
        : <div className="a-ct-sub">Spread evenly across sources and variants at this volume.</div>)}
      {alarm.kind === 'sibling' && <div className="a-ct-sub">This variant sits below its siblings in the same lane and step. Copy stays as it is until you change it.</div>}
    </div>
  ))}</>
}

function Cells({ l }: { l: PerfLane }) {
  return <div className="a-op-tiles">{l.cells.map(c => (
    <div className={`a-op-tile is-${c.status}`} key={c.step}>
      <div className="a-ct-sub">{l.lane} · {stepLabel(c.step)}</div>
      <div className="a-op-rate">{pct(c.rate)}</div>
      <div className="a-ct-sub">{c.replies} of {c.n} · prior {c.base_n ? pct(c.base_rate) : 'none'}</div>
      <div className="a-ct-sub">{c.status === 'thin' ? 'too few to call' : c.positive_rate === null ? 'positive: no reply classification on this seat' : `positive ${pct(c.positive_rate)}`}</div>
    </div>
  ))}</div>
}

function Variants({ l }: { l: PerfLane }) {
  if (!l.variants.length) return null
  return <ul className="a-op-split">{l.variants.map(v => (
    <li key={`${v.step}-${v.variant}`}><span>{stepLabel(v.step)} · {v.variant}{v.status === 'sibling' ? ' · below siblings' : v.status === 'thin' ? ' · too few to call' : ''}</span><span>{v.replies} of {v.n} ({pct(v.rate)})</span></li>
  ))}</ul>
}

function RawTable({ p }: { p: PerfPayload }) {
  const rows = p.lanes.flatMap(l => l.table.map(r => ({ lane: l.lane, ...r })))
  return <div className="a-op-scroll"><table className="a-op-table">
    <thead><tr><th>Lane</th><th>Step</th><th>Variant</th><th>Source</th><th>Country</th><th>Vertical</th><th>Sent</th><th>Replies</th><th>Rate</th></tr></thead>
    <tbody>{rows.map((r, i) => <tr key={i}><td>{r.lane}</td><td>{stepLabel(r.step)}</td><td>{r.variant}</td><td>{r.source}</td><td>{r.country}</td><td>{r.vertical}</td><td>{r.n}</td><td>{r.replies}</td><td>{pct(r.rate)}</td></tr>)}</tbody>
  </table></div>
}

export function OutreachView({ lane, state, onRetry }: { lane: ContentLane; state: PerfState; onRetry?: () => void }) {
  if (state.kind === 'failed') return <Failed what={`${LANE_LABEL[lane]} outreach performance`} message={state.message} onRetry={onRetry ?? (() => {})} loadedAt={null} />
  if (state.kind === 'loading') return <div className="a-ct-sub a-strat-hold">Loading…</div>
  if (state.kind === 'empty') return <CalmEmpty line={state.reason} loadedAt={null} />
  const p = state.data
  return <>
    <div className="a-ct-sub">DM sends only, active lanes only. A send counts 7 days after it went out. Current window is the last 14 matured days against the 60 days before. Floor {p.floor} sends per cell. Reply basis: {p.reply_basis.threaded} threaded, {p.reply_basis.stamp_only} by thread stamp.</div>
    <Alarms p={p} />
    <div className="a-bm-h">Lane and step</div>
    {p.lanes.map(l => <div key={l.lane}><Cells l={l} /><Variants l={l} /></div>)}
    <details className="a-strategy-disclosure"><summary>All cells ({p.lanes.reduce((n, l) => n + l.table.length, 0)})</summary><RawTable p={p} /></details>
  </>
}

export function OutreachBlock({ lane }: { lane: ContentLane }) {
  const [state, setState] = useState<PerfState>({ kind: 'loading' })
  const load = useCallback(() => { setState({ kind: 'loading' }); void fetchOutreachPerf(lane).then(setState) }, [lane])
  useEffect(() => { load() }, [load])
  return <OutreachView lane={lane} state={state} onRetry={load} />
}
```

Check `Failed` and `CalmEmpty` prop names against `parts.tsx:28` and `:57` before running; adapt the two calls if a prop is named differently, never the parts file.

- [ ] **Step 4: Wire the view**

In `src/wb/content/strategy.tsx`, add to the imports:

```ts
import { OutreachBlock } from './OutreachBlock'
```

In the `Segmented` options at lines 308-316, add after the `competitors` entry:

```ts
          { id: 'outreach', label: 'Outreach' },
```

After the `{view === 'competitors' && ...}` line (333), add:

```tsx
        {view === 'outreach' && <div key={`${lane}-${refreshTick}`} className="a-strategy-panel"><OutreachBlock lane={lane} /></div>}
```

If `view` is typed as a string union, extend that union with `'outreach'` where it is declared (search `useState<` near the top of the component).

In `src/wb/content/strategy-evidence.css` line 8, change `repeat(2, minmax(0, 1fr))` to `repeat(3, minmax(0, 1fr))` so five pills sit in two rows on a phone.

- [ ] **Step 5: Run tests, lint, build**

Run: `npx vitest run && npm run lint && npm run build`
Expected: all green except the pre-existing failure noted in the Strategy tab memory (`src/lib/calendarItems.test.ts:295`); confirm it fails identically on `main` (`git stash; npx vitest run src/lib/calendarItems.test.ts; git stash pop`) and leave it alone.

- [ ] **Step 6: Playwright at 390px**

Read the header of `scripts/dev-login.mjs` for the dev URL and where it stores the auth state, then:

```bash
cd ~/Desktop/ivan-inbox && (npm run dev -- --port 5177 &) && sleep 4
node scripts/dev-login.mjs
node -e "
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const c = await b.newContext({ viewport: { width: 390, height: 844 }, storageState: process.env.AUTH_STATE });
  const p = await c.newPage(); await p.goto('http://localhost:5177/#exp/v2/strategy');
  await p.getByText('Outreach', { exact: true }).click();
  await p.waitForTimeout(1500);
  await p.screenshot({ path: 'out/outreach-390-risedtc.png', fullPage: true });
  const narrow = await p.evaluate(() => [...document.querySelectorAll('.a-op-card, .a-op-tile')].filter(e => e.getBoundingClientRect().width < 100).length)
  console.log('narrow cards:', narrow)
  await b.close();
})()"
```
Set `AUTH_STATE` to the path the login helper writes. Expected: `narrow cards: 0` and a screenshot in `out/`. LOOK at the PNG before calling it done (visual review is a seat).

- [ ] **Step 7: Commit**

```bash
git add src/wb/content/OutreachBlock.tsx src/wb/content/OutreachBlock.test.tsx src/wb/content/outreach-perf.css src/wb/content/strategy.tsx src/wb/content/strategy-evidence.css
git commit -m "feat(strategy): Outreach view with drift and sibling alarms

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Weekly WhatsApp digest workflow (n8n)

**Files:**
- Create: `/Users/ivanmanfredi/Desktop/Ivan - Content System/workflows/default/Outreach - Perf Alerts (weekly).workflow.ts`

**Model:** `opus`

**Interfaces:**
- Consumes: the live RPC `outreach_perf_payload`; secrets pattern and `wa()` helper copied from `Outreach - Connect Cap Watchdog (both seats).workflow.ts:106-193` (Secrets httpRequest node with header auth id `t1bLYmYDohgKdXwM`, `EVO_URL`, `EVO_KEY = _S.wa_evolution_apikey`, `WA_NUMBER`).
- Produces: one WhatsApp message per fired alarm, prefixed `[RISE]` / `[ARCH]` / no prefix for Ivan, every Monday 08:00 Europe/Warsaw; a webhook `perf-alerts-now` for a forced run.

- [ ] **Step 1: Read the protocol and the template nodes**

Read `docs/agent-runtime/n8n-workflow-protocol.md` in the Content System tree in full (mandatory before any n8n edit). Then read lines 56-200 of the cap watchdog file to copy the trigger, webhook, Secrets and Secrets Passthrough node blocks exactly.

- [ ] **Step 2: Run the schema checks**

```bash
cd "/Users/ivanmanfredi/Desktop/Ivan - Content System"
npx --yes n8nac list | grep -i "perf alerts" || echo "not there yet"
npx --yes n8nac skills node-info scheduleTrigger | head -40
npx --yes n8nac skills node-info code | head -20
```

- [ ] **Step 3: Write the workflow file**

Node layout (mirror the watchdog's shapes): `Monday 08:00 Warsaw` (scheduleTrigger 1.2, cron `0 8 * * 1`, timezone Europe/Warsaw) and `Webhook Perf Alerts Now` (webhook 2, path `perf-alerts-now`, POST) both → `Secrets` (httpRequest 4.2, same URL and header auth as the watchdog's Secrets node) → `Secrets Passthrough` (code 2, same body as the watchdog's) → `Digest` (code 2):

```js
const _S = $input.first().json;
const SB = 'https://bjbvqvzbzczjbatgmccb.supabase.co/rest/v1';
const KEY = _S.n8n_sb_key;
const H = { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' };
const EVO_URL = 'https://n8n.ivanmanfredi.com/webhook/wa-relay?src=STVFQSs7tZpnZI2L';
const EVO_KEY = _S.wa_evolution_apikey;
const WA_NUMBER = '5491159385939@s.whatsapp.net';
const wa = (text) => this.helpers.httpRequest({ method: 'POST', url: EVO_URL, headers: { apikey: EVO_KEY, 'Content-Type': 'application/json' }, body: { number: WA_NUMBER, text, options: { delay: 1000 } }, json: true, timeout: 30000 });
const rpc = (client) => this.helpers.httpRequest({ method: 'POST', url: SB + '/rpc/outreach_perf_payload', headers: H, body: { p_client_id: client, p_days: 90 }, json: true, timeout: 60000 });
const pct = (r) => (r * 100).toFixed(1) + '%';
const STEP = { dm1: 'DM1', nudge: 'Nudge', dm3: 'DM3', inmail: 'InMail' };
const PREFIX = { ivan: '', risedtc: '[RISE] ', arch: '[ARCH] ' };
const out = [];
for (const client of ['ivan', 'risedtc', 'arch']) {
  let p;
  try { p = await rpc(client); }
  catch (e) { await wa('[perf] RPC failed for ' + client + ': ' + String(e && e.message || e).slice(0, 160)); out.push({ client, error: true }); continue; }
  for (const l of (p && p.lanes) || []) {
    for (const a of l.alarms || []) {
      const title = PREFIX[client] + l.lane + ' · ' + (STEP[a.step] || a.step) + (a.variant ? ' · ' + a.variant : '');
      const tail = a.kind === 'drift' ? 'prior 60d' : 'other variants';
      let text = title + '\n' + pct(a.now_rate) + ' now (' + a.now_replies + ' of ' + a.now_n + ') vs ' + pct(a.prior_rate) + ' ' + tail;
      if (a.kind === 'drift') {
        text += a.suspect_dim ? '\nSuspect: ' + a.suspect_dim + '\n' + (a.split || []).map(s => '  ' + s.value + '  ' + s.replies + ' of ' + s.n + ' (' + pct(s.rate) + ')').join('\n')
                              : '\nSpread evenly across sources and variants at this volume.';
      }
      text += '\nAlert only. Nothing was changed.';
      await wa(text);
      out.push({ client, lane: l.lane, kind: a.kind, step: a.step, variant: a.variant || null });
    }
  }
}
return [{ json: { sent: out.length, alarms: out, at: new Date().toISOString() } }];
```

Write the `@workflow({ name: 'Outreach - Perf Alerts (weekly)', active: false })` file with these five nodes, routing `Monday.out(0)` and `Webhook.out(0)` both to `Secrets.in(0)`, then `Secrets → SecretsPassthrough → Digest`.

- [ ] **Step 4: Validate, push inactive, verify**

```bash
cd "/Users/ivanmanfredi/Desktop/Ivan - Content System"
npx --yes n8nac skills validate "workflows/default/Outreach - Perf Alerts (weekly).workflow.ts"
npx --yes n8nac push "workflows/default/Outreach - Perf Alerts (weekly).workflow.ts" --verify
npx --yes n8nac list | grep -i "perf alerts"
```
Expected: validate clean, push stamps an id into the file, `list` shows it inactive. Record the id.

- [ ] **Step 5: Forced run**

```bash
npx --yes n8nac workflow activate <id>
npx --yes n8nac test <id> --prod
npx --yes n8nac execution list --workflow-id <id> --limit 1 --json
```
Expected: exit 0, execution `success`, and `sent` equals the number of alarms the Task 3 replay listed. Zero alarms in the replay means zero WhatsApp messages and `sent: 0`; that is a pass. A Class A error (missing secret) is a config gap: report it, do not edit code.

- [ ] **Step 6: Leave it active only if the forced run was clean**

If anything was wrong, `npx --yes n8nac workflow deactivate <id>` and fix. A cron on `active:true` is armed (standing rule).

- [ ] **Step 7: Record**

Append one line to `db/NOTES-outreach-perf-replay.md` in ivan-inbox: workflow name, id, active state, forced-run execution id and `sent` count. Commit:

```bash
cd ~/Desktop/ivan-inbox && git add db/NOTES-outreach-perf-replay.md && git commit -m "chore(outreach-perf): weekly WhatsApp digest wired (n8n id in note)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Ship the view

**Files:**
- None new. Branch merge and deploy.

**Model:** `sonnet`

- [ ] **Step 1: Final whole-branch review** is done by the controller at `fable` (model-routing rule) before this task runs.

- [ ] **Step 2: Merge and push**

```bash
cd ~/Desktop/ivan-inbox
git checkout main && git merge --no-ff outreach-perf -m "Merge outreach-perf: Strategy Outreach view + weekly digest

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push origin main
```
Main carries unrelated uncommitted edits in `src/lib/campaignControl*`; they stay uncommitted and untouched.

- [ ] **Step 3: Verify the live page, not the clone**

Wait for the Pages deploy, then load the live inbox at phone width, open Strategy → Outreach on each lane, and screenshot. Check the served bundle's `last-modified` is after the push (the 09-09 stale-push memory). Post the three screenshots.

- [ ] **Step 4: Memory**

Update `~/.claude/projects/-Users-ivanmanfredi-Desktop-Ivan---Content-System/memory/outreach-perf-alerts-strategy-view-2026-09-16.md`: status shipped, n8n id, first live alarms, and any replay surprise (threaded vs stamp ratio, `lane_chain_weekly` gaps). Change its MEMORY.md line from "AWAITS IVAN go" to "LIVE".
