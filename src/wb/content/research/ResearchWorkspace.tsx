import { useEffect, useMemo, useState } from 'react'
import { Badge, Button, Card } from '../../../ds'
import { Group } from '../../kit'
import { supabase } from '../../../lib/supabase'
import { readResearch } from '../../../lib/editorialSources'
import { readBriefOutcomes, readBriefs, recordEditorialDecision, requestDraft, requestSuggestionRefresh, readSuggestionRefresh } from '../../../lib/editorialBriefs'
import { adoptEditorialDirection, readEditorialDirection } from '../../../lib/editorialDirection'
import type { EditorialBrief, EditorialClient, RefreshState, SourcePage, SourceSnapshot } from '../../../lib/editorialTypes'
import type { ContentLane } from '../../../lib/content'
import { fetchResources, type Resource } from '../../../lib/styles'
import './research.css'

const clientId = (lane: ContentLane) => lane
const editorialClient = supabase as unknown as EditorialClient
const requestId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
const when = (value: string | number | null | undefined) => value && value !== 'unknown' ? String(value) : 'Unknown'

function SourceDetail({ source, close, lane }: { source: SourceSnapshot; close: () => void; lane: ContentLane }) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [receipt, setReceipt] = useState<string | null>(null)
  const decide = async (action: 'pin' | 'dismiss') => {
    if (!note.trim()) { setReceipt('Add a reason before saving this decision.'); return }
    setBusy(true); setReceipt(null)
    try {
      const r = await recordEditorialDecision(editorialClient, clientId(lane), { kind: 'source', id: source.source_id, version: source.seen_version }, source.seen_version, action, note, 'source', requestId(`source-${action}`))
      setReceipt(r.outcome === 'conflict' ? `A newer decision exists: ${r.conflict?.reason ?? 'reload and review it'}.` : `Saved. This did not create a draft or change publishing.`)
    } catch (e) { setReceipt(e instanceof Error ? e.message : 'Decision could not be saved.') } finally { setBusy(false) }
  }
  return <aside className="a-research-detail" role="dialog" aria-label="Source detail">
    <div className="a-research-detail-head"><span className="a-eyebrow">Source detail</span><Button variant="quiet" size="sm" onClick={close}>Close</Button></div>
    <h3>{source.owner}</h3>
    <dl className="a-research-ledger">
      <dt>Original / excerpt</dt><dd>{source.passage ?? 'Original passage is unavailable.'}</dd>
      <dt>Owner</dt><dd>{source.owner}</dd><dt>Published</dt><dd>{when(source.source_published_date)}</dd>
      <dt>Observed</dt><dd>{when(source.captured_date)}</dd><dt>Scope</dt><dd>{source.source_client_scope}</dd>
      <dt>Observation</dt><dd>{source.candidate_fields?.evidence ?? 'No source observation recorded.'}</dd>
      <dt>Limits</dt><dd>{source.limitation || source.gap_state?.detail || 'No additional limit recorded.'}</dd>
      <dt>Linked suggestions</dt><dd>Read the matching brief evidence before using this source in a draft.</dd>
    </dl>
    <label className="a-research-reason">Reason <textarea value={note} onChange={e => setNote(e.target.value)} placeholder="Why pin or dismiss this source?" /></label>
    <div className="a-research-actions"><Button size="sm" disabled={busy} onClick={() => void decide('pin')}>Save / pin</Button><Button variant="quiet" size="sm" disabled={busy} onClick={() => void decide('dismiss')}>Dismiss</Button></div>
    {receipt && <p className="a-ct-sub" role="status">{receipt}</p>}
  </aside>
}

export function ResearchPanel({ lane }: { lane: ContentLane }) {
  const [page, setPage] = useState<SourcePage | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<SourceSnapshot | null>(null)
  const [cursor, setCursor] = useState<string | null>(null)
  const load = async (append = false) => {
    setError(null)
    try { const next = await readResearch(editorialClient, clientId(lane), {}, append ? cursor : null, 25); setPage(p => append && p ? { ...next, items: [...p.items, ...next.items] } : next); setCursor(next.next_cursor) }
    catch (e) { setError(e instanceof Error ? e.message : 'Research could not be read.') }
  }
  useEffect(() => { void load() }, [lane])
  if (error) return <Group label="Research" pad><p className="a-ct-sub">{error}</p><Button size="sm" onClick={() => void load()}>Try again</Button></Group>
  if (!page) return <p className="a-ct-sub">Reading research…</p>
  return <Group label="Research" tail={<span className="a-dim a-mono">{page.total} records · {page.independent_source_count} independent</span>} pad>
    <p className="a-ct-sub">Source cutoff {when(page.health.source_cutoff)} · {page.health.new_evidence_awaiting_refresh} new inputs await review. Loaded {page.items.length} of {page.total}; the total is the scoped server count.</p>
    {page.gaps.length > 0 && <p className="a-ct-sub a-sev-attention">{page.gaps.length} unavailable or unsupported records remain counted: {page.gaps.map(g => g.detail).join(' ')}</p>}
    <div className="a-research-list">{page.items.map(source => <Card key={`${source.source_id}-${source.seen_version}`} title={source.owner} sub={`${source.source_kind} · published ${when(source.source_published_date)}`} tail={<Badge tone={source.currency_state === 'current' ? 'accent' : 'neutral'} variant="ring">{source.currency_state}</Badge>} onClick={() => setSelected(source)}>
      <p className="a-research-excerpt">{source.passage ?? source.gap_state?.detail ?? 'Source text unavailable.'}</p><p className="a-ct-sub">{source.limitation}</p>
    </Card>)}</div>
    {cursor && <Button variant="quiet" size="sm" onClick={() => void load(true)}>Load more ({page.items.length} of {page.total})</Button>}
    {selected && <SourceDetail source={selected} close={() => setSelected(null)} lane={lane} />}
  </Group>
}

function BriefCard({ brief, lane, reload }: { brief: EditorialBrief; lane: ContentLane; reload: () => void }) {
  const [reason, setReason] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const decide = async (action: 'shortlist' | 'defer' | 'reject') => {
    if (!reason.trim()) { setMessage('Add a reason and choose its scope before saving.'); return }
    setBusy(true); try { const r = await recordEditorialDecision(editorialClient, clientId(lane), { kind: 'brief', id: brief.identity.brief_id, version: brief.identity.version }, brief.identity.version, action, reason, 'candidate', requestId(`brief-${action}`)); setMessage(r.outcome === 'conflict' ? `Conflict: ${r.conflict?.reason ?? 'newer decision exists'}.` : `${action} saved. It did not generate, approve, schedule, or publish.`); reload() } catch (e) { setMessage(e instanceof Error ? e.message : 'Decision failed.') } finally { setBusy(false) }
  }
  const createDraft = async () => { setBusy(true); try { const r = await requestDraft(editorialClient, clientId(lane), brief.identity.brief_id, brief.identity.version, brief.identity.content_hash, requestId('create-draft'), brief.identity.kind); setMessage(r.state === 'accepted' ? 'Draft request accepted. It remains an internal draft for review.' : `Draft blocked: ${r.blocked_reason ?? 'review the brief requirements.'}`) } catch (e) { setMessage(e instanceof Error ? e.message : 'Draft request failed.') } finally { setBusy(false) } }
  return <Card title={brief.editorial_direction.topic} sub={`${brief.identity.kind} · v${brief.identity.version} · ${brief.identity.status}`} tail={brief.strongest_three ? <Badge tone="accent" variant="ring">Strongest 3</Badge> : <Badge tone="neutral" variant="ring">Remaining</Badge>}>
    <p className="a-research-hook">{brief.editorial_direction.proposed_hook}</p><p className="a-ct-sub"><strong>Why:</strong> {brief.ranking_reason ?? brief.purpose.relevance_reason}</p><p className="a-ct-sub"><strong>Evidence:</strong> {brief.evidence.map(e => e.owner).filter(Boolean).join(', ') || 'No readable evidence.'}</p><p className="a-ct-sub"><strong>Readiness:</strong> {brief.readiness}{brief.missing_material.length ? ` · needs ${brief.missing_material.join(', ')}` : ''}</p>
    <label className="a-research-reason">Decision reason <input value={reason} onChange={e => setReason(e.target.value)} /></label>
    <div className="a-research-actions"><Button size="sm" disabled={busy} onClick={() => void decide('shortlist')}>Shortlist</Button><Button variant="quiet" size="sm" disabled={busy} onClick={() => void decide('defer')}>Defer</Button><Button variant="quiet" size="sm" disabled={busy} onClick={() => void decide('reject')}>Dismiss</Button><Button variant="outline" size="sm" disabled={busy} onClick={() => void createDraft()}>Create draft</Button></div>
    {message && <p className="a-ct-sub" role="status">{message}</p>}
  </Card>
}

export function ThisWeekPanel({ lane }: { lane: ContentLane }) {
  const [page, setPage] = useState<{ items: EditorialBrief[]; total: number; state: string; coverage_gaps: string[] } | null>(null)
  const [refresh, setRefresh] = useState<RefreshState | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const reload = async () => { try { const p = await readBriefs(editorialClient, clientId(lane), null, null, 50); setPage(p) } catch (e) { setMessage(e instanceof Error ? e.message : 'Suggestions could not be read.') } }
  useEffect(() => { void reload(); setRefresh(null); setMessage(null) }, [lane])
  const sorted = useMemo(() => (page?.items ?? []).slice().sort((a,b) => Number(b.strongest_three) - Number(a.strongest_three) || a.rank - b.rank), [page])
  const startRefresh = async () => { try { const direction = await readEditorialDirection(editorialClient, clientId(lane)); if (!direction.active_version) { setMessage('Adopt client direction before refreshing suggestions. Private notes are not used.'); return } const r = await requestSuggestionRefresh(editorialClient, clientId(lane), direction.active_version, requestId('refresh')); setMessage(`Refresh ${r.status}. It only synthesizes suggestions from collected evidence.`); if (r.refresh_id) { const state = await readSuggestionRefresh(editorialClient, clientId(lane), r.refresh_id); setRefresh(state); if (state.status === 'complete' || state.status === 'partial') await reload() } } catch (e) { setMessage(e instanceof Error ? e.message : 'Refresh could not start.') } }
  return <Group label="This week" tail={<Button size="sm" onClick={() => void startRefresh()}>Refresh suggestions</Button>} pad>
    <p className="a-ct-sub">Reviewable suggestions only. Selection never produces a draft; Create draft is the separate explicit action.</p>
    {refresh && <p className="a-ct-sub">Synthesis: {refresh.status}; last usable batch {refresh.last_usable_batch_id ?? 'none'}. Collection: {refresh.collection_health.new_evidence_awaiting_refresh} new inputs, {refresh.collection_health.stale_inputs} stale. {refresh.synthesis_health.last_failure_reason ?? ''}</p>}
    {message && <p className="a-ct-sub" role="status">{message}</p>}
    {!page ? <p className="a-ct-sub">Reading this week’s suggestions…</p> : <><p className="a-ct-sub">{page.total} suggestions in this batch. {page.coverage_gaps.join(' ')}</p><div className="a-research-list">{sorted.map(b => <BriefCard key={`${b.identity.brief_id}-${b.identity.version}`} brief={b} lane={lane} reload={() => void reload()} />)}</div></>}
  </Group>
}

export function ResultsPanel({ lane }: { lane: ContentLane }) {
  const [briefs, setBriefs] = useState<EditorialBrief[]>([]); const [lines, setLines] = useState<string[] | null>(null)
  useEffect(() => { let live = true; void readBriefs(editorialClient, clientId(lane), null, null, 15).then(async p => { const outcomes = await Promise.all(p.items.map(b => readBriefOutcomes(editorialClient, clientId(lane), b.identity.brief_id))); if (live) { setBriefs(p.items); setLines(outcomes.flatMap(o => o.observations.map(x => `${x.artifact_role === 'resource' ? 'Resource' : 'Post'} · ${x.metric}: ${x.observed_value} / ${x.denominator} · ${x.attribution} · ${when(x.captured_at)}`))) } }).catch(() => { if(live) setLines([]) }); return () => { live=false } }, [lane])
  return <Group label="Results" pad><p className="a-ct-sub">Post and resource observations are separate. Unknown is retained; this view does not infer sales.</p>{lines === null ? <p className="a-ct-sub">Reading observed outcomes…</p> : lines.length ? <ul className="a-research-results">{lines.map((x,i)=><li key={i}>{x}</li>)}</ul> : <p className="a-ct-sub">No measured outcomes are available for these {briefs.length} suggestions. Missing telemetry is unknown.</p>}</Group>
}

export function ClientDirectionPanel({ lane }: { lane: ContentLane }) {
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
  const [rows, setRows] = useState<Resource[] | null>(null); const [query, setQuery] = useState('')
  useEffect(() => { void fetchResources(lane).then(all => setRows(all.filter(r => r.source === 'hypertarget_demo'))).catch(() => setRows([])) }, [lane])
  const shown = (rows ?? []).filter(r => !query || `${r.topic} ${r.format} ${r.status}`.toLowerCase().includes(query.toLowerCase()))
  return <Group label="Demo resources" tail={<span className="a-dim a-mono">{rows?.length ?? '…'} total records</span>} pad><p className="a-ct-sub">Separate sales/demo records. They are not publishing ideas. Current Ivan scope is 179 records: 156 pending and 23 disqualified.</p><label className="a-research-reason">Search demos <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Topic, format, or status" /></label>{rows === null ? <p className="a-ct-sub">Reading all demo records…</p> : <div className="a-research-list">{shown.map(r => <Card key={r.id} title={r.topic ?? 'Untitled demo'} sub={`${r.format ?? 'format unknown'} · ${r.status}`}><p className="a-ct-sub">Original source: {r.source}. Asset URL: {r.resource_url ?? 'not recorded'}.</p></Card>)}</div>}</Group>
}
