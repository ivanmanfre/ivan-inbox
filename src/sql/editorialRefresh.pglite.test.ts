import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { normalizeCollectorRow } from '../lib/editorialCollectorBridge'

const sql105 = readFileSync('db/105_editorial_brief_contract.sql', 'utf8')
const sql106 = readFileSync('db/106_editorial_refresh.sql', 'utf8')
const src088 = readFileSync('db/088_lane_allowed.sql', 'utf8')
const start = src088.indexOf('create or replace function public.lane_allowed')
const tail = 'grant execute on function public.lane_allowed(text) to service_role;'
const laneSlice = src088.slice(start, src088.indexOf(tail) + tail.length)

async function setup() {
  const db = new PGlite()
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table public.client_registry (client_id text primary key, display_name text, is_active boolean, platform jsonb);
    create or replace function public.operator_gate_ok(p_gate text) returns boolean language sql stable
      as $$ select coalesce(p_gate,'')='clientops' $$;`)
  await db.exec(laneSlice)
  await db.exec(sql105)
  await db.exec(sql106)
  await db.exec(sql106)
  await db.exec(`insert into public.client_registry(client_id,display_name,is_active,platform) values
    ('ivan','Ivan',true,'{"measurement":{"roster":[{"account":"ivan"}]}}'),
    ('risedtc','RISE',true,'{"measurement":{"roster":[{"account":"rise"}]}}')`)
  return db
}

describe('106 editorial refresh transaction', { timeout: 60_000 }, () => {
  it('links only exact owned original-call quotes, never a foreign call by native ID alone', async () => {
    const db = await setup()
    await db.exec(`create table public.transcripts(id uuid primary key,source text,fireflies_id text,date timestamptz,
      transcript_text text,transcript_json jsonb,participants text[]);
      create table public.lm_idea_candidates(id uuid primary key,source text,source_ref text,evidence jsonb);
      create table public.client_ideas(id uuid primary key,client_id text,source_label text,meta jsonb,
        score_breakdown jsonb);`)
    await db.exec(`insert into public.transcripts values
      ('ba816f0c-03b9-4591-94db-fa12b4724272','ivan-listener','ivan-listener-1789745655229',
       '2026-09-18','The founder said exact verified words in the call.','{}','{"Private Founder"}'),
      ('bc5050d1-3a98-49ce-92d0-ae73393f6cfe','fathom-risedtc',null,
       '2026-09-17','The RISE buyer said separate verified words.','{"recording_id":"184202305"}','{"Private RISE Buyer"}');
      insert into public.lm_idea_candidates values
      ('9fd495db-16e2-4c27-8c94-23ed94a31604','ivan_call','ivan-listener-1789745655229',
       '[{"quote":"exact verified words"}]'),
      ('99abbfdd-36a3-4de1-a2fc-d049058add72','calls','bc5050d1-3a98-49ce-92d0-ae73393f6cfe',
       '[{"quote":"separate verified words"}]');
      insert into public.client_ideas values
      ('b17d9050-29ac-465e-81ea-3f1450cba27a','risedtc','From your sales calls',
       '{"source_ts":"184202305|2026-09-17T18:13:22Z"}',
       '{"why":"separate verified words"}');`)
    const ids = ['9fd495db-16e2-4c27-8c94-23ed94a31604', '99abbfdd-36a3-4de1-a2fc-d049058add72']
    const ivan = await db.query<{ candidate_id: string; transcript_id: string }>(`select candidate_id,transcript_id
      from public.editorial_linked_call_passages('clientops','ivan',$1)`, [ids])
    expect(ivan.rows).toEqual([{ candidate_id: ids[0], transcript_id: 'ba816f0c-03b9-4591-94db-fa12b4724272' }])
    const rise = await db.query<{ candidate_id: string }>(`select candidate_id from
      public.editorial_linked_call_passages('clientops','risedtc',$1)`, [[
        'b17d9050-29ac-465e-81ea-3f1450cba27a']])
    expect(rise.rows).toEqual([{ candidate_id: 'b17d9050-29ac-465e-81ea-3f1450cba27a' }])
  })
  it('requires explicit direction; deduplicates requests and unchanged inputs; preserves usable pointer after empty output', async () => {
    const db = await setup()
    const lease1 = await db.query<{ v: boolean }>(`select public.editorial_claim_bridge('clientops','ivan','first') v`)
    const lease2 = await db.query<{ v: boolean }>(`select public.editorial_claim_bridge('clientops','ivan','second') v`)
    expect(lease1.rows[0].v).toBe(true)
    expect(lease2.rows[0].v).toBe(false)
    await db.query(`select public.editorial_release_bridge('clientops','ivan','first')`)
    const lease3 = await db.query<{ v: boolean }>(`select public.editorial_claim_bridge('clientops','ivan','second') v`)
    expect(lease3.rows[0].v).toBe(true)
    await db.query(`select public.editorial_release_bridge('clientops','ivan','second')`)
    const denied = await db.query<{ result: any }>(`select public.editorial_begin_refresh('clientops','ivan','draft-note','r0') result`)
    expect(denied.rows[0].result.conflict.reason).toBe('stale_direction_version')
    const adopted = await db.query<{ result: any }>(`select public.editorial_adopt_direction('clientops','ivan',null,
      '{"audience":"operators","topic":"source-backed"}'::jsonb,'reviewed seed','explicit acceptance','a1') result`)
    const version = adopted.rows[0].result.active_version
    const begin = await db.query<{ result: any }>(`select public.editorial_begin_refresh('clientops','ivan',$1,'r1',
      '{"configured_model":"model-a","prompt_version":"v1","prompt_refs":[{"prompt_id":"voice","hash":"a"}]}'::jsonb) result`, [version])
    const receipt = begin.rows[0].result
    expect(receipt.status).toBe('running')
    expect(receipt.starts_acquisition).toBe(false)
    const replay = await db.query<{ result: any }>(`select public.editorial_begin_refresh('clientops','ivan',$1,'r1') result`, [version])
    expect(replay.rows[0].result.refresh_id).toBe(receipt.refresh_id)
    expect(replay.rows[0].result.deduplicated).toBe(true)
    const inFlight = await db.query<{ result: any }>(`select public.editorial_begin_refresh('clientops','ivan',$1,'r2') result`, [version])
    expect(inFlight.rows[0].result.conflict.reason).toBe('in_flight')
    const finished = await db.query<{ result: any }>(`select public.editorial_finish_refresh('clientops','ivan',$1,'[]'::jsonb,
      'local-test','v1','[]'::jsonb,null) result`, [receipt.refresh_id])
    expect(finished.rows[0].result.status).toBe('empty')
    expect(finished.rows[0].result.last_usable_batch_id).toBeNull()
    const retry = await db.query<{ result: any }>(`select public.editorial_begin_refresh('clientops','ivan',$1,'r3',
      '{"configured_model":"model-a","prompt_version":"v1","prompt_refs":[{"prompt_id":"voice","hash":"b"}]}'::jsonb) result`, [version])
    expect(retry.rows[0].result.status).toBe('running')
    const descriptors = await db.query<{ input_manifest_hash: string; synthesis_descriptor: any }>(`select
      input_manifest_hash,synthesis_descriptor from public.editorial_input_manifests where client_id='ivan'
      order by source_cutoff`)
    expect(descriptors.rows).toHaveLength(2)
    expect(descriptors.rows[0].input_manifest_hash).not.toBe(descriptors.rows[1].input_manifest_hash)
    expect(descriptors.rows[1].synthesis_descriptor.prompt_refs[0].hash).toBe('b')
    const other = await db.query<{ result: any }>(`select public.editorial_begin_refresh('clientops','risedtc',$1,'r4') result`, [version])
    expect(other.rows[0].result.conflict.reason).toBe('stale_direction_version')
  })

  it('keeps a candidate snapshot hash stable across read clocks when native capture time is unavailable', async () => {
    const candidate = { id: 'candidate-next', raw_context: 'Derived summary; source body unavailable.',
      evidence: 'A candidate suggests a topic.', editorial_assessment: 'Provisional',
      editorial_strength: 'unknown', angle_options: [] }
    const a = await normalizeCollectorRow('ivan', 'lm_idea_candidates', candidate, '2026-09-21T01:00:00Z')
    const b = await normalizeCollectorRow('ivan', 'lm_idea_candidates', candidate, '2026-09-22T01:00:00Z')
    expect(a.snapshot_hash).toBe(b.snapshot_hash)
    expect(a.captured_at).not.toBe(b.captured_at)
    expect(a.gap_state?.reason).toBe('partial')
    expect(a.body_sha256).toBeNull()
  })
})
