import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'

const migration = readFileSync('db/206_editorial_collector_observations.sql', 'utf8')
const rollback = readFileSync('db/206_editorial_collector_observations_rollback.sql', 'utf8')
const sql105 = readFileSync('db/105_editorial_brief_contract.sql', 'utf8')
const productionReaders = JSON.parse(readFileSync('src/sql/fixtures/editorial-readers-production.json', 'utf8')) as {
  functions: Array<{ proname: string, definition: string, sha256: string }>
}

function laneAllowedSlice(): string {
  const src = readFileSync('db/088_lane_allowed.sql', 'utf8')
  const start = src.indexOf('create or replace function public.lane_allowed')
  const tail = 'grant execute on function public.lane_allowed(text) to service_role;'
  const end = src.indexOf(tail)
  if (start < 0 || end < 0) throw new Error('lane_allowed marker not found')
  return src.slice(start, end + tail.length)
}

async function db() {
  const d = new PGlite()
  await d.exec(`
    create role anon; create role authenticated; create role service_role;
    create table public.client_registry(client_id text primary key,display_name text,is_active boolean,platform jsonb);
    create function public.operator_gate_ok(p_gate text) returns boolean language sql stable
      as $$select coalesce(p_gate,'')='clientops'$$;
    create table audn_post_metric_snapshots(
      id bigint generated always as identity primary key, client_id text not null,
      post_social_id text not null, cycle_id text not null, captured_at timestamptz not null,
      target_age_days integer, actual_age_days numeric, impressions integer, reactions integer,
      comments integer, shares integer, source text, coverage jsonb, created_at timestamptz default now(),
      unique(client_id,post_social_id,cycle_id));
    create view audn_snapshot_eligibility_v as select s.id,s.client_id,s.post_social_id,s.cycle_id,
      s.captured_at, case when post_social_id like 'unresolved%' then null::timestamptz else
      s.captured_at - interval '7 days' end published_at,s.actual_age_days,s.actual_age_days declared_actual_age_days,
      s.target_age_days,s.target_age_days declared_target_age_days,s.impressions,s.reactions,s.comments,s.shares,
      s.source,s.coverage,true age_ok,true eligible_for_rank,
      case when post_social_id like 'unresolved%' then null else 'urn:li:activity:'||post_social_id end canonical_post_id,
      case when post_social_id like 'unresolved%' then 'unresolved' else 'exact' end resolution_status,
      case when post_social_id like 'unresolved%' then 'no_identity_candidate' else null end unresolved_reason
      from audn_post_metric_snapshots s;
  `)
  await d.exec(laneAllowedSlice())
  await d.exec(sql105)
  await d.exec(`insert into public.client_registry(client_id,display_name,is_active,platform) values
    ('ivan','Ivan',true,'{"measurement":{"roster":[{"account":"ivan"}]}}'),
    ('risedtc','RISE',true,'{"measurement":{"roster":[{"account":"rise"}]}}'),
    ('arch','ARCH',true,'{"measurement":{"roster":[{"account":"arch"}]}}')`)
  for (const reader of productionReaders.functions) await d.exec(reader.definition)
  await d.exec(migration)
  return d
}

async function put(d: PGlite, client: string, post: string, cycle: string, impressions: number | null,
  coverage = true, source = 'n8n:XMuGMZJlcF9pB3Db:own_post_performance_tracker', captured = '2026-09-10T00:00:00Z') {
  await d.query(`insert into audn_post_metric_snapshots
    (client_id,post_social_id,cycle_id,captured_at,impressions,reactions,comments,shares,source,coverage)
    values ($1,$2,$3,$4,$5,0,0,0,$6,jsonb_build_object('impressions',$7::boolean))`,
  [client, post, cycle, captured, impressions, source, coverage])
}

describe('206 retained collector observations', { timeout: 30_000 }, () => {
  it('freezes the exact read-only production reader definitions and raw hashes', () => {
    const expected: Record<string, string> = {
      editorial_brief_json: '140767c6ec7b599388457288e8b02c9e8cf530a4bee050079e9cd381d522963a',
      editorial_read_brief: '5103332284502f0f582d1f9e5fd934adfe6287f83b19d63ee705b76482af0e8e',
      editorial_read_brief_outcomes: '2dc5a4a8ea470b2b3e720748e9ec2b5292567453c8a566cd507380cd6677e4c8',
      editorial_read_briefs: '4a7154bbc9653a703c9cd6c7c3bb8d06096b1514c17d11e709d66b27d20e9d1a',
    }
    expect(Object.fromEntries(productionReaders.functions.map(fn => [fn.proname,
      createHash('sha256').update(fn.definition).digest('hex')]))).toEqual(expected)
  })
  it('locks the collector row before eligibility and conflict reads', async () => {
    const d = await db()
    const fn = await d.query<{ definition: string }>(`select pg_get_functiondef('public.editorial_project_audn_capture(bigint)'::regprocedure) definition`)
    const body = fn.rows[0].definition
    expect(body.indexOf('for update')).toBeGreaterThan(0)
    expect(body.indexOf('for update')).toBeLessThan(body.indexOf('select * into r'))
    expect(body.indexOf('for update')).toBeLessThan(body.indexOf('editorial_observation_conflicts c'))
    await d.exec('begin')
    await put(d, 'ivan', 'locked-p1', 'c1', 7)
    await d.exec(`update audn_post_metric_snapshots set impressions=70 where post_social_id='locked-p1'`)
    expect((await d.query(`select * from editorial_eligible_outcome_snapshots_v`)).rows).toHaveLength(0)
    await d.exec('rollback')
  })

  it('routes refresh manifest and runtime reads through the shared eligible view', () => {
    expect(readFileSync('db/106_editorial_refresh.sql', 'utf8')).toContain('from public.editorial_eligible_outcome_snapshots_v')
    expect(readFileSync('supabase/functions/editorial-refresh/index.ts', 'utf8'))
      .toContain("readFrozen('editorial_eligible_outcome_snapshots_v'")
  })
  it('projects true zero, preserves capture time, and exact replay is a no-op', async () => {
    const d = await db(); await d.exec(migration); await put(d,'ivan','p1','c1',0)
    await d.exec(`update audn_post_metric_snapshots set impressions=0 where client_id='ivan' and post_social_id='p1'`)
    const o = await d.query<any>(`select * from editorial_outcome_snapshots`)
    expect(o.rows).toHaveLength(1); expect(Number(o.rows[0].observed_value)).toBe(0)
    expect(o.rows[0].captured_at.toISOString()).toBe('2026-09-10T00:00:00.000Z')
    expect((await d.query(`select * from editorial_observation_conflicts`)).rows).toHaveLength(0)
  })

  it('quarantines conflicting replay, preserves first value, and vetoes eligibility', async () => {
    const d = await db()
    await d.exec(`insert into public.editorial_input_manifests
      (client_id,input_manifest_hash,source_cutoff,direction_version,decision_cutoff)
      values ('risedtc',repeat('b',64),now(),'direction-1',now());
      insert into public.editorial_batches(client_id,batch_id,status,input_manifest_hash,completed_at)
      values ('risedtc','batch-1','complete',repeat('b',64),now());
      insert into public.editorial_brief_versions
      (client_id,brief_id,version,batch_id,kind,content_hash,source_cutoff,direction_version,payload)
      values ('risedtc','retrospective:urn:li:activity:p2',1,'batch-1','post',repeat('a',64),now(),'direction-1','{}')`)
    await put(d,'risedtc','p2','c1',12)
    await d.exec(`update audn_post_metric_snapshots set impressions=99 where client_id='risedtc' and post_social_id='p2'`)
    expect(Number((await d.query<any>(`select impressions from audn_post_metric_snapshots`)).rows[0].impressions)).toBe(12)
    expect((await d.query(`select * from editorial_observation_conflicts`)).rows).toHaveLength(1)
    expect((await d.query<any>(`select eligibility_veto_reason from editorial_observation_projection`)).rows[0].eligibility_veto_reason)
      .toBe('conflicting_source_replay')
    expect((await d.query(`select * from editorial_eligible_outcome_snapshots_v`)).rows).toHaveLength(0)
    const read = await d.query<any>(`select editorial_read_brief_outcomes('clientops','risedtc','retrospective:urn:li:activity:p2') value`)
    expect(read.rows[0].value.observations).toEqual([])
    const brief = await d.query<any>(`select editorial_read_brief('clientops','risedtc','retrospective:urn:li:activity:p2',1) value`)
    expect(brief.rows[0].value.brief.decisions_links.observed_outcomes).toEqual([])
    const list = await d.query<any>(`select editorial_read_briefs('clientops','risedtc','batch-1',null,20) value`)
    expect(list.rows[0].value.items[0].decisions_links.observed_outcomes).toEqual([])
    await d.exec(rollback)
    const afterRollback = await d.query<any>(`select editorial_read_brief_outcomes('clientops','risedtc','retrospective:urn:li:activity:p2') value`)
    expect(afterRollback.rows[0].value.observations).toEqual([])
    const listAfterRollback = await d.query<any>(`select editorial_read_briefs('clientops','risedtc','batch-1',null,20) value`)
    expect(listAfterRollback.rows[0].value.items[0].decisions_links.observed_outcomes).toEqual([])
  })

  it('keeps missing distinct from zero and excludes unresolved/unreviewed source scope', async () => {
    const d = await db()
    await put(d,'arch','missing','c1',null,false)
    await put(d,'arch','unresolved-x','c2',4)
    await put(d,'arch','p3','c3',4,true,'n8n:query-video-shorts:synthetic')
    await put(d,'arch','p4','c4',4,true,'n8n:unknown:plausible')
    const rows = (await d.query<any>(`select observed_value,unknown_reason,event_definition from editorial_outcome_snapshots order by snapshot_id`)).rows
    expect(rows.map(r => r.observed_value)).toEqual([null,null,null,null])
    expect(rows.map(r => r.unknown_reason).sort()).toEqual(['impressions_not_retained_by_source','no_identity_candidate','unreviewed_source_scope','unreviewed_source_scope'].sort())
    expect(rows.every(r => r.event_definition === 'linkedin_impressions_at_captured_time_v1')).toBe(true)
  })

  it('persists a conflict that arrives before projection and vetoes the later backfill', async () => {
    const d = await db()
    await d.exec(`alter table audn_post_metric_snapshots disable trigger editorial_audn_project_insert`)
    await put(d,'risedtc','preproject','c1',12)
    await d.exec(`update audn_post_metric_snapshots set impressions=99 where post_social_id='preproject'`)
    expect((await d.query(`select * from editorial_observation_projection`)).rows).toHaveLength(0)
    await d.exec(`alter table audn_post_metric_snapshots enable trigger editorial_audn_project_insert`)
    await d.exec(`select editorial_project_audn_capture(1)`)
    expect((await d.query(`select * from editorial_eligible_outcome_snapshots_v`)).rows).toHaveLength(0)
    expect((await d.query<any>(`select eligibility_veto_reason from editorial_observation_projection`)).rows[0].eligibility_veto_reason)
      .toBe('conflicting_source_replay')
  })

  it('isolates tenant identity, accepts late captures as retained but not fabricated, and rolls back without snapshots', async () => {
    const d = await db(); await put(d,'ivan','same','c1',5,true,undefined,'2026-09-20T00:00:00Z')
    await put(d,'arch','same','c1',6,true,undefined,'2026-09-21T00:00:00Z')
    expect((await d.query(`select distinct client_id from editorial_outcome_snapshots`)).rows).toHaveLength(2)
    await d.exec(`update audn_post_metric_snapshots set impressions=8 where client_id='ivan'`)
    await d.exec(rollback)
    expect((await d.query(`select * from editorial_outcome_snapshots`)).rows).toHaveLength(2)
    expect((await d.query(`select * from editorial_observation_conflicts`)).rows).toHaveLength(1)
    expect((await d.query(`select * from editorial_eligible_outcome_snapshots_v where client_id='ivan'`)).rows).toHaveLength(0)
  })
})
