import { PGlite } from '@electric-sql/pglite'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildSynthesisBriefs } from '../lib/editorialSynthesis'
import { canonicalBriefPayload } from '../lib/editorialBriefs'
import { normalizeCollectorRow } from '../lib/editorialCollectorBridge'
// @ts-ignore The release importer is an external .mjs artifact with no declaration file.
import { importInitialBatch, validateInitialBatchSeed } from '../../../../tools/import-initial-batch.mjs'

const seed = JSON.parse(readFileSync('../../../content-brain-01-evidence-briefs-2026-09-20-out/INITIAL-BATCH-IMPORT.json', 'utf8'))
const sql105 = readFileSync('db/105_editorial_brief_contract.sql', 'utf8')
const sql106 = readFileSync('db/106_editorial_refresh.sql', 'utf8')
const source = readFileSync('db/088_lane_allowed.sql', 'utf8')
const begin = source.indexOf('create or replace function public.lane_allowed')
const tail = 'grant execute on function public.lane_allowed(text) to service_role;'
const lane = source.slice(begin, source.indexOf(tail) + tail.length)

describe('Run 1 seed import against local FK-enforced 105/106', { timeout: 120_000 }, () => {
  it('validates all hashes, imports once and replays without duplicates', async () => {
    const db = new PGlite()
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create table public.client_registry(client_id text primary key,display_name text,is_active boolean,platform jsonb);
      create or replace function public.operator_gate_ok(p_gate text) returns boolean language sql stable
      as $$ select coalesce(p_gate,'')='clientops' $$;`)
    await db.exec(lane)
    await db.exec(sql105)
    await db.exec(sql106)
    await db.exec(`insert into public.client_registry(client_id,display_name,is_active,platform) values
      ('ivan','Ivan',true,'{"measurement":{"roster":[{"account":"ivan"}]}}'),
      ('risedtc','RISE',true,'{"measurement":{"roster":[{"account":"rise"}]}}'),
      ('arch','ARCH',true,'{"measurement":{"roster":[{"account":"arch"}]}}')`)
    const checked = validateInitialBatchSeed(seed)
    expect(checked.brief_hashes.length).toBe(38)
    await importInitialBatch(db, seed)
    await importInitialBatch(db, seed)
    for (const [table, count] of Object.entries(checked.rows)) {
      const result = await db.query<{ n: number }>(`select count(*)::int n from public.${table}`)
      expect(result.rows[0].n).toBe(count)
    }
    const pointers = await db.query<{ n: number }>(`select count(*)::int n from public.editorial_current_batch`)
    expect(pointers.rows[0].n).toBe(3)
    const ready = seed.plan[3].records.find((x: any) => x.client_id === 'ivan' && x.brief_id === 'brief-ivan-01' && x.version === 2)
    const stale = await db.query<{ result: any }>(`select public.editorial_reserve_draft('clientops','ivan',
      'brief-ivan-01',2,$1,'draft-test-1','post') result`, ['0'.repeat(64)])
    expect(stale.rows[0].result).toMatchObject({ state: 'conflict', blocked_reason: 'content_hash_mismatch' })
    const firstDraft = await db.query<{ result: any }>(`select public.editorial_reserve_draft('clientops','ivan',
      'brief-ivan-01',2,$1,'draft-test-1','post') result`, [ready.content_hash])
    expect(firstDraft.rows[0].result.state).toBe('accepted')
    const replayDraft = await db.query<{ result: any }>(`select public.editorial_reserve_draft('clientops','ivan',
      'brief-ivan-01',2,$1,'draft-test-1','post') result`, [ready.content_hash])
    expect(replayDraft.rows[0].result.artifact_id).toBe(firstDraft.rows[0].result.artifact_id)
    expect(replayDraft.rows[0].result.idempotent_replay).toBe(true)
    const blocked = await db.query<{ result: any }>(`select public.editorial_reserve_draft('clientops','ivan',
      'brief-ivan-06',2,$1,'draft-blocked','post') result`,
      [seed.plan[3].records.find((x: any) => x.client_id === 'ivan' && x.brief_id === 'brief-ivan-06' && x.version === 2).content_hash])
    expect(blocked.rows[0].result.state).toBe('blocked')
    const heldPromo = seed.plan[3].records.find((x: any) => x.client_id === 'risedtc' &&
      x.brief_id === 'brief-risedtc-05' && x.version === 2)
    const publicPromo = await db.query<{ result: any }>(`select public.editorial_reserve_draft('clientops','risedtc',
      'brief-risedtc-05',2,$1,'promo-public','promotion') result`, [heldPromo.content_hash])
    expect(publicPromo.rows[0].result).toMatchObject({ state: 'blocked', blocked_reason: 'essential_material_missing' })
    const internalPromo = await db.query<{ result: any }>(`select public.editorial_reserve_draft('clientops','risedtc',
      'brief-risedtc-05',2,$1,'promo-internal','internal_copy') result`, [heldPromo.content_hash])
    expect(internalPromo.rows[0].result.state).toBe('accepted')
    const uncorrected = seed.plan[3].records.find((x: any) => x.client_id === 'ivan' &&
      x.brief_id === 'brief-ivan-06' && x.version === 1)
    const invalidInternal = await db.query<{ result: any }>(`select public.editorial_reserve_draft('clientops','ivan',
      'brief-ivan-06',1,$1,'uncorrected-internal','internal_copy') result`, [uncorrected.content_hash])
    expect(invalidInternal.rows[0].result).toMatchObject({ state: 'blocked', blocked_reason: 'essential_material_missing' })

    // A second batch consumes new evidence, an existing scoped decision and an
    // own-outcome snapshot. A decision landing DURING synthesis is kept and
    // marked for reconciliation; it cannot overwrite the old proposal.
    await db.exec(`create table public.own_posts(id text primary key,post_text text,linkedin_url text,
      posted_at timestamptz,metric_capture_date timestamptz,num_likes integer,num_comments integer,
      num_impressions integer)`)
    await db.query(`insert into public.own_posts values('new-own-observation',
      'A new own post records five qualified replies from a defined cohort.',
      'https://example.test/own-post','2026-09-20','2026-09-21',7,5,240)`)
    const collector = await db.query<Record<string, unknown>>(`select * from public.own_posts
      where id='new-own-observation'`)
    const source = await normalizeCollectorRow('ivan','own_posts',collector.rows[0],new Date().toISOString())
    const cols = Object.keys(source)
    await db.query(`insert into public.editorial_sources(${cols.join(',')}) values(${cols.map((_, i) => `$${i + 1}`).join(',')})`,
      cols.map(c => { const v = (source as unknown as Record<string, unknown>)[c]; return v && typeof v === 'object' ? JSON.stringify(v) : v }))
    await db.query(`select public.editorial_record_decision('clientops','ivan','brief','brief-ivan-01',2,2,
      'defer','Prefer a source-backed next topic','angle','decision-before-refresh')`)
    await db.query(`insert into public.editorial_outcome_snapshots(client_id,snapshot_id,brief_id,brief_version,
      metric,observed_value,denominator,scope,event_definition,attribution)
      values('ivan','outcome-next','brief-ivan-01',2,'qualified replies',5,'225 warm sends',
      'own lane','qualified reply recorded','direct')`)
    const direction = seed.batches.find((b: any) => b.client_id === 'ivan').input_manifest.direction_version
    const started = await db.query<{ result: any }>(`select public.editorial_begin_refresh('clientops','ivan',$1,'second-input') result`, [direction])
    const receipt = started.rows[0].result
    expect(receipt.status).toBe('running')
    const manifest = await db.query<{ source_refs: any[]; decision_ids: string[]; outcome_snapshot_ids: string[] }>(
      `select source_refs,decision_ids,outcome_snapshot_ids from public.editorial_input_manifests
       where client_id='ivan' and input_manifest_hash=(select input_manifest_hash from public.editorial_batches
       where client_id='ivan' and batch_id=$1)`, [receipt.batch_id])
    expect(manifest.rows[0].source_refs).toContainEqual({ source_id: 'new-own-observation', seen_version: 1 })
    expect(manifest.rows[0].decision_ids).toHaveLength(1)
    expect(manifest.rows[0].outcome_snapshot_ids).toContain('outcome-next')
    await db.query(`select public.editorial_record_decision('clientops','ivan','brief','brief-ivan-02',1,1,
      'defer','Need another comparison','candidate','decision-during-refresh')`)
    const briefs = await buildSynthesisBriefs({ clientId: 'ivan', batchId: receipt.batch_id,
      directionVersion: direction, sourceCutoff: new Date().toISOString(), sources: [source as never],
      voiceRefs: [{ prompt_id: 'voice-fixture', version: '1', hash: 'c'.repeat(64) }],
      suggestions: [{ source_ids: ['new-own-observation'], topic: 'Qualified replies in the new own observation',
        angle: 'After the prior angle was deferred, inspect the five replies before adapting outreach', hook: 'Five qualified replies, one narrow cohort.',
        format: 'text', objective: 'Explain what was observed', intended_audience: 'Agency operators',
        why_now: 'A new own observation and an outcome snapshot arrived after the previous batch; the earlier angle was deferred.',
        structural_beats: ['State the own observation', 'Explain the denominator and missing comparator'],
        missing_material: [], tone: 'Direct and measured',
        overlap_with_existing_content: 'The earlier follower-tier proposal was deferred; this examines reply quality in a new cohort.',
        novelty_reason: 'The newly captured post and own outcome did not exist in the first batch.',
        claims: [{ source_id: 'new-own-observation',
          supporting_quote: 'A new own post records five qualified replies from a defined cohort.',
          statement: 'This one own post records five qualified replies.',
          allowed_phrasing: 'Ivan observed five qualified replies on this post.',
          prohibited_inference: 'Do not claim a lift or repeatable outcome.', status: 'fact' }],
        measurements: [{ source_id: 'new-own-observation', metric_name: 'comments', observed_value: 5,
          formula: 'comments on this post', denominator: 'one own post', comparison_population: 'none established',
          observation_window: '2026-09-20 to 2026-09-21', comparison_method_version: 'local-test-v1',
          unknowns: ['buyer share', 'age-matched lift'] }],
        resource: { asset_id: '', version: '', artifact_role: 'none', readiness: 'not_needed',
          access_route: '', permission_basis: '', required_missing_material: [],
          draft_state: 'not_needed', public_catalog_state: 'not_needed' },
        distribution: { channel: 'LinkedIn', cta: 'Compare your own reply quality by cohort.',
          route: 'ungated', fulfillment_requirements: [] },
        production: { structure: 'Observation, denominator, limitation, question', required_materials: [],
          critical_constraints: ['No causal lift claim'], effort_category: 'low' },
        evaluation: { primary_metric: 'qualified replies per send', secondary_metrics: ['profile visits'],
          comparator: 'none until age-matched cohort is available', window: '7 days after publication',
          earliest_valid_observation: 'after 7 days', event_source_availability: 'own post metrics',
          attribution_limitations: 'No buyer classification or causal comparison.' } }] })
    expect(briefs[0].measurements[0].observed_value).toBe(5)
    expect(briefs[0].claim_ledger[0].supporting_refs).toEqual(['ev-1'])
    expect(briefs[0].editorial_direction.angle).toContain('deferred')
    expect(briefs[0].production.voice_references).toHaveLength(1)
    const finished = await db.query<{ result: any }>(`select public.editorial_finish_refresh('clientops','ivan',$1,$2::jsonb,
      'local-builder-test','editorial-synthesis-v1','[]'::jsonb,null) result`,
      [receipt.refresh_id, JSON.stringify(briefs)])
    expect(finished.rows[0].result.status).toBe('complete')
    expect(finished.rows[0].result.last_usable_batch_id).toBe(receipt.batch_id)
    expect(finished.rows[0].result.awaiting_reconciliation).toBe(true)
    const inspected = await db.query<{ result: any }>(`select public.editorial_read_brief('clientops','ivan',$1,1) result`,
      [briefs[0].identity.brief_id])
    expect(inspected.rows[0].result.found).toBe(true)
    expect(inspected.rows[0].result.brief.claim_ledger[0].allowed_phrasing).toContain('five qualified replies')
    const reviewed = structuredClone(briefs[0])
    reviewed.identity.version = 2
    reviewed.identity.created_at = new Date().toISOString()
    reviewed.identity.content_hash = ''
    reviewed.readiness = 'ready_to_draft'
    reviewed.missing_material = []
    reviewed.review = { reviewer_seat: 'operator:local-human', reviewer_model: 'human',
      verdict: 'pass', reviewed_at: reviewed.identity.created_at,
      notes: 'Checked exact source quotation, denominator, client voice and no public release.' }
    reviewed.revises = { brief_id: reviewed.identity.brief_id, version: 1,
      changed_evidence: 'Explicit editorial review; evidence unchanged.' }
    reviewed.identity.content_hash = createHash('sha256').update(canonicalBriefPayload(reviewed)).digest('hex')
    const reviewReceipt = await db.query<{ result: any }>(`select public.editorial_commit_review('clientops','ivan',
      $1,1,$2,'review-local','pass','Checked source and denominator','operator:local-human',$3::jsonb,$4) result`,
      [reviewed.identity.brief_id, briefs[0].identity.content_hash, JSON.stringify(reviewed), reviewed.identity.content_hash])
    expect(reviewReceipt.rows[0].result).toMatchObject({ state: 'accepted', version: 2,
      content_hash: reviewed.identity.content_hash })
    const requested = await db.query<{ result: any }>(`select public.editorial_reserve_draft('clientops','ivan',
      $1,2,$2,'explicit-draft-local','post') result`, [reviewed.identity.brief_id, reviewed.identity.content_hash])
    expect(requested.rows[0].result.state).toBe('accepted')
    expect(requested.rows[0].result.artifact_id).toMatch(/^draft-/)
    const reviewedRetry = await db.query<{ result: any }>(`select public.editorial_commit_review('clientops','ivan',
      $1,1,$2,'review-local','pass','Checked source and denominator','operator:local-human',$3::jsonb,$4) result`,
      [reviewed.identity.brief_id, briefs[0].identity.content_hash, JSON.stringify(reviewed), reviewed.identity.content_hash])
    expect(reviewedRetry.rows[0].result.idempotent_replay).toBe(true)
    const retained = await db.query<{ n: number }>(`select count(*)::int n from public.editorial_decisions
      where client_id='ivan' and request_id='decision-during-refresh'`)
    expect(retained.rows[0].n).toBe(1)
    const malicious = structuredClone(seed)
    malicious.plan[3].records[0].content_hash = '0'.repeat(64)
    expect(() => validateInitialBatchSeed(malicious)).toThrow(/hash mismatch/)
  })
})
