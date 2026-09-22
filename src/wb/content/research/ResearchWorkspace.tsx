import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Badge, Button, Card } from '../../../ds'
import { Group } from '../../kit'
import { supabase } from '../../../lib/supabase'
import { readResearch } from '../../../lib/editorialSources'
import { buildGenerationEnvelope } from '../../../lib/editorialGeneration'
import { readBriefs, recordEditorialDecision, requestDraft, requestSuggestionRefresh, readSuggestionRefresh, reviewEditorialBrief } from '../../../lib/editorialBriefs'
import { readEditorialResults } from '../../../lib/editorialOutcomes'
import { adoptEditorialDirection, readEditorialDirection } from '../../../lib/editorialDirection'
import type { BriefAccessGap, BriefPage, EditorialBrief, EditorialClient, RefreshState, SourcePage, SourceSnapshot } from '../../../lib/editorialTypes'
import type { ContentLane } from '../../../lib/content'
import { fetchResources, type Resource } from '../../../lib/styles'
import './research.css'

const clientId = (lane: ContentLane) => lane
const EditorialClientContext = createContext<EditorialClient>(supabase as unknown as EditorialClient)
export function EditorialClientProvider({ client, children }: { client: EditorialClient; children: ReactNode }) { return <EditorialClientContext.Provider value={client}>{children}</EditorialClientContext.Provider> }
const useEditorialClient = () => useContext(EditorialClientContext)
const requestId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
function draftRequestId(brief: EditorialBrief, version = brief.identity.version, hash = brief.identity.content_hash) {
  const key = `editorial-draft:${brief.identity.client_id}:${brief.identity.brief_id}:${version}:${hash}:${brief.identity.kind}`
  try {
    const existing = sessionStorage.getItem(key)
    if (existing) return existing
    const id = requestId('create-draft'); sessionStorage.setItem(key, id); return id
  } catch { return requestId('create-draft') }
}
const isBriefGap = (item: EditorialBrief | BriefAccessGap): item is BriefAccessGap => 'access' in item && item.access === 'permission_unavailable'
const when = (value: string | number | null | undefined) => value && value !== 'unknown' ? String(value) : 'Unknown'
const metricValues = (metrics: Record<string, unknown> | null) => metrics
  ? Object.entries(metrics).map(([name, value]) => `${name}: ${value == null ? 'unknown' : String(value)}`).join('; ')
  : 'No structured metrics recorded.'
const displayCandidateMetadata = (value: unknown) => {
  if (value == null || value === '') return ''
  if (typeof value === 'string') return value
  try { return JSON.stringify(value) } catch { return 'Structured candidate metadata is unavailable.' }
}
const nativeIdentity = (source: SourceSnapshot) => `${source.source_identity.platform}:${source.source_identity.native_id}` +
  (source.source_identity.collector_row_id ? ` (collector row ${source.source_identity.collector_row_id})` : '')
const metricEvidence = (source: SourceSnapshot) => {
  const provenance = source.metric_provenance
  const window = provenance.observation_window ? Object.entries(provenance.observation_window)
    .map(([name, value]) => `${name}: ${value == null ? 'unknown' : String(value)}`).join('; ') : 'window unknown'
  return `source: ${provenance.source ?? 'unknown'}; denominator: ${provenance.denominator ?? 'unknown'}; ${window}`
}

export function SourceDetail({ source, close, lane, previewLinked, readOnly = false }: { source: SourceSnapshot; close: () => void; lane: ContentLane; previewLinked?: EditorialBrief[]; readOnly?: boolean }) {
  const editorialClient = useEditorialClient()
  const detailRef = useRef<HTMLElement>(null)
  useEffect(() => {
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null
    detailRef.current?.focus({ preventScroll: true })
    detailRef.current?.scrollIntoView?.({ block: 'start', behavior: 'instant' })
    return () => { if (trigger?.isConnected) trigger.focus() }
  }, [source.source_id])
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [receipt, setReceipt] = useState<string | null>(null)
  const [linked, setLinked] = useState<EditorialBrief[]>([])
  useEffect(() => { if (previewLinked) { setLinked(previewLinked); return } let live=true; void (async () => { try { const first = await readBriefs(editorialClient, clientId(lane), null, null, 50); if (first.state === 'failed') return; const all = first.items.filter((b): b is EditorialBrief => !isBriefGap(b)); let cursor = first.next_cursor; while(cursor) { const p = await readBriefs(editorialClient, clientId(lane), first.batch_id, cursor, 50); if (p.state === 'failed') return; all.push(...p.items.filter((b): b is EditorialBrief => !isBriefGap(b))); cursor = p.next_cursor } if(live) setLinked(all.filter((b): b is EditorialBrief => !isBriefGap(b) && b.evidence.some(e => e.source_id === source.source_id))) } catch { if(live) setLinked([]) } })(); return () => {live=false} }, [lane, source.source_id, previewLinked])
  const decide = async (action: 'pin' | 'dismiss') => {
    if (!note.trim()) { setReceipt('Add a reason before saving this decision.'); return }
    setBusy(true); setReceipt(null)
    try {
      const r = await recordEditorialDecision(editorialClient, clientId(lane), { kind: 'source', id: source.source_id, version: source.seen_version }, source.seen_version, action, note, 'source', requestId(`source-${action}`))
      setReceipt(r.outcome === 'conflict' ? `A newer decision exists: ${r.conflict?.reason ?? 'reload and review it'}.` : `Saved. This did not create a draft or change publishing.`)
    } catch (e) { setReceipt(e instanceof Error ? e.message : 'Decision could not be saved.') } finally { setBusy(false) }
  }
  return <aside ref={detailRef} tabIndex={-1} onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); close() } }} className="a-research-detail" role="dialog" aria-label="Source detail">
    <div className="a-research-detail-head"><span className="a-eyebrow">Source detail</span><Button variant="quiet" size="sm" onClick={close}>Close</Button></div>
    <h3>{source.owner}</h3>
    <dl className="a-research-ledger">
      <dt>Original / excerpt</dt><dd>{source.passage ?? 'Original passage is unavailable.'} {'url' in source.source_ref ? <a href={source.source_ref.url} target="_blank" rel="noreferrer">Open original</a> : <span> Authenticated excerpt: {source.source_ref.excerpt_pointer}</span>}</dd>
      <dt>Owner</dt><dd>{source.owner}</dd><dt>Published</dt><dd>{when(source.source_published_date)}</dd>
      <dt>Observed</dt><dd>{when(source.captured_date)}</dd><dt>Scope</dt><dd>{source.source_client_scope}</dd>
      <dt>Body completeness</dt><dd>{source.body_state}</dd><dt>Native identity</dt><dd>{nativeIdentity(source)}</dd>
      <dt>Observed metrics</dt><dd>{metricValues(source.observed_metrics)}</dd><dt>Metric provenance</dt><dd>{metricEvidence(source)}</dd>
      <dt>Observation</dt><dd>{source.retained_context || displayCandidateMetadata(source.candidate_fields?.evidence) || 'No source observation recorded.'}</dd>
      <dt>Limits</dt><dd>{source.limitation || source.gap_state?.detail || 'No additional limit recorded.'}</dd>
      <dt>Linked suggestions</dt><dd>{linked.length ? linked.map(b => `${b.editorial_direction.topic} (v${b.identity.version})`).join('; ') : 'No current suggestion cites this source.'}</dd>
    </dl>
    {!readOnly && <><label className="a-research-reason">Reason <textarea value={note} onChange={e => setNote(e.target.value)} placeholder="Why pin or dismiss this source?" /></label>
    <div className="a-research-actions"><Button size="sm" disabled={busy} onClick={() => void decide('pin')}>Save / pin</Button><Button variant="quiet" size="sm" disabled={busy} onClick={() => void decide('dismiss')}>Dismiss</Button></div></>}
    {receipt && <p className="a-ct-sub" role="status">{receipt}</p>}
  </aside>
}

export function ResearchPanel({ lane }: { lane: ContentLane }) {
  const editorialClient = useEditorialClient()
  const [page, setPage] = useState<SourcePage | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<SourceSnapshot | null>(null)
  const [cursor, setCursor] = useState<string | null>(null)
  const [kind, setKind] = useState('all')
  const requestGeneration = useRef(0)
  const load = async (append = false) => {
    const generation = ++requestGeneration.current
    setError(null)
    try { const next = await readResearch(editorialClient, clientId(lane), kind === 'all' ? {} : { kinds: [kind as SourceSnapshot['source_kind']] }, append ? cursor : null, 25); if (generation !== requestGeneration.current) return; if (next.state === 'failed') { setError(next.message ?? 'Research read failed.'); return } setPage(p => append && p ? { ...next, items: [...p.items, ...next.items] } : next); setCursor(next.next_cursor) }
    catch (e) { if (generation === requestGeneration.current) setError(e instanceof Error ? e.message : 'Research could not be read.') }
  }
  useEffect(() => { setPage(null); setSelected(null); setCursor(null); setError(null); void load(); return () => { requestGeneration.current++ } }, [lane, kind])
  return <Group label="Research" tail={page && <span className="a-dim a-mono">{page.total} records · {page.independent_source_count} independent</span>} pad>
    {error && <p className="a-ct-sub" role="alert">{error} <Button size="sm" onClick={() => void load(Boolean(cursor))}>Try again</Button></p>}
    <label className="a-research-reason">Source kind <select value={kind} onChange={e => setKind(e.target.value)}><option value="all">All kinds</option><option value="public_post">Public posts</option><option value="market_study">Market studies</option><option value="own_post">Own posts</option><option value="call">Calls</option><option value="asset">Assets</option><option value="candidate">Candidates</option></select></label>
    {!page && !error && <p className="a-ct-sub">Reading research…</p>}
    {page && <>
    <p className="a-ct-sub">Source cutoff {when(page.health.source_cutoff)} · {page.health.new_evidence_awaiting_refresh} new inputs await review. Loaded {page.items.length} of {page.total}; the total is the scoped server count.</p>
    {page.gaps.length > 0 && <p className="a-ct-sub a-sev-attention">{page.gaps.length} unavailable or unsupported records remain counted: {page.gaps.map(g => g.detail).join(' ')}</p>}
    {/* `data-source-id` carries no visual meaning — it exists so a browser
        capture script can read exactly which source identities rendered
        without guessing from display text, the same identity the underlying
        read returned (see `response_ids`/`displayed_ids` in the B03 proof). */}
    <div className="a-research-list">{page.items.map(source => <div key={`${source.source_id}-${source.seen_version}`} data-source-id={source.source_id}><Card title={source.owner} sub={`${source.source_kind} · published ${when(source.source_published_date)}`} tail={<Badge tone={source.currency_state === 'current' ? 'accent' : 'neutral'} variant="ring">{source.currency_state}</Badge>}>
      <p className="a-research-excerpt">{source.passage ?? source.gap_state?.detail ?? 'Source text unavailable.'}</p><p className="a-ct-sub">{source.limitation}</p><Button size="sm" variant="quiet" onClick={() => setSelected(source)}>Inspect source</Button>
    </Card></div>)}</div>
    {cursor && <Button variant="quiet" size="sm" onClick={() => void load(true)}>Load more ({page.items.length} of {page.total})</Button>}
    {selected && <SourceDetail source={selected} close={() => setSelected(null)} lane={lane} />}
    </>}
  </Group>
}

export function BriefCard({ brief, lane, reload, readOnly = false }: { brief: EditorialBrief; lane: ContentLane; reload: () => void; readOnly?: boolean }) {
  const editorialClient = useEditorialClient()
  const [reason, setReason] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [scope, setScope] = useState<'candidate' | 'angle' | 'format'>('candidate')
  const [reviewed, setReviewed] = useState<{ version: number; hash: string } | null>(() =>
    brief.review?.verdict === 'pass' ? { version: brief.identity.version, hash: brief.identity.content_hash } : null)
  const productionHolds = [...brief.missing_material,
    ...(brief.editorial_direction.format === 'single_image' ? brief.production.required_materials : []),
    ...brief.production.critical_constraints]
  let generationEligible = false
  let internalCopyEligible = false
  try {
    const envelope = buildGenerationEnvelope({ brief, clientId: clientId(lane), expectedHash: brief.identity.content_hash, artifactRole: 'internal_copy', requestId: 'ui-eligibility' })
    generationEligible = true
    internalCopyEligible = envelope.copy_only
  } catch { /* The server remains the authority; an unrecognized hold is not offered as eligible. */ }
  const draftRequest = useRef(draftRequestId(brief))
  const reviewRequest = useRef(requestId(`review-${brief.identity.brief_id}-${brief.identity.version}`))
  const decide = async (action: 'shortlist' | 'defer' | 'reject') => {
    if (!reason.trim()) { setMessage('Add a reason and choose its scope before saving.'); return }
    setBusy(true); try { const r = await recordEditorialDecision(editorialClient, clientId(lane), { kind: 'brief', id: brief.identity.brief_id, version: brief.identity.version }, brief.identity.version, action, reason, scope, requestId(`brief-${action}`)); setMessage(r.outcome === 'conflict' ? `Conflict: ${r.conflict?.reason ?? 'newer decision exists'}.` : `${action} saved. It did not generate, approve, schedule, or publish.`); reload() } catch (e) { setMessage(e instanceof Error ? e.message : 'Decision failed.') } finally { setBusy(false) }
  }
  const review = async () => { if (!reason.trim()) { setMessage('Add a review reason before saving this review.'); return } setBusy(true); try { const r = await reviewEditorialBrief(editorialClient, clientId(lane), brief.identity.brief_id, brief.identity.version, brief.identity.content_hash, 'pass', reason, reviewRequest.current); if (r.state === 'accepted' && r.version && r.content_hash) { setReviewed({ version:r.version, hash:r.content_hash }); draftRequest.current = draftRequestId(brief, r.version, r.content_hash); setMessage(`Reviewed as v${r.version}. ${internalCopyEligible ? 'Create internal copy' : 'Create draft'} is now a separate action.`) } else setMessage(`Review ${r.state}: ${r.reason ?? 'reload the current brief and inspect its missing material.'}`) } catch (e) { setMessage(e instanceof Error ? e.message : 'Review could not be saved.') } finally { setBusy(false) } }
  const createDraft = async () => { if (!reviewed) { setMessage('Review this brief before requesting a draft.'); return } setBusy(true); try { const r = await requestDraft(editorialClient, clientId(lane), brief.identity.brief_id, reviewed.version, reviewed.hash, draftRequest.current, internalCopyEligible ? 'internal_copy' : brief.identity.kind); setMessage(r.state === 'accepted' ? (internalCopyEligible ? 'Internal copy requested. Production holds still apply; this does not approve publication.' : 'Draft request accepted. It remains an internal draft for review.') : `Draft blocked: ${r.blocked_reason ?? 'review the brief requirements.'}`) } catch (e) { setMessage(e instanceof Error ? e.message : 'Draft request failed.') } finally { setBusy(false) } }
  return <Card title={brief.editorial_direction.topic} sub={`${brief.identity.kind} · v${brief.identity.version} · ${brief.effective_status ?? brief.identity.status}`} tail={brief.strongest_three ? <Badge tone="accent" variant="ring">Strongest 3</Badge> : <Badge tone="neutral" variant="ring">Remaining</Badge>}>
    <p className="a-research-hook">{brief.editorial_direction.proposed_hook}</p><p className="a-ct-sub"><strong>Why:</strong> {brief.ranking_reason ?? brief.purpose.relevance_reason}</p><p className="a-ct-sub"><strong>Evidence:</strong> {brief.evidence.map(e => e.owner).filter(Boolean).join(', ') || 'No readable evidence.'}</p><p className="a-ct-sub"><strong>Readiness:</strong> {brief.readiness}{brief.missing_material.length ? ` · needs ${brief.missing_material.join(', ')}` : ''}</p>{productionHolds.length > 0 && <p className="a-ct-sub a-sev-attention"><strong>Production holds:</strong> {productionHolds.join('; ')}. Internal copy does not clear these holds.</p>}
    <details><summary>Complete brief</summary><dl className="a-research-ledger">
      <dt>Audience and aim</dt><dd>{brief.purpose.intended_audience} ({brief.purpose.audience_status}). {brief.purpose.objective}</dd>
      <dt>Direction</dt><dd>{brief.editorial_direction.angle}<br />{brief.editorial_direction.structural_beats.join('\n')}<br />Tone: {brief.editorial_direction.tone}</dd>
      <dt>Why now</dt><dd>{brief.editorial_direction.why_now}</dd>
      <dt>Overlap and novelty</dt><dd>{brief.editorial_direction.overlap_with_existing_content}<br />{brief.editorial_direction.novelty_reason}</dd>
      <dt>Claims</dt><dd>{brief.claim_ledger.map(c => <p key={c.claim_id}>{c.allowed_phrasing}<br />{c.status} · {c.attribution_owner} · evidence {c.supporting_refs.join(', ')}<br />Limit: {c.prohibited_inference}</p>)}</dd>
      <dt>Original evidence</dt><dd>{brief.evidence.map(e => <div key={e.evidence_id}><p><strong>{e.owner}</strong> · {e.evidence_id}<br />{e.passage ?? e.gap_state?.detail ?? 'Original passage unavailable.'}</p><p>{e.retained_context}<br />Published {when(e.source_published_date)} · observed {when(e.captured_date)} · {e.currency_state}<br />{e.limitation}<br />{'url' in e.source_ref ? <a href={e.source_ref.url} target="_blank" rel="noreferrer">Open original</a> : <>Internal excerpt: {e.source_ref.excerpt_pointer}</>}</p></div>)}</dd>
      <dt>Measurements</dt><dd>{brief.measurements.length ? brief.measurements.map((m,i) => <p key={i}>{m.metric_name}: {m.observed_value}<br />Owner: {m.owner}. Source: {m.source_ref}<br />Formula: {m.formula}<br />Denominator: {m.denominator}<br />Comparison: {m.comparison_population}<br />Window: {m.observation_window}; capture age {m.capture_age_days}; method {m.comparison_method_version}<br />Unknown: {m.unknowns.join(', ') || 'None recorded'}</p>) : brief.measurements_none_reason ?? 'No measurement.'}</dd>
      <dt>Distribution</dt><dd>{brief.distribution.cta}<br />{brief.distribution.channel} · {brief.distribution.route}<br />Fulfillment: {brief.distribution.fulfillment_requirements.join(', ') || 'No additional requirements'}</dd>
      <dt>Resource</dt><dd>{brief.resource.artifact_role}: {brief.resource.readiness}<br />{brief.resource.asset_id} {brief.resource.version && `v${brief.resource.version}`}<br />Access: {brief.resource.access_route || 'Not required'}<br />{brief.resource.permission_basis}<br />Missing: {brief.resource.required_missing_material.join(', ') || 'None recorded'}</dd>
      <dt>Production</dt><dd>{brief.production.structure}<br />Materials: {brief.production.required_materials.join(', ')}<br />Constraints: {brief.production.critical_constraints.join(' ')}<br />Effort: {brief.production.effort_category}</dd>
      <dt>How to evaluate</dt><dd>{brief.evaluation.primary_metric}; {brief.evaluation.secondary_metrics.join(', ')}<br />Compare with: {brief.evaluation.comparator}<br />Window: {brief.evaluation.window}; earliest valid observation: {brief.evaluation.earliest_valid_observation}<br />{brief.evaluation.event_source_availability}<br />{brief.evaluation.attribution_limitations}</dd>
    </dl></details>
    {!readOnly && <><label className="a-research-reason">Decision reason <input value={reason} onChange={e => setReason(e.target.value)} /></label><label className="a-research-reason">Apply to <select value={scope} onChange={e => setScope(e.target.value as typeof scope)}><option value="candidate">This suggestion</option><option value="angle">This angle</option><option value="format">This format</option></select></label>
    <div className="a-research-actions"><Button size="sm" disabled={busy} onClick={() => void decide('shortlist')}>Shortlist</Button><Button variant="quiet" size="sm" disabled={busy} onClick={() => void decide('defer')}>Defer</Button><Button variant="quiet" size="sm" disabled={busy} onClick={() => void decide('reject')}>Dismiss</Button><Button variant="outline" size="sm" disabled={busy || !!reviewed} onClick={() => void review()}>Review for draft</Button><Button variant="outline" size="sm" disabled={busy || !reviewed || !generationEligible} onClick={() => void createDraft()}>{internalCopyEligible ? 'Create internal copy' : 'Create draft'}</Button></div></>}
    {message && <p className="a-ct-sub" role="status">{message}</p>}
  </Card>
}

function UnavailableBriefCard({ gap }: { gap: BriefAccessGap }) {
  return <Card title="Source access unavailable" sub={`${gap.identity.kind} · v${gap.identity.version}`} tail={<Badge tone="neutral" variant="ring">Unavailable</Badge>}>
    <p className="a-ct-sub">The evidence for this suggestion is no longer available. Review and draft actions are disabled until a refreshed, accessible brief exists.</p>
  </Card>
}

export function ThisWeekPanel({ lane }: { lane: ContentLane }) {
  const editorialClient = useEditorialClient()
  const [page, setPage] = useState<BriefPage | null>(null)
  const [refresh, setRefresh] = useState<RefreshState | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [refreshBusy, setRefreshBusy] = useState(false)
  const refreshGeneration = useRef(0)
  const reload = async () => { try { const p = await readBriefs(editorialClient, clientId(lane), null, null, 50); if (p.state === 'failed') { setMessage(p.message ?? 'Suggestions could not be read.'); return } setPage(p) } catch (e) { setMessage(e instanceof Error ? e.message : 'Suggestions could not be read.') } }
  const more = async () => { if (!page?.next_cursor) return; try { const p = await readBriefs(editorialClient, clientId(lane), page.batch_id ?? null, page.next_cursor, 50); if (p.state === 'failed') { setMessage(p.message ?? 'More suggestions could not be read.'); return } setPage({ ...p, items: [...page.items, ...p.items] }) } catch (e) { setMessage(e instanceof Error ? e.message : 'More suggestions could not be read.') } }
  useEffect(() => { refreshGeneration.current++; void reload(); setRefresh(null); setMessage(null); setRefreshBusy(false); return () => { refreshGeneration.current++ } }, [lane])
  const sorted = useMemo(() => (page?.items ?? []).slice().sort((a,b) => {
    if (isBriefGap(a)) return 1
    if (isBriefGap(b)) return -1
    return Number(b.strongest_three) - Number(a.strongest_three) || a.rank - b.rank
  }), [page])
  const startRefresh = async () => { if (refreshBusy) return; const generation = ++refreshGeneration.current; setRefreshBusy(true); try { const direction = await readEditorialDirection(editorialClient, clientId(lane)); if (!direction.active_version) { setMessage('Adopt client direction before refreshing suggestions. Private notes are not used.'); return } const r = await requestSuggestionRefresh(editorialClient, clientId(lane), direction.active_version, requestId('refresh')); setMessage(`Refresh ${r.status}. It only synthesizes suggestions from collected evidence.`); if (r.refresh_id) { for (let attempt=0; attempt<6 && generation===refreshGeneration.current; attempt++) { const state = await readSuggestionRefresh(editorialClient, clientId(lane), r.refresh_id); if (generation!==refreshGeneration.current) return; setRefresh(state); if (state.status === 'complete' || state.status === 'partial') { await reload(); break } if (state.status === 'failed' || state.status === 'empty') break; if (attempt<5) await new Promise(resolve => setTimeout(resolve, 1500)) } } } catch (e) { if (generation===refreshGeneration.current) setMessage(e instanceof Error ? e.message : 'Refresh could not start.') } finally { if (generation===refreshGeneration.current) setRefreshBusy(false) } }
  return <Group label="This week" tail={<Button size="sm" disabled={refreshBusy} onClick={() => void startRefresh()}>{refreshBusy ? 'Checking refresh…' : 'Refresh suggestions'}</Button>} pad>
    <p className="a-ct-sub">Reviewable suggestions only. Selection never produces a draft; Create draft is the separate explicit action.</p>
    {refresh && <p className="a-ct-sub">Synthesis: {refresh.status}; last usable batch {refresh.last_usable_batch_id ?? 'none'}. Collection: {refresh.collection_health.new_evidence_awaiting_refresh} new inputs, {refresh.collection_health.stale_inputs} stale. {refresh.synthesis_health.last_failure_reason ?? ''}</p>}
    {message && <p className="a-ct-sub" role="status">{message}</p>}
    {!page ? <p className="a-ct-sub">Reading this week’s suggestions…</p> : <><p className="a-ct-sub">{page.total} suggestions in this batch; {page.items.length} loaded. {page.coverage_gaps.join(' ')}</p><div className="a-research-list">{sorted.map(b => isBriefGap(b) ? <UnavailableBriefCard key={`${b.identity.brief_id}-${b.identity.version}`} gap={b} /> : <BriefCard key={`${b.identity.brief_id}-${b.identity.version}`} brief={b} lane={lane} reload={() => void reload()} />)}</div>{page.next_cursor && <Button size="sm" variant="quiet" onClick={() => void more()}>Load more</Button>}</>}
  </Group>
}

export function ResultsPanel({ lane }: { lane: ContentLane }) {
  const editorialClient = useEditorialClient()
  const [briefs, setBriefs] = useState<EditorialBrief[]>([]); const [lines, setLines] = useState<string[] | null>(null); const [error, setError] = useState<string | null>(null); const [tick, setTick] = useState(0)
  useEffect(() => { let live = true; setLines(null); setError(null); void (async () => { try { const first = await readBriefs(editorialClient, clientId(lane), null, null, 50); if (first.state === 'failed') throw new Error(first.message ?? 'Suggestions could not be read.'); const all = first.items.filter((b): b is EditorialBrief => !isBriefGap(b)); let cursor = first.next_cursor; while (cursor) { const p = await readBriefs(editorialClient, clientId(lane), first.batch_id, cursor, 50); if (p.state === 'failed') throw new Error(p.message ?? 'More suggestions could not be read.'); all.push(...p.items.filter((b): b is EditorialBrief => !isBriefGap(b))); cursor = p.next_cursor } const outcomes = await Promise.all(all.map(b => readEditorialResults(editorialClient, clientId(lane), b.identity.brief_id, b.identity.version))); if (live) { setBriefs(all); setLines(outcomes.flatMap(o => { const result: string[] = []; if (o.post) result.push(`Post ${o.post.post_id} · impressions ${o.post.impressions}, reactions ${o.post.reactions}, comments ${o.post.comments}, shares ${o.post.shares} · observed ${when(o.post.captured_at)}. ${o.post.attribution_limitation}`); if (o.resource) result.push(`Resource ${o.resource.asset_slug} v${o.resource.asset_version} · views ${o.resource.views}, clicks ${o.resource.cta_clicks}, captures ${o.resource.captures}, active bookings ${o.resource.active_bookings} · direct ${o.resource.direct_bookings}, assisted ${o.resource.assisted_bookings} · observed ${when(o.resource.observation_end)}. ${o.resource.attribution_limitation}`); for (const unknown of o.unknowns) result.push(`Unknown · ${unknown}`); return result })) } } catch(e) { if(live) setError(e instanceof Error ? e.message : 'Results could not be read.') } })(); return () => { live=false } }, [lane,tick])
  return <Group label="Results" pad><p className="a-ct-sub">Post and resource observations are separate. Unknown is retained; this view does not infer sales.</p>{error ? <p role="alert" className="a-ct-sub">{error} <Button size="sm" onClick={() => setTick(x => x+1)}>Try again</Button></p> : lines === null ? <p className="a-ct-sub">Reading observed outcomes…</p> : lines.length ? <ul className="a-research-results">{lines.map((x,i)=><li key={i}>{x}</li>)}</ul> : <p className="a-ct-sub">No measured outcomes are available for these {briefs.length} suggestions. Missing telemetry is unknown.</p>}</Group>
}

export function ClientDirectionPanel({ lane }: { lane: ContentLane }) {
  const editorialClient = useEditorialClient()
  const [read, setRead] = useState<{ active_version: string | null; status: string; direction: Record<string, unknown> | null; source: string | null; updated_at: string | null } | null>(null)
  const [direction, setDirection] = useState(''); const [source, setSource] = useState(''); const [reason, setReason] = useState(''); const [message, setMessage] = useState<string | null>(null)
  const load = () => void readEditorialDirection(editorialClient, clientId(lane)).then(setRead).catch(e => setMessage(e instanceof Error ? e.message : 'Direction could not be read.'))
  useEffect(load, [lane])
  const adopt = async () => { if (!direction.trim() || !source.trim() || !reason.trim()) { setMessage('Direction, source, and reason are required for an explicit adoption.'); return } try { const r = await adoptEditorialDirection(editorialClient, clientId(lane), read?.active_version ?? null, { statement: direction }, source, reason, requestId('adopt-direction')); setMessage(r.state === 'active' ? `Direction v${r.active_version} is active for later refreshes.` : 'A newer active direction exists. Reload before deciding.'); load() } catch (e) { setMessage(e instanceof Error ? e.message : 'Direction adoption failed.') } }
  return <Group label="Client direction" pad><p className="a-ct-sub">Active direction is versioned and only changes through an explicit adoption. Private Strategy notes remain private and do not steer suggestions.</p>{read && <Card title={read.status === 'active' ? `Active v${read.active_version}` : 'No active direction'} sub={read.source ?? 'No verified source'}><p className="a-ct-sub">{read.direction ? JSON.stringify(read.direction) : 'Refresh will not infer direction from private notes.'}</p></Card>}<label className="a-research-reason">Direction <textarea value={direction} onChange={e => setDirection(e.target.value)} /></label><label className="a-research-reason">Source <input value={source} onChange={e => setSource(e.target.value)} /></label><label className="a-research-reason">Why adopt this <input value={reason} onChange={e => setReason(e.target.value)} /></label><Button size="sm" onClick={() => void adopt()}>Adopt direction</Button>{message && <p className="a-ct-sub" role="status">{message}</p>}</Group>
}

/** Demos retain their original resource rows and are deliberately outside the
 * publishing-idea queue. The server read stays lane-scoped; resource URLs are
 * not a filter because every current demo lacks one. */
export function DemoPanel({ lane }: { lane: ContentLane }) {
  const [rows, setRows] = useState<Resource[] | null>(null); const [query, setQuery] = useState(''); const [error, setError] = useState<string | null>(null)
  const load = () => { setRows(null); setError(null); void fetchResources(lane).then(all => setRows(all.filter(r => r.source === 'hypertarget_demo'))).catch(e => setError(e instanceof Error ? e.message : 'Demo records could not be read.')) }
  useEffect(load, [lane])
  const shown = (rows ?? []).filter(r => !query || `${r.topic} ${r.format} ${r.status}`.toLowerCase().includes(query.toLowerCase()))
  return <Group label="Demo resources" tail={<span className="a-dim a-mono">{rows?.length ?? '…'} total records</span>} pad><p className="a-ct-sub">Separate sales/demo records. They are not publishing ideas. Count and statuses are scoped to the selected client.</p><label className="a-research-reason">Search demos <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Topic, format, or status" /></label>{error ? <><p className="a-ct-sub">{error}</p><Button size="sm" onClick={load}>Try again</Button></> : rows === null ? <p className="a-ct-sub">Reading all demo records…</p> : <div className="a-research-list">{shown.map(r => <Card key={r.id} title={r.topic ?? 'Untitled demo'} sub={`${r.format ?? 'format unknown'} · ${r.status}`}><p className="a-ct-sub">Original source: {r.source}. Asset URL: {r.resource_url ?? 'not recorded'}.</p></Card>)}</div>}</Group>
}
