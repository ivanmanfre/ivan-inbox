/* Development-only, read-only rendering of frozen Run 1 evidence. */
import { useEffect, useMemo, useState } from 'react'
import { Button, Card } from '../../../ds'
import { Head, Screen } from '../../kit'
import type { EditorialBrief, SourceSnapshot } from '../../../lib/editorialTypes'
import type { ContentLane } from '../../../lib/content'
import type { Resource } from '../../../lib/styles'
import { BriefCard, EditorialClientProvider, SourceDetail } from './ResearchWorkspace'
import { StrategyView } from '../strategy'
import { makeLocalPreviewClient } from './LocalPreviewClient'

type Data = { briefs: Record<ContentLane, EditorialBrief[]>; resources: Resource[] }
const lanes: ContentLane[] = ['ivan', 'risedtc', 'arch']
async function read(name: string) { const r = await fetch(`/__editorial_preview/${name}`); if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`); return r.json() }

export function LocalPreviewHarness() {
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [lane, setLane] = useState<ContentLane>('ivan')
  const [view, setView] = useState<'workspace' | 'this-week' | 'research' | 'results' | 'direction' | 'demos'>('workspace')
  const [selected, setSelected] = useState<SourceSnapshot | null>(null)
  const [kind, setKind] = useState('all')
  const [query, setQuery] = useState('')
  const load = () => { setError(null); void Promise.all([read('ivan'), read('risedtc'), read('arch'), read('resources')]).then(([a,b,c,r]) => setData({ briefs: { ivan:a.briefs, risedtc:b.briefs, arch:c.briefs }, resources:r.rows })).catch(e => setError(e instanceof Error ? e.message : 'Local files could not be read.')) }
  useEffect(load, [])
  const briefs = data?.briefs[lane] ?? []
  const localClient = useMemo(() => data ? makeLocalPreviewClient(data) : null, [data])
  const sources = useMemo(() => { const m = new Map<string, SourceSnapshot>(); for (const b of briefs) for (const e of b.evidence) if (!m.has(e.source_id)) m.set(e.source_id, { ...e, snapshot_hash:e.source_content_hash, seen_version:1, curation_state:'unseen', permission_state:'granted', derived_field_names:[], age_days:null, body_state:e.passage ? 'full' : 'unavailable', source_identity:{ platform:'preview', native_id:e.source_id, collector_row_id:null }, observed_metrics:typeof e.candidate_fields?.observed_metrics === 'object' && e.candidate_fields.observed_metrics !== null ? e.candidate_fields.observed_metrics as Record<string, unknown> : null, metric_provenance:{ source:null, denominator:null, observation_window:null } } as SourceSnapshot); return [...m.values()] }, [briefs])
  const demos = (data?.resources ?? []).filter(r => r.source === 'hypertarget_demo' && (r as Resource & { client_id: string | null }).client_id == null)
  const publishing = (data?.resources ?? []).filter(r => r.source !== 'hypertarget_demo' && (r as Resource & { client_id: string | null }).client_id == null)
  return <Screen className="a-ct"><Head title="Local editorial workspace" sub="Frozen Run 1 briefs and captured resources. Interactive Strategy actions are simulated locally; production authentication and writes need separate verification." />
    {error && <p role="alert">{error} <Button size="sm" onClick={load}>Try again</Button></p>}{!data && !error && <p>Reading frozen data…</p>}
    {data && <div className="a-body a-local-editorial"><nav aria-label="Client lane" className="a-research-actions">{lanes.map(x => <Button key={x} size="sm" variant={x === lane ? 'primary' : 'quiet'} onClick={() => { setLane(x); setSelected(null) }}>{x}</Button>)}</nav>
      <nav aria-label="Strategy views" className="a-research-actions">{([['workspace','Interactive Strategy'],['this-week','Frozen briefs'],['research','Cited sources'],['results','Results'],['direction','Client direction'],['demos','Demos']] as const).map(([id,label]) => <Button key={id} size="sm" variant={view === id ? 'primary' : 'quiet'} onClick={() => { setView(id); setSelected(null) }}>{label}</Button>)}</nav>
      {view === 'workspace' && localClient && <section><p className="a-ct-sub">Interactive Strategy uses the real panels and frozen briefs with a local simulated editorial transport. Decisions, review, draft, and refresh only record in this browser session; they never reach Supabase.</p><EditorialClientProvider client={localClient}><StrategyView lane={lane} setLane={setLane} /></EditorialClientProvider></section>}
      {view === 'this-week' && <section><h2>This week · {briefs.length} full briefs</h2><p className="a-ct-sub">Expand a brief for claims, evidence passages, limits, measurement, and production requirements. This read-only preview cannot request a draft.</p><div className="a-research-list">{briefs.map(b => <BriefCard key={`${b.identity.brief_id}-${b.identity.version}`} brief={b} lane={lane} reload={() => {}} readOnly />)}</div></section>}
      {view === 'research' && <section><h2>Research · {sources.length} cited source identities</h2><label className="a-research-reason">Source kind <select value={kind} onChange={e => setKind(e.target.value)}><option value="all">All kinds</option>{[...new Set(sources.map(s => s.source_kind))].map(k => <option key={k} value={k}>{k}</option>)}</select></label><p className="a-ct-sub">These are sources cited by the frozen briefs, not the complete collected-source population.</p><div className="a-research-list">{sources.filter(s => kind === 'all' || s.source_kind === kind).map(s => <Card key={s.source_id} title={s.owner} sub={`${s.source_kind} · ${s.source_published_date}`}><p className="a-research-excerpt">{s.passage ?? s.gap_state?.detail ?? 'Original passage unavailable.'}</p><Button size="sm" variant="quiet" onClick={() => setSelected(s)}>Inspect source</Button></Card>)}</div>{selected && <SourceDetail source={selected} lane={lane} close={() => setSelected(null)} previewLinked={briefs.filter(b => b.evidence.some(e => e.source_id === selected.source_id))} readOnly />}</section>}
      {view === 'results' && <section><h2>Results</h2><p className="a-ct-sub">These files contain proposed measurements, not post-publication outcomes. Missing conversion data remains unknown.</p>{briefs.map(b => <Card key={b.identity.brief_id} title={b.editorial_direction.topic}><p>{b.measurements.length ? b.measurements.map(m => `${m.metric_name}: ${m.observed_value}/${m.denominator} (${m.observation_window})`).join('; ') : b.measurements_none_reason ?? 'No measurement recorded.'}</p></Card>)}</section>}
      {view === 'direction' && <section><h2>Client direction</h2><p className="a-ct-sub">Brief direction is visible here. Active direction must be read through the authenticated backend.</p>{briefs.map(b => <Card key={b.identity.brief_id} title={b.editorial_direction.topic}><p>{b.editorial_direction.angle}</p></Card>)}</section>}
      {view === 'demos' && <section><h2>Demos · {demos.length} Ivan records</h2><p className="a-ct-sub">{demos.filter(r => r.status === 'pending').length} pending · {demos.filter(r => r.status === 'disqualified').length} disqualified. {data.resources.length} captured rows in all lanes; {publishing.length} other Ivan resource rows. Demos are separate from publishing ideas. Missing URLs remain counted.</p><label className="a-research-reason">Search demos <input value={query} onChange={e => setQuery(e.target.value)} /></label><div className="a-research-list">{demos.filter(r => !query || `${r.topic} ${r.status} ${r.format}`.toLowerCase().includes(query.toLowerCase())).map(r => <Card key={r.id} title={r.topic ?? 'Untitled demo'} sub={`${r.status} · ${r.format}`}><p className="a-ct-sub">ID {r.id} · asset {r.resource_url ?? 'not recorded'} · campaign {r.campaign_id ?? 'not recorded'}</p></Card>)}</div></section>}
    </div>}</Screen>
}
