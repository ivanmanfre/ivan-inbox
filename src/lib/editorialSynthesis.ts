import { canonicalBriefPayload } from './editorialBriefs.ts'
import type { EditorialBrief, EditorialClientId, EvidenceRelation } from './editorialTypes.ts'

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

/** Reject known unit/qualification distortions in public directions. This is
 * a narrow deterministic guard, not a substitute for editorial source review. */
export function assertMeasurementWording(sources: SynthesisSource[], suggestion: Pick<SynthesisSuggestion, 'hook' | 'structural_beats' | 'claims'>) {
  const publicParts = [suggestion.hook, ...suggestion.structural_beats, ...suggestion.claims.map(c => c.statement)]
  const errors = new Set<string>()
  for (const source of sources) {
    const metrics = source.candidate_fields?.observed_metrics as Record<string, unknown> | undefined
    const impressions = metrics?.impressions
    const findings = source.candidate_fields?.linked_findings
    for (const text of publicParts) {
      if (typeof impressions === 'number' && new RegExp('\\b' + String(impressions) + '\\s+(?:people|readers|unique viewers)\\b', 'i').test(text.replace(/(\d),(?=\d)/g, '$1')))
        errors.add('Impressions are not unique people/readers: keep the exact impressions unit.')
      if (metrics?.comments === 0 && /\b(?:0|zero)\s+(?:said|replied|responded|replies|responses|feedback)\b/i.test(text))
        errors.add('Zero public comments does not prove zero replies, DMs or other feedback: name recorded public comments and the capture date.')
      if (Array.isArray(findings) && findings.some(f => String(f.formula).includes('reposts')) &&
        /\breach\b/i.test(text) && /(?:\b\d+(?:\.\d+)?x\b|\bbaseline\s+reach\b)/i.test(text) && !/\bproxy\b/i.test(text))
        errors.add('A weighted likes/reposts score is a proxy, not measured reach: name the exact proxy/formula wherever its baseline lift appears.')
      if (/not just likes/i.test(source.passage ?? '') && /\breplies[,\s]+not likes\b/i.test(text))
        errors.add('The source says not JUST likes: replies supplement likes, not replace/exclude them. Preserve that qualification.')
    }
  }
  if (errors.size) throw new Error([...errors].join(' '))
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

/** The provider's JSON is untrusted at runtime. Report all shape errors before
 * reading strings so the existing bounded correction gets actionable paths. */
function assertSuggestionShapes(value: unknown): asserts value is SynthesisSuggestion[] {
  const errors: string[] = []
  const object = (item: unknown, path: string): Record<string, unknown> => {
    if (item && typeof item === 'object' && !Array.isArray(item)) return item as Record<string, unknown>
    errors.push(`${path}: expected object`)
    return {}
  }
  const texts = (item: Record<string, unknown>, path: string, keys: string, allowEmpty = false) => {
    for (const key of keys.split(' ')) {
      const field = item[key]
      if (typeof field !== 'string' || (!allowEmpty && !field.trim()))
        errors.push(`${path}.${key}: expected ${allowEmpty ? '' : 'nonempty '}string`)
    }
  }
  const array = (item: unknown, path: string, minimum = 0): unknown[] => {
    if (!Array.isArray(item)) { errors.push(`${path}: expected array`); return [] }
    if (item.length < minimum) errors.push(`${path}: expected at least ${minimum} item`)
    return item
  }
  const strings = (item: unknown, path: string, minimum = 0) => {
    array(item, path, minimum).forEach((field, i) => {
      if (typeof field !== 'string') errors.push(`${path}[${i}]: expected string`)
    })
  }
  for (const [index, item] of array(value, 'suggestions').entries()) {
    const path = `suggestions[${index}]`, s = object(item, path)
    texts(s, path, 'topic angle hook objective intended_audience why_now tone overlap_with_existing_content novelty_reason format')
    strings(s.source_ids, `${path}.source_ids`, 1)
    for (const key of ['structural_beats', 'missing_material']) strings(s[key], `${path}.${key}`)
    array(s.claims, `${path}.claims`, 1).forEach((claim, i) => {
      const at = `${path}.claims[${i}]`
      texts(object(claim, at), at, 'source_id supporting_quote statement allowed_phrasing prohibited_inference status')
    })
    array(s.measurements, `${path}.measurements`).forEach((metric, i) => {
      const at = `${path}.measurements[${i}]`, m = object(metric, at)
      texts(m, at, 'source_id metric_name formula denominator comparison_population observation_window')
      texts(m, at, 'comparison_method_version', true)
      strings(m.unknowns, `${at}.unknowns`)
      if (typeof m.observed_value !== 'string' && typeof m.observed_value !== 'number')
        errors.push(`${at}.observed_value: expected number or string`)
    })
    const resource = object(s.resource, `${path}.resource`)
    texts(resource, `${path}.resource`, 'readiness')
    texts(resource, `${path}.resource`, 'asset_id version artifact_role access_route permission_basis draft_state public_catalog_state', true)
    strings(resource.required_missing_material, `${path}.resource.required_missing_material`)
    const distribution = object(s.distribution, `${path}.distribution`)
    texts(distribution, `${path}.distribution`, 'channel cta route')
    strings(distribution.fulfillment_requirements, `${path}.distribution.fulfillment_requirements`)
    const production = object(s.production, `${path}.production`)
    texts(production, `${path}.production`, 'structure effort_category')
    for (const key of ['required_materials', 'critical_constraints']) strings(production[key], `${path}.production.${key}`)
    const evaluation = object(s.evaluation, `${path}.evaluation`)
    texts(evaluation, `${path}.evaluation`, 'primary_metric comparator window earliest_valid_observation event_source_availability attribution_limitations')
    strings(evaluation.secondary_metrics, `${path}.evaluation.secondary_metrics`)
  }
  if (errors.length) throw new Error(`Synthesis field errors: ${errors.join('; ')}`)
}

export async function buildSynthesisBriefs(input: {
  clientId: EditorialClientId; batchId: string; directionVersion: string; sourceCutoff: string
  sources: SynthesisSource[]; suggestions: SynthesisSuggestion[]
  voiceRefs?: EditorialBrief['production']['voice_references']
  assets?: { id: string; version: string; access_route: string; permission_basis: string; status: string }[]
}): Promise<EditorialBrief[]> {
  assertSuggestionShapes(input.suggestions)
  const sourceById = new Map(input.sources.map(s => [s.source_id, s]))
  const seen = new Set<string>()
  const briefs: EditorialBrief[] = []
  for (const [index, s] of input.suggestions.entries()) {
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
    assertMeasurementWording(safeSources, s)
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
