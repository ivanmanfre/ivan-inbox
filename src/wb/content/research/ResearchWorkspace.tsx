import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Badge, Button, Card } from '../../../ds'
import { Group } from '../../kit'
import { supabase } from '../../../lib/supabase'
import { readResearch } from '../../../lib/editorialSources'
import { buildGenerationEnvelope } from '../../../lib/editorialGeneration'
import { readBrief, readBriefs, recordEditorialDecision, requestDraft, requestSuggestionRefresh, readSuggestionRefresh, reviewEditorialBrief } from '../../../lib/editorialBriefs'
import { readEditorialResults } from '../../../lib/editorialOutcomes'
import { adoptEditorialDirection, readEditorialDirection } from '../../../lib/editorialDirection'
import { readEditorialWeeklyReview } from '../../../lib/editorialWeeklyRead'
import type { WeeklyBriefLink } from '../../../lib/editorialWeeklyRead'
import { buildWeeklySlotManifest } from '../../../lib/editorialWeeklyPolicy'
import type { WeeklySlotManifest } from '../../../lib/editorialWeeklyPolicy'
import { WeeklyPolicyPanel } from './WeeklyPolicyPanel'
import { exactBriefDeepLink } from '../strategy/deepLink'
import type { BriefAccessGap, BriefPage, EditorialBrief, EditorialClient, RefreshState, SourcePage, SourceSnapshot } from '../../../lib/editorialTypes'
import type { ContentLane } from '../../../lib/content'
import { fetchResources, type Resource } from '../../../lib/styles'
import './research.css'

const clientId = (lane: ContentLane) => lane
const EditorialClientContext = createContext<EditorialClient>(supabase as unknown as EditorialClient)
// The gap ledger prints EVERY gap's detail text; on the Ivan lane that was the
// same three sentences repeated 2,311 times, a 225K-character paragraph above
// the first research row on a phone (Run6 C04 F2). Identical details are
// grouped with a count, so every distinct detail stays on the screen and the
// ledger reads in one line.
export function groupGapDetails(gaps: ReadonlyArray<{ detail: string }>): [string, number][] {
  const counts = new Map<string, number>()
  for (const g of gaps) counts.set(g.detail, (counts.get(g.detail) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1])
}

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
      <dt>Source usage</dt><dd>{linked.length ? linked.map(b => <p key={`${b.identity.brief_id}:${b.identity.version}`}>{b.editorial_direction.topic} · <a href={exactBriefDeepLink(lane,b.identity.brief_id,b.identity.version)}>Open exact brief {b.identity.brief_id} v{b.identity.version}</a> · direction {b.purpose.direction_version}<br />Drafts: {b.decisions_links.draft_ids.join(', ') || 'none linked'} · publication: {b.decisions_links.publication_id ?? 'none linked'} · outcomes: {b.decisions_links.observed_outcomes.join(', ') || 'unknown'}</p>) : 'No current suggestion cites this source; draft and outcome usage are unknown.'}</dd>
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
    <label className="a-research-reason">Source kind <select value={kind} onChange={e => setKind(e.target.value)}><option value="all">All kinds</option><option value="public_post">Public posts</option><option value="market_study">Market studies</option><option value="own_post">Own posts</option><option value="call">Calls</option><option value="asset">Assets</option><option value="candidate">Candidates</option><option value="public_document">Public websites</option><option value="author_note">Author notes</option></select></label>
    {!page && !error && <p className="a-ct-sub">Reading research…</p>}
    {page && <>
    <p className="a-ct-sub">Source cutoff {when(page.health.source_cutoff)} · {page.health.new_evidence_awaiting_refresh} new inputs await review. Loaded {page.items.length} of {page.total}; the total is the scoped server count.</p>
    {page.gaps.length > 0 && <p className="a-ct-sub a-sev-attention">{page.gaps.length} unavailable or unsupported records remain counted: {groupGapDetails(page.gaps).map(([detail, n]) => `${n} × ${detail}`).join(' ')}</p>}
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

export function BriefCard({ brief, lane, reload, readOnly = false, currentDirectionVersion = null }: { brief: EditorialBrief; lane: ContentLane; reload: () => void; readOnly?: boolean; currentDirectionVersion?: string | null }) {
  const editorialClient = useEditorialClient()
  const fromEarlierDirection = Boolean(currentDirectionVersion && brief.purpose.direction_version !== currentDirectionVersion)
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
  return <Card title={brief.editorial_direction.topic} sub={`${brief.identity.kind} · v${brief.identity.version} · ${brief.effective_status ?? brief.identity.status}${fromEarlierDirection ? ' · earlier direction' : ''}`} tail={brief.strongest_three ? <Badge tone="accent" variant="ring">Strongest 3</Badge> : <Badge tone="neutral" variant="ring">Remaining</Badge>}>
    {fromEarlierDirection && <p className="a-ct-sub a-sev-attention">This brief is linked to direction {brief.purpose.direction_version}; current direction is {currentDirectionVersion}. Review the newer policy before using this brief. Existing drafts retain their original link.</p>}
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

export function ThisWeekPanel({ lane, exactBrief }: { lane: ContentLane; exactBrief?: { id: string; version: number } | null }) {
  const editorialClient = useEditorialClient()
  const [page, setPage] = useState<BriefPage | null>(null)
  const [refresh, setRefresh] = useState<RefreshState | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [refreshBusy, setRefreshBusy] = useState(false)
  const [manifest, setManifest] = useState<WeeklySlotManifest | null>(null)
  const [weekLinks, setWeekLinks] = useState<WeeklyBriefLink[]>([])
  const [savedWeek, setSavedWeek] = useState(false)
  const [savedManifestHash, setSavedManifestHash] = useState<string | null>(null)
  const [selectedWeek, setSelectedWeek] = useState<string | null>(null)
  const [availablePlans, setAvailablePlans] = useState<{ week_start: string; direction_version: string; manifest_hash: string }[]>([])
  const [selectedManifestHash, setSelectedManifestHash] = useState<string | null>(null)
  const [currentDirectionVersion, setCurrentDirectionVersion] = useState<string | null>(null)
  const [weekRevision, setWeekRevision] = useState(0)
  const [policyError, setPolicyError] = useState<string | null>(null)
  const [exactItem, setExactItem] = useState<EditorialBrief | BriefAccessGap | null>(null)
  const [exactError, setExactError] = useState<string | null>(null)
  const refreshGeneration = useRef(0)
  const reload = async () => { setWeekRevision(v => v + 1) }
  const more = async () => { if (!page?.next_cursor || savedWeek) return; const generation = refreshGeneration.current; try { const p = await readBriefs(editorialClient, clientId(lane), page.batch_id ?? null, page.next_cursor, 50); if (generation !== refreshGeneration.current) return; if (p.state === 'failed') { setMessage(p.message ?? 'More suggestions could not be read.'); return } setPage({ ...p, items: [...page.items, ...p.items] }) } catch (e) { if (generation === refreshGeneration.current) setMessage(e instanceof Error ? e.message : 'More suggestions could not be read.') } }
  useEffect(() => {
    let live = true; setExactItem(null); setExactError(null)
    if (exactBrief) void readBrief(editorialClient, clientId(lane), exactBrief.id, exactBrief.version).then(r => {
      if (!live) return
      if (!r.found) { setExactError(`Exact brief ${exactBrief.id} v${exactBrief.version} is unavailable.`); return }
      const item = 'brief' in r ? r.brief : r.gap
      if (item.identity.client_id !== lane || item.identity.brief_id !== exactBrief.id || item.identity.version !== exactBrief.version) { setExactError('Exact brief identity did not match this client.'); return }
      setExactItem(item)
    }).catch(e => { if (live) setExactError(e instanceof Error ? e.message : 'Exact brief could not be read.') })
    return () => { live = false }
  }, [editorialClient, lane, exactBrief?.id, exactBrief?.version])
  useEffect(() => {
    refreshGeneration.current++; setRefresh(null); setMessage(null); setRefreshBusy(false)
    let live = true
    setPage(null); setManifest(null); setWeekLinks([]); setSavedWeek(false); setSavedManifestHash(null); setPolicyError(null); setCurrentDirectionVersion(null)
    void (async () => {
      const [saved, direction] = await Promise.all([
        readEditorialWeeklyReview(editorialClient, clientId(lane), selectedWeek, selectedManifestHash),
        readEditorialDirection(editorialClient, clientId(lane)),
      ])
      if (!live) return
      setAvailablePlans(saved.available_plans ?? []); setCurrentDirectionVersion(direction.active_version)
      if (saved.state === 'ready') {
        setManifest(saved.manifest); setWeekLinks(saved.links); setSavedWeek(true); setSavedManifestHash(saved.manifest_hash ?? null)
        const exact = await Promise.all(saved.links.map(link => readBrief(editorialClient, clientId(lane), link.brief_id, link.brief_version)))
        if (!live) return
        const items: (EditorialBrief | BriefAccessGap)[] = []; const gaps: string[] = []
        exact.forEach((r, i) => {
          if (!r.found) { gaps.push(`Linked brief ${saved.links[i].brief_id} v${saved.links[i].brief_version} is unavailable.`); return }
          const item = 'brief' in r ? r.brief : r.gap
          if (item.identity.client_id !== lane || item.identity.brief_id !== saved.links[i].brief_id || item.identity.version !== saved.links[i].brief_version) throw new Error('Exact saved brief identity mismatch.')
          items.push(item)
        })
        setPage({client_id:lane,batch_id:null,state:items.length?'ready':'empty',items,total:saved.links.length,next_cursor:null,coverage_gaps:gaps})
        return
      }
      if (selectedWeek !== null) { setPolicyError(`No saved plan exists for ${selectedWeek} in this client.`); setPage({client_id:lane,batch_id:null,state:'empty',items:[],total:0,next_cursor:null,coverage_gaps:[]}); return }
      if (!direction.active_version || !direction.direction) setPolicyError('No saved week or adopted direction is available.')
      else {
        const date = new Date(); date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7)
        setManifest(buildWeeklySlotManifest(clientId(lane), direction.active_version, selectedWeek ?? date.toISOString().slice(0, 10), direction.direction))
      }
      if (exactBrief) { setPage({client_id:lane,batch_id:null,state:'empty',items:[],total:0,next_cursor:null,coverage_gaps:[]}); return }
      const briefs = await readBriefs(editorialClient, clientId(lane), null, null, 50)
      if (live) { if (briefs.state === 'failed') setMessage(briefs.message ?? 'Suggestions could not be read.'); else setPage(briefs) }
    })().catch(e => { if (live) setPolicyError(e instanceof Error ? e.message : 'Week policy could not be read.') })
    return () => { live = false; refreshGeneration.current++ }
  }, [lane, editorialClient, selectedWeek, selectedManifestHash, weekRevision, exactBrief?.id, exactBrief?.version])
  const sorted = useMemo(() => (page?.items ?? []).slice().sort((a,b) => {
    if (isBriefGap(a)) return 1
    if (isBriefGap(b)) return -1
    return Number(b.strongest_three) - Number(a.strongest_three) || a.rank - b.rank
  }), [page])
  const startRefresh = async () => { if (refreshBusy) return; const generation = ++refreshGeneration.current; setRefreshBusy(true); try { const direction = await readEditorialDirection(editorialClient, clientId(lane)); if (!direction.active_version) { setMessage('Adopt client direction before refreshing suggestions. Private notes are not used.'); return } if (manifest?.contract_version === 1 && (!savedWeek || !savedManifestHash)) { setMessage('This policy preview needs a saved evidence plan before suggestions can be refreshed.'); return }
      if (manifest && savedWeek && manifest.direction_version !== direction.active_version) { setMessage('This saved week uses an earlier direction. Its briefs remain available; refresh requires a plan for the current direction.'); return }
      const snapshot = (manifest as unknown as { policy_snapshot?: { suggestion_id?: string } } | null)?.policy_snapshot
      if (manifest?.policy_status === 'proposed' && !snapshot?.suggestion_id) { setMessage('The saved proposal is missing its source identity. Refresh was not started.'); return }
      const r = await requestSuggestionRefresh(editorialClient, clientId(lane), direction.active_version, requestId('refresh'),
        manifest?.contract_version === 1 && savedManifestHash ? { week_start: manifest.week_start,
          expected_manifest_hash: savedManifestHash, ...(snapshot?.suggestion_id ? { provisional_policy_suggestion_id: snapshot.suggestion_id } : {}) } : undefined); setMessage(`Refresh ${r.status}. It only synthesizes suggestions from collected evidence.`); if (r.refresh_id) { for (let attempt=0; attempt<6 && generation===refreshGeneration.current; attempt++) { const state = await readSuggestionRefresh(editorialClient, clientId(lane), r.refresh_id); if (generation!==refreshGeneration.current) return; setRefresh(state); if (state.status === 'complete' || state.status === 'partial') { await reload(); break } if (state.status === 'failed' || state.status === 'empty') break; if (attempt<5) await new Promise(resolve => setTimeout(resolve, 1500)) } } } catch (e) { if (generation===refreshGeneration.current) setMessage(e instanceof Error ? e.message : 'Refresh could not start.') } finally { if (generation===refreshGeneration.current) setRefreshBusy(false) } }
  return <Group label="Week review" tail={<Button size="sm" disabled={refreshBusy} onClick={() => void startRefresh()}>{refreshBusy ? 'Checking refresh…' : 'Refresh suggestions'}</Button>} pad>
    <p className="a-ct-sub">Reviewable suggestions only. Selection never produces a draft; Create draft is the separate explicit action.</p>
    {exactBrief && <div className="a-research-list"><p className="a-ct-sub">Exact brief link · {exactBrief.id} v{exactBrief.version} · {lane}. This read does not substitute the latest batch.</p>{exactError && <p className="a-ct-sub a-sev-attention">{exactError}</p>}{exactItem && ('editorial_direction' in exactItem ? <BriefCard brief={exactItem} lane={lane} reload={() => {}} readOnly currentDirectionVersion={currentDirectionVersion} /> : <UnavailableBriefCard gap={exactItem} />)}</div>}
    {availablePlans.length > 0 && <label className="a-research-reason">Saved plan<select value={selectedManifestHash ?? ''} onChange={e => { const plan = availablePlans.find(p => p.manifest_hash === e.target.value); setSelectedManifestHash(plan?.manifest_hash ?? null); setSelectedWeek(plan?.week_start ?? null) }}><option value="">Latest saved plan</option>{availablePlans.map(plan => <option key={plan.manifest_hash} value={plan.manifest_hash}>{plan.week_start} · {plan.direction_version}</option>)}</select></label>}
    {manifest && <div className="a-policy-preview"><div className="a-policy-heading"><strong>{savedWeek ? `Saved week · ${manifest.week_start}` : `Policy preview · ${manifest.week_start}`}</strong><span className="a-ct-sub">{manifest.slots.length} · {manifest.policy_status} · direction {manifest.direction_version}</span></div>{manifest.slots.length ? <ol className="a-policy-slots">{manifest.slots.map(slot => { const linked = weekLinks.filter(link => link.slot_id === slot.slot_id); return <li key={slot.slot_id} data-slot-id={slot.slot_id}><b>{slot.ordinal}. {slot.purpose} · {slot.format}</b><span>{linked.length ? linked.map(link => `Brief ${link.brief_id} v${link.brief_version}`).join(' · ') : 'No exact linked brief yet; content gap'}{slot.asset_gap ? ` · asset gap: ${slot.asset_gap}` : ''}</span></li> })}</ol> : <p className="a-ct-sub">Paused week: no slots, jobs, or active-client proof credit.</p>}</div>}
    {policyError && <p className="a-ct-sub a-sev-attention">Slot plan unavailable: {policyError}</p>}
    {refresh && <p className="a-ct-sub">Synthesis: {refresh.status}; last usable batch {refresh.last_usable_batch_id ?? 'none'}. Collection: {refresh.collection_health.new_evidence_awaiting_refresh} new inputs, {refresh.collection_health.stale_inputs} stale. {refresh.synthesis_health.last_failure_reason ?? ''}</p>}
    {message && <p className="a-ct-sub" role="status">{message}</p>}
    {!page ? <p className="a-ct-sub">Reading this week’s suggestions…</p> : <><p className="a-ct-sub">{page.total} {savedWeek ? 'exact linked brief versions in this saved week' : 'suggestions in this batch'}; {page.items.length} loaded. {page.coverage_gaps.join(' ')}</p><div className="a-research-list">{sorted.map(b => isBriefGap(b) ? <UnavailableBriefCard key={`${b.identity.brief_id}-${b.identity.version}`} gap={b} /> : <BriefCard key={`${b.identity.brief_id}-${b.identity.version}`} brief={b} lane={lane} reload={() => void reload()} currentDirectionVersion={currentDirectionVersion} />)}</div>{page.next_cursor && <Button size="sm" variant="quiet" onClick={() => void more()}>Load more</Button>}</>}
  </Group>
}

export function ResultsPanel({ lane }: { lane: ContentLane }) {
  const editorialClient = useEditorialClient()
  const [briefs, setBriefs] = useState<EditorialBrief[]>([]); const [lines, setLines] = useState<string[] | null>(null); const [error, setError] = useState<string | null>(null); const [tick, setTick] = useState(0)
  useEffect(() => { let live = true; setLines(null); setError(null); void (async () => { try { const first = await readBriefs(editorialClient, clientId(lane), null, null, 50); if (first.state === 'failed') throw new Error(first.message ?? 'Suggestions could not be read.'); const all = first.items.filter((b): b is EditorialBrief => !isBriefGap(b)); let cursor = first.next_cursor; while (cursor) { const p = await readBriefs(editorialClient, clientId(lane), first.batch_id, cursor, 50); if (p.state === 'failed') throw new Error(p.message ?? 'More suggestions could not be read.'); all.push(...p.items.filter((b): b is EditorialBrief => !isBriefGap(b))); cursor = p.next_cursor } const outcomes = await Promise.all(all.map(b => readEditorialResults(editorialClient, clientId(lane), b.identity.brief_id, b.identity.version))); if (live) { setBriefs(all); setLines(outcomes.flatMap((o, i) => { const b = all[i]; const result: string[] = [`Brief ${b.identity.brief_id} v${b.identity.version} · ${b.editorial_direction.topic} · direction ${b.purpose.direction_version}. Sources: ${b.evidence.map(e => e.source_id).join(', ') || 'unknown'}. Drafts: ${b.decisions_links.draft_ids.join(', ') || 'none linked'}. Publication: ${b.decisions_links.publication_id ?? 'none linked'}.`]; if (o.post) result.push(`Post ${o.post.post_id} · impressions ${o.post.impressions}, reactions ${o.post.reactions}, comments ${o.post.comments}, shares ${o.post.shares} · observed ${when(o.post.captured_at)}. ${o.post.attribution_limitation}`); if (o.resource) result.push(`Resource ${o.resource.asset_slug} v${o.resource.asset_version} · views ${o.resource.views}, clicks ${o.resource.cta_clicks}, captures ${o.resource.captures}, active bookings ${o.resource.active_bookings} · direct ${o.resource.direct_bookings}, assisted ${o.resource.assisted_bookings} · observed ${when(o.resource.observation_end)}. ${o.resource.attribution_limitation}`); for (const unknown of o.unknowns) result.push(`Unknown · ${unknown}`); return result })) } } catch(e) { if(live) setError(e instanceof Error ? e.message : 'Results could not be read.') } })(); return () => { live=false } }, [lane,tick])
  return <Group label="Results" pad><p className="a-ct-sub">Post and resource observations are separate. Unknown is retained; this view does not infer sales.</p>{error ? <p role="alert" className="a-ct-sub">{error} <Button size="sm" onClick={() => setTick(x => x+1)}>Try again</Button></p> : lines === null ? <p className="a-ct-sub">Reading observed outcomes…</p> : lines.length ? <ul className="a-research-results">{lines.map((x,i)=><li key={i}>{x}</li>)}</ul> : <p className="a-ct-sub">No measured outcomes are available for these {briefs.length} suggestions. Missing telemetry is unknown.</p>}</Group>
}

export function ClientDirectionPanel({ lane, onDirtyChange }: { lane: ContentLane; onDirtyChange?: (dirty: boolean) => void }) {
  const editorialClient = useEditorialClient()
  const [read, setRead] = useState<Awaited<ReturnType<typeof readEditorialDirection>> | null>(null)
  const [statement, setStatement] = useState('')
  const [source, setSource] = useState('')
  const [reason, setReason] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const load = () => void readEditorialDirection(editorialClient, clientId(lane)).then(next => { setRead(next); setStatement(typeof next.direction?.statement === 'string' ? next.direction.statement : ''); setSource(next.source ?? '') }).catch(e => setMessage(e instanceof Error ? e.message : 'Direction could not be read.'))
  useEffect(load, [lane, editorialClient])
  const composed = read?.direction?.schema === 'editorial-direction-composed-v2'
  const adopt = async () => {
    if (!read || !statement.trim() || !source.trim() || !reason.trim()) { setMessage('Direction, source, and reason are required.'); return }
    try {
      const next = { ...(read.direction ?? {}), statement }
      const result = await adoptEditorialDirection(editorialClient, clientId(lane), read.active_version, next, source, reason, requestId('adopt-direction'))
      setMessage(result.state === 'active' ? `Direction ${result.active_version} is active for future briefs; existing drafts keep their prior version.` : 'A newer active direction exists. Reload and compare before saving.')
      if (result.state === 'active') load()
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Direction adoption failed.') }
  }
  return <div className="a-strategy-panel"><WeeklyPolicyPanel lane={lane} client={editorialClient} onSaved={load} onDirtyChange={onDirtyChange} /><Group label="Full client direction" pad><p className="a-ct-sub">The weekly policy is versioned within client direction. Other direction fields stay intact when it is adopted. Private Notes never become generation input.</p>{read && <Card title={read.status === 'active' ? `Active ${read.active_version}` : 'No active direction'} sub={`${read.source ?? 'Unknown source'} · ${read.updated_at ?? 'date unknown'}`}><details><summary>Inspect retained direction</summary><pre className="a-policy-direction-json">{read.direction ? JSON.stringify(read.direction, null, 2) : 'No adopted direction.'}</pre></details></Card>}{composed ? <p className="a-ct-sub">This composed direction keeps its original strategy and user steering. Edit its typed weekly policy above; the generic statement editor applies only to legacy direction records.</p> : <><label className="a-research-reason">Legacy direction statement<textarea value={statement} onChange={e => setStatement(e.target.value)} /></label><label className="a-research-reason">Source<input value={source} onChange={e => setSource(e.target.value)} /></label><label className="a-research-reason">Why adopt<input value={reason} onChange={e => setReason(e.target.value)} /></label><Button size="sm" onClick={() => void adopt()}>Adopt direction statement</Button></>}{message && <p className="a-ct-sub" role="status">{message}</p>}</Group></div>
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
