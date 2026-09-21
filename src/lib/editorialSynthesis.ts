import { canonicalBriefPayload } from './editorialBriefs'
import type { EditorialBrief, EditorialClientId, EvidenceRelation } from './editorialTypes'

export type SynthesisSource = {
  source_id: string; seen_version: number; source_kind: EditorialBrief['evidence'][number]['source_kind']
  source_client_scope: 'public' | EditorialClientId; source_url: string | null; excerpt_pointer: string | null
  owner: string; source_published_at: string | null; captured_at: string; body_sha256: string | null
  passage: string | null; retained_context: string; limitation: string; independent: boolean
  derived_from: string | null; permission_state: string; gap_state: { reason: string; detail: string } | null
  candidate_fields?: Record<string, unknown> | null
  snapshot_hash?: string
}

export type SynthesisSuggestion = {
  source_ids: string[]; topic: string; angle: string; hook: string
  format: 'text' | 'carousel' | 'video' | 'lm_promo' | 'resource'
  objective: string; intended_audience: string; why_now: string
  structural_beats: string[]; missing_material: string[]
  tone: string; overlap_with_existing_content: string; novelty_reason: string
  claims: { source_id: string; supporting_quote: string; statement: string; allowed_phrasing: string;
    prohibited_inference: string; status: 'fact' | 'interpretation' | 'hypothesis' }[]
  measurements: { source_id: string; metric_name: string; observed_value: number | string;
    formula: string; denominator: string; comparison_population: string; observation_window: string;
    comparison_method_version: string; unknowns: string[] }[]
  resource: { asset_id: string; version: string; artifact_role: string; readiness: 'ready' | 'needs_material' | 'not_needed';
    access_route: string; permission_basis: string; required_missing_material: string[];
    draft_state: string; public_catalog_state: string }
  distribution: { channel: string; cta: string; route: 'ungated' | 'gated' | 'dm' | 'follow_up';
    fulfillment_requirements: string[] }
  production: { structure: string; required_materials: string[]; critical_constraints: string[];
    effort_category: string }
  evaluation: { primary_metric: string; secondary_metrics: string[]; comparator: string; window: string;
    earliest_valid_observation: string; event_source_availability: string; attribution_limitations: string }
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  const o = value as Record<string, unknown>
  return `{${Object.keys(o).sort().map(k => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`
}

async function sha256(value: string): Promise<string> {
  const data = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(data)].map(b => b.toString(16).padStart(2, '0')).join('')
}

function relationFor(source: SynthesisSource, measured: boolean): EvidenceRelation {
  if (source.source_kind === 'own_post') return 'observed_own_performance'
  if (measured && (source.source_kind === 'market_study' || source.source_kind === 'public_post')) return 'observed_market_performance'
  if (source.source_kind === 'call') return 'supports_buyer_concern'
  if (source.source_kind === 'asset') return 'supplies_asset_proof'
  return 'supports_claim'
}

export async function buildSynthesisBriefs(input: {
  clientId: EditorialClientId; batchId: string; directionVersion: string; sourceCutoff: string
  sources: SynthesisSource[]; suggestions: SynthesisSuggestion[]
  voiceRefs?: EditorialBrief['production']['voice_references']
  assets?: { id: string; version: string; access_route: string; permission_basis: string; status: string }[]
}): Promise<EditorialBrief[]> {
  const sourceById = new Map(input.sources.map(s => [s.source_id, s]))
  const seen = new Set<string>()
  const briefs: EditorialBrief[] = []
  for (const [index, s] of input.suggestions.entries()) {
    if (!s.topic?.trim() || !s.angle?.trim() || !s.hook?.trim() || !s.objective?.trim() ||
        !s.intended_audience?.trim() || !s.why_now?.trim() || !Array.isArray(s.structural_beats) ||
        !Array.isArray(s.source_ids) || !s.source_ids.length || !Array.isArray(s.missing_material) ||
        !s.tone?.trim() || !s.overlap_with_existing_content?.trim() || !s.novelty_reason?.trim() ||
        !Array.isArray(s.claims) || !s.claims.length || !Array.isArray(s.measurements) ||
        !s.resource || !s.distribution || !s.production || !s.evaluation ||
        !s.distribution.cta?.trim() || !s.distribution.channel?.trim() ||
        !s.production.structure?.trim() || !s.production.effort_category?.trim() ||
        !Array.isArray(s.production.required_materials) || !Array.isArray(s.production.critical_constraints) ||
        !s.evaluation.primary_metric?.trim() || !s.evaluation.comparator?.trim() ||
        !s.evaluation.window?.trim() || !s.evaluation.earliest_valid_observation?.trim() ||
        !s.evaluation.event_source_availability?.trim() || !s.evaluation.attribution_limitations?.trim() ||
        !Array.isArray(s.evaluation.secondary_metrics) || !Array.isArray(s.distribution.fulfillment_requirements) ||
        !s.resource.readiness || !Array.isArray(s.resource.required_missing_material)) {
      throw new Error(`suggestion ${index + 1} is incomplete`)
    }
    if (!['text', 'carousel', 'video', 'lm_promo', 'resource'].includes(s.format)) {
      throw new Error(`suggestion ${index + 1} has an unsupported format`)
    }
    const key = `${s.topic.toLowerCase()}|${s.angle.toLowerCase()}`
    if (seen.has(key)) throw new Error(`suggestion ${index + 1} repeats a topic and angle`)
    seen.add(key)
    const sources = s.source_ids.map(id => sourceById.get(id))
    if (sources.some(v => !v)) throw new Error(`suggestion ${index + 1} cites a source outside the frozen input`)
    const safeSources = sources as SynthesisSource[]
    if (safeSources.some(v => !v.passage || v.gap_state || ['denied', 'withheld'].includes(v.permission_state))) {
      throw new Error(`suggestion ${index + 1} cites inaccessible source material`)
    }
    const sourceFor = (sourceId: string) => {
      const source = safeSources.find(x => x.source_id === sourceId)
      if (!source) throw new Error(`suggestion ${index + 1} has a claim or metric outside its evidence`)
      return source
    }
    const publicWords = [s.topic, s.angle, s.hook, ...s.structural_beats, s.distribution.cta,
      ...s.claims.map(c => c.allowed_phrasing)].join('\n').toLowerCase()
    for (const call of safeSources.filter(x => x.source_kind === 'call')) {
      const names = call.candidate_fields?.private_names
      if (Array.isArray(names) && names.some(name => typeof name === 'string' && name.trim().length > 3 &&
        publicWords.includes(name.toLowerCase()))) {
        throw new Error(`suggestion ${index + 1} leaks a private call participant into public direction`)
      }
    }
    for (const claim of s.claims) {
      const source = sourceFor(claim.source_id)
      if (!claim.supporting_quote?.trim() ||
          !(source.passage ?? '').includes(claim.supporting_quote) &&
          !source.retained_context.includes(claim.supporting_quote)) {
        throw new Error(`suggestion ${index + 1} claim lacks an exact retained supporting quote`)
      }
      if (!claim.statement?.trim() || !claim.allowed_phrasing?.trim() || !claim.prohibited_inference?.trim() ||
          !['fact', 'interpretation', 'hypothesis'].includes(claim.status)) {
        throw new Error(`suggestion ${index + 1} claim ledger is incomplete`)
      }
      if (source.source_kind === 'call' && source.owner.length > 4 &&
          [s.topic, s.angle, s.hook, ...s.structural_beats, claim.allowed_phrasing]
            .some(text => text.toLowerCase().includes(source.owner.toLowerCase()))) {
        throw new Error(`suggestion ${index + 1} leaks a private call speaker into public direction`)
      }
    }
    for (const metric of s.measurements) {
      const source = sourceFor(metric.source_id)
      const fields = source.candidate_fields ?? {}
      const observations = fields.observed_metrics && typeof fields.observed_metrics === 'object'
        ? fields.observed_metrics as Record<string, unknown> : {}
      const findings = Array.isArray(fields.linked_findings) ? fields.linked_findings as Record<string, unknown>[] : []
      const observed = Object.hasOwn(observations, metric.metric_name) &&
        String(observations[metric.metric_name]) === String(metric.observed_value)
      const linked = findings.some(f => f.metric_id === metric.metric_name &&
        String(f.observed_value) === String(metric.observed_value) && f.formula === metric.formula &&
        Array.isArray(f.source_ids) && f.source_ids.length === 1 && f.source_ids[0] === source.source_id)
      if ((!observed && !linked) || !metric.denominator?.trim() ||
          !metric.formula?.trim() || !metric.observation_window?.trim() || !metric.comparison_population?.trim()) {
        throw new Error(`suggestion ${index + 1} metric lacks exact structured source observation, denominator, formula or window`)
      }
      if (source.captured_at && !metric.observation_window.includes(source.captured_at.slice(0, 10))) {
        throw new Error(`suggestion ${index + 1} metric omits its exact capture date`)
      }
      if (linked) {
        const finding = findings.find(f => f.metric_id === metric.metric_name &&
          String(f.observed_value) === String(metric.observed_value))!
        if (metric.comparison_method_version !== finding.method_version ||
            (finding.baseline_n != null && !metric.denominator.includes(String(finding.baseline_n)))) {
          throw new Error(`suggestion ${index + 1} metric changes linked baseline or method`)
        }
      }
      if (source.source_kind === 'call') throw new Error('call material cannot supply a performance metric')
    }
    if (s.format === 'lm_promo' || s.format === 'resource') {
      const match = input.assets?.find(a => a.id === s.resource.asset_id && a.version === s.resource.version)
      if (!match || match.access_route !== s.resource.access_route ||
          match.permission_basis !== s.resource.permission_basis ||
          (s.format === 'lm_promo' && match.status !== 'ready')) {
        throw new Error(`suggestion ${index + 1} resource identity/readiness is not verified`)
      }
      if (s.resource.readiness === 'needs_material' && !s.resource.required_missing_material.length) {
        throw new Error(`suggestion ${index + 1} omits required material for an incomplete resource`)
      }
    } else if (s.resource.readiness !== 'not_needed' || s.resource.asset_id || s.resource.version) {
      throw new Error(`suggestion ${index + 1} asserts an unverified resource for an ordinary post`)
    }
    const evidence = safeSources.map((v, n) => {
      const age = v.source_published_at ? Math.floor((Date.parse(input.sourceCutoff) - Date.parse(v.source_published_at)) / 86_400_000) : null
      return {
        evidence_id: `ev-${n + 1}`, relation: relationFor(v, s.measurements.some(m => m.source_id === v.source_id)), source_id: v.source_id,
        seen_version: v.seen_version, source_kind: v.source_kind, source_client_scope: v.source_client_scope,
        source_ref: v.source_url ? { url: v.source_url } : { excerpt_pointer: v.excerpt_pointer ?? '' },
        source_published_date: v.source_published_at ?? 'unknown' as const,
        captured_date: v.captured_at, currency_state: age === null ? 'unknown' as const : age > 90 ? 'historical' as const : 'current' as const,
        owner: v.owner, source_content_hash: v.body_sha256, passage: v.passage,
        retained_context: v.retained_context, limitation: v.limitation,
        independent: v.independent, derived_from: v.derived_from,
        gap_state: null, permission_state: v.permission_state as EditorialBrief['evidence'][number]['permission_state'],
      }
    })
    const missing = [...new Set([...s.missing_material, ...s.resource.required_missing_material])]
    const publicCallHold = safeSources.some(x => x.source_kind === 'call' && x.permission_state !== 'granted')
    // A fully supported proposal can be reviewed explicitly into a new
    // ready-to-draft version; synthesis itself cannot award its own review.
    if (missing.length === 0) missing.push('Explicit independent editorial review')
    const briefId = `brief-${input.clientId}-${(await sha256(`${input.batchId}|${key}`)).slice(0, 20)}`
    const brief: EditorialBrief = {
      identity: { brief_id: briefId, version: 1, client_id: input.clientId,
        kind: s.format === 'resource' ? 'resource' : s.format === 'lm_promo' ? 'promotion' : s.format === 'video' ? 'video_script' : 'post',
        created_at: input.sourceCutoff, source_cutoff: input.sourceCutoff, status: 'proposed', content_hash: '' },
      purpose: { objective: s.objective, intended_audience: s.intended_audience,
        direction_version: input.directionVersion, audience_status: 'provisional',
        relevance_reason: s.why_now },
      editorial_direction: { topic: s.topic, angle: s.angle, proposed_hook: s.hook, format: s.format,
        tone: s.tone, structural_beats: s.structural_beats, why_now: s.why_now,
        overlap_with_existing_content: s.overlap_with_existing_content, novelty_reason: s.novelty_reason },
      evidence, independent_source_count: new Set(safeSources.filter(x => x.independent).map(x => x.source_id)).size,
      measurements: s.measurements.map(m => ({ metric_name: m.metric_name, formula: m.formula,
        observed_value: m.observed_value, denominator: m.denominator,
        comparison_population: m.comparison_population, capture_age_days: 'unknown' as const,
        observation_window: m.observation_window, comparison_method_version: m.comparison_method_version,
        source_ref: evidence.find(e => e.source_id === m.source_id)!.evidence_id,
        owner: sourceFor(m.source_id).owner, unknowns: m.unknowns,
        metric_family: sourceFor(m.source_id).source_kind === 'own_post' ? 'own_performance' as const : 'market_performance' as const })),
      measurements_none_reason: s.measurements.length ? null : 'No numeric measurement is asserted by the selected sources.',
      claim_ledger: s.claims.map((c, n) => ({ claim_id: `claim-${n + 1}`, statement: c.statement,
        supporting_refs: [evidence.find(e => e.source_id === c.source_id)!.evidence_id],
        attribution_owner: sourceFor(c.source_id).owner, allowed_phrasing: c.allowed_phrasing,
        prohibited_inference: c.prohibited_inference, status: c.status })),
      calls: [], calls_none_reason: safeSources.some(x => x.source_kind === 'call')
        ? 'The cited call stays an authenticated internal excerpt; public names and participant details are withheld.'
        : 'No call evidence selected.',
      resource: s.resource,
      distribution: { ...s.distribution, send_authorization: 'none' },
      production: { ...s.production, voice_references: input.voiceRefs ?? [],
        critical_constraints: [...s.production.critical_constraints,
          'Use only source-supported claims; withhold private call identities.',
          ...(publicCallHold ? ['Internal copy only: cited private call excerpt has no public-use permission.'] : [])] },
      evaluation: s.evaluation,
      decisions_links: { selection_events: [], generation_request: null, draft_ids: [], resource_ids: [],
        publication_id: null, observed_outcomes: [] },
      readiness: 'needs_material', missing_material: [...new Set(missing)], rank: index + 1, strongest_three: index < 3,
      ranking_reason: `Provisional rank ${index + 1}: ${s.why_now}`, review: null,
    }
    brief.identity.content_hash = await sha256(canonical(JSON.parse(canonicalBriefPayload(brief))))
    briefs.push(brief)
  }
  return briefs
}
