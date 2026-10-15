import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { readSwr, writeSwr } from '../../lib/swr'
import { fetchRankedIdeas, visibleIdeas } from '../../lib/rankedIdeas'
import { decideIdea, ideaDecidable } from '../../lib/content'
import { decideClientIdea } from '../../lib/clientIdeas'
import { putOutlierOnBoard } from '../../lib/outliers'
import type { IdeaScoreRead } from '../../lib/ideaScores'
import type { BanditChipRead } from '../../lib/banditChip'
import { applyFilters, CLIENT_IDEA_SPECS, IDEA_SPECS, type Facet, type FilterState } from '../../lib/contentFilters'
import type { IdeaCandidate } from '../../lib/content'
import type { ClientIdea } from '../../lib/clientIdeas'
import { Failed, Skeleton } from '../ui/states'
import { useStalled } from '../ui/timeout'
import { Answer, Menu, SeatAv, Seg } from './v2/ui'
import { useToast } from '../ui/toast'
import { dHash } from '../route'
import { warsawHm } from '../ui/time'
import { LANES, LANE_NAME, type Lane } from './model'
import type { IdeaItem } from './ideaModel'
import { IdeaDetail } from './IdeaDetail'
import { EarlyReadChip } from './EarlyReadChip'
import './ideas.css'

export type IdeaBank = {
  items: IdeaItem[]; n: number | null; loading: boolean; error: string | null; refresh: () => void
  scores: IdeaScoreRead; facets: Facet[]; lm?: number | null; unclassified?: number; chip: BanditChipRead
}
export type IdeaBanks = Record<Lane, IdeaBank>
const NO_SCORES: IdeaScoreRead = { ok: false, byRef: new Map(), validated: false }
const NO_CHIP: BanditChipRead = { ok: false, weekStart: null, byRef: new Map(), slots: [] }
function useBank(lane: Lane, enabled: boolean): IdeaBank {
  const [items, setItems] = useState<IdeaItem[]>(() => {
    const saved = readSwr<IdeaItem[]>(`content-ranked-ideas:${lane}`)
    return saved && Date.now() - Date.parse(saved.savedAt) < 30 * 60_000 && Array.isArray(saved.payload) ? saved.payload : []
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [version, setVersion] = useState(0)
  const refresh = useCallback(() => setVersion(v => v + 1), [])
  useEffect(() => {
    if (!enabled) return
    let live = true
    const controller = new AbortController()
    setLoading(true)
    void fetchRankedIdeas(lane, controller.signal, version > 0).then(rows => { if (live) { setItems(rows); setError(null); writeSwr(`content-ranked-ideas:${lane}`, rows) } })
      .catch(e => { if (live) setError(e instanceof Error ? e.message : 'Could not read ideas.') })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false; controller.abort() }
  }, [lane, version, enabled])
  return { items, n: loading && !items.length ? null : items.length, loading, error, refresh, scores: NO_SCORES, facets: [], chip: NO_CHIP }
}
export function useIdeaBanks(enabled = true, activeLane?: Lane): IdeaBanks {
  const ivan = useBank('ivan', enabled && (!activeLane || activeLane === 'ivan'))
  const risedtc = useBank('risedtc', enabled && (!activeLane || activeLane === 'risedtc'))
  const arch = useBank('arch', enabled && (!activeLane || activeLane === 'arch'))
  const swishdm = useBank('swishdm', enabled && (!activeLane || activeLane === 'swishdm'))
  return { ivan, risedtc, arch , swishdm: swishdm}
}
// Kept for callers of the previous facet helper.
export function filtered(items: IdeaItem[], lane: Lane, f: FilterState): IdeaItem[] {
  if (!Object.keys(f).length) return items
  const keep = new Set(lane === 'ivan'
    ? applyFilters(items.map(i => i.ivan).filter((x): x is IdeaCandidate => !!x), IDEA_SPECS, f).map(i => i.id)
    : applyFilters(items.map(i => i.client).filter((x): x is ClientIdea => !!x), CLIENT_IDEA_SPECS, f).map(i => i.id))
  return items.filter(i => keep.has(i.id))
}
export const PAGE = 40
const Insights = lazy(() => import('./inputs/Inputs').then(m => ({ default: m.IdeaInsights })))
function readPicks(): Record<Lane, IdeaItem[]> {
  return Object.fromEntries(LANES.map(l => { const r = readSwr<IdeaItem[]>(`content-idea-picks:${l}`); return [l, r && Date.now() - Date.parse(r.savedAt) < 86400000 && Array.isArray(r.payload) ? r.payload : []] })) as Record<Lane, IdeaItem[]>
}
function readSkips(): Record<Lane, string[]> {
  try { const d = readSwr<Record<Lane, string[]>>('content-idea-skips-v1')?.payload || {} as Record<Lane, string[]>; return Object.fromEntries(LANES.map(l => [l, Array.isArray(d[l]) ? d[l].filter((id: unknown) => typeof id === 'string') : []])) as Record<Lane, string[]> }
  catch { return { ivan: [], risedtc: [], arch: [] , swishdm: []} }
}
export function Ideas({ banks, phone, lane, onLaneChange, v2 = false }: { banks: IdeaBanks; phone: boolean; lane?: Lane; onLaneChange?: (lane: Lane) => void; v2?: boolean }) {
  const toast = useToast()
  const [internalSeat, setInternalSeat] = useState<Lane>('ivan')
  const seat = lane ?? internalSeat
  const setSeat = (l: Lane) => { setInternalSeat(l); onLaneChange?.(l) }
  const [sel, setSel] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [source, setSource] = useState('')
  const [sort, setSort] = useState('best')
  const [saved, setSaved] = useState<Record<Lane, IdeaItem[]>>(readPicks)
  const [skipped, setSkipped] = useState(readSkips)
  const [insights, setInsights] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  useEffect(() => { setQuery(''); setSource(''); setSort('best'); setSel(null); setError('') }, [seat])
  const b = banks[seat]
  const rankedAt = b.items[0]?.rankedAt
  const rankedTime = rankedAt && Number.isFinite(Date.parse(rankedAt)) ? warsawHm(rankedAt) : null
  const rows = visibleIdeas(b.items, saved[seat], skipped[seat])
  const selected = rows.filter(it => it.saved)
  const fresh = rows.filter(it => !it.saved)
  const sources = [...new Set(fresh.map(it => it.src || 'Idea bank'))].sort((a, b) => a.localeCompare(b))
  const search = query.trim().toLocaleLowerCase()
  const shown = fresh.filter(it => (!source || (it.src || 'Idea bank') === source) && (!search || [it.title, it.src, it.proof, it.angle, it.why, it.evidenceQuote, it.outlier?.author].some(value => value?.toLocaleLowerCase().includes(search))))
  if (sort === 'newest') {
    const date = (it: IdeaItem) => { const value = Date.parse(it.ivan?.ingested_at || it.client?.created_at || it.outlier?.published_at || ''); return Number.isFinite(value) ? value : -Infinity }
    shown.sort((a, b) => date(b) - date(a))
  }
  const sourcePosts = rows.filter(it => !!it.outlier).length
  const bankIdeas = rows.length - sourcePosts
  const counts = `${rows.length} ${rows.length === 1 ? 'idea' : 'ideas'} · ${bankIdeas} bank ${bankIdeas === 1 ? 'idea' : 'ideas'} · ${sourcePosts} source ${sourcePosts === 1 ? 'post' : 'posts'}`
  const browsing = <div className="cn-idea-browser">
    <div className="cn-idea-controls">
      <input type="search" aria-label="Search fresh ideas" placeholder="Search ideas, sources, evidence…" value={query} onChange={e => setQuery(e.target.value)} />
      <select aria-label="Source" value={source} onChange={e => setSource(e.target.value)}><option value="">All sources</option>{sources.map(src => <option key={src} value={src}>{src}</option>)}</select>
      <select aria-label="Sort ideas" value={sort} onChange={e => setSort(e.target.value)}><option value="best">Best ranked</option><option value="newest">Newest first</option></select>
    </div>
    <div className="cn-idea-results"><span role="status">Showing {shown.length} of {fresh.length} fresh ideas</span>{(query || source) && <button type="button" onClick={() => { setQuery(''); setSource('') }}>Clear filters</button>}</div>
  </div>
  const hidden = skipped[seat].filter(id => /^(x|linkedin):/.test(id))
  const restore = (lane: Lane, ids: string[]) => setSkipped(s => { const next = { ...s, [lane]: s[lane].filter(id => !ids.includes(id)) }; writeSwr('content-idea-skips-v1', next); return next })
  const current = rows.find(i => i.id === sel)
  // Brief 4: a first read with no answer in 12 s says so (SPEC-content §2.5); it never stays an endless skeleton.
  const stalled = useStalled(v2 && b.loading && !fresh.length && !b.error, b.refresh)
  const open = (id: string) => { setSel(id); requestAnimationFrame(() => Array.from(document.querySelectorAll<HTMLElement>('[data-idea-detail]')).find(el => el.dataset.ideaDetail === id)?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })) }
  const done = (id: string) => { setSel(null); setSaved(s => { const list = s[seat].filter(i => i.id !== id); writeSwr(`content-idea-picks:${seat}`,list); return { ...s,[seat]:list } }); b.refresh() }
  const run = async (it: IdeaItem, use: boolean) => {
    if (busy || it.saved) return
    setBusy(it.id); setError('')
    try {
      let picked = it
      if (it.outlier) {
        if (use) {
          const r = await putOutlierOnBoard(it.lane, it.outlier.platform, it.outlier.post_id)
          if (!r.ok) throw new Error(r.message)
          picked = { ...it, id: r.id, saved: true }
        }
      } else if (it.ivan) await decideIdea(it.ivan, use ? 'approve' : 'reject', '')
      else await decideClientIdea(it.id, use ? 'approved' : 'rejected', it.lane)
      if (use) {
        picked = { ...picked, saved: true, generating: !it.outlier }
        setSaved(s => { const list = [picked, ...s[it.lane].filter(i => i.id !== picked.id)]; writeSwr(`content-idea-picks:${it.lane}`, list); return { ...s, [it.lane]: list } })
        toast.show({ message: it.outlier ? 'Saved to Ideas.' : 'Draft requested. It will appear in Review.', sub: it.outlier ? 'Nothing is scheduled or sent.' : undefined, action: { label: it.outlier ? 'Open idea' : 'Open Review', verb: 'open', run: () => { if (it.outlier) { setSeat(it.lane); open(picked.id) } else location.hash = dHash('content', 'now', { lane: it.lane }) } } })
      } else {
        setSkipped(s => { const next = { ...s, [it.lane]: [...s[it.lane], it.id] }; writeSwr('content-idea-skips-v1', next); return next })
        toast.show(it.outlier ? { message: 'Hidden on this device.', action: { label: 'Undo', verb: 'undo', run: () => restore(it.lane, [it.id]) } } : { message: 'Idea archived.' })
      }
      banks[it.lane].refresh()
    } catch (e) { setError(e instanceof Error ? e.message : 'The idea did not change.') }
    finally { setBusy(null) }
  }
  const detail = (it: IdeaItem) => <div className="cn-idea-expanded">
    {it.proof && it.proof !== it.src && <p className="cn-idea-proof">{it.proof}</p>}
    <EarlyReadChip read={it.patternRead} lane={it.lane} />
    <IdeaDetail it={it} onDone={done} compact/>
  </div>
  const card = (it: IdeaItem) => <article key={it.id} className={`cn-best-card${it.saved ? ' cn-best-added' : ''}`} data-idea-id={it.id}>
    <button type="button" className="cn-best-open" data-verb="open" onClick={() => setSel(sel === it.id ? null : it.id)} aria-expanded={sel === it.id}>
      <span className="cn-best-title">{it.title}</span>
      <span className="cn-best-meta"><span>{it.src || 'Idea bank'}</span>{it.age && <time>{it.age}</time>}</span>
    </button>
    {!(current?.id === it.id && !it.outlier && !it.generating) && <div className="cn-best-acts">{it.generating
      ? <a className="cn-best-use" href={dHash('content', 'now', { lane: it.lane })}>Open Review</a>
      : it.saved ? <button type="button" className="cn-best-use" onClick={() => open(it.id)}>Open saved idea</button> : <>
        <button type="button" className="cn-best-use" data-verb="idea-use" disabled={!!busy || it.lane === 'swishdm' || !!it.ivan && !ideaDecidable(it.ivan)} onClick={() => void run(it, true)}>{busy === it.id ? 'Working…' : it.outlier ? 'Save idea' : it.lane === 'swishdm' ? 'Setup pending' : 'Generate draft'}</button>
        <button type="button" data-verb="idea-skip" disabled={!!busy} onClick={() => void run(it, false)}>{it.outlier ? 'Hide' : 'Archive idea'}</button>
      </>}</div>}
    {current?.id === it.id && detail(it)}
  </article>
  if (v2) {
    const who = seat === 'ivan' ? 'Ivan' : LANE_NAME[seat]
    const v2card = (it: IdeaItem, rank: number | null) => {
      const expanded = sel === it.id
      return <article key={it.id} className={`cv2-idea${it.saved ? ' cv2-idea-saved' : ''}${it.generating ? ' cv2-idea-gen' : ''}`} data-idea-id={it.id} style={{ '--i': Math.min(rank ?? 0, 10) } as React.CSSProperties}>
        {rank != null && <span className="cv2-rank" aria-hidden="true">{rank}</span>}
        <div className="cv2-idea-main">
          <button type="button" className="cv2-idea-open" data-verb="open" aria-expanded={expanded} onClick={() => setSel(expanded ? null : it.id)}>
            <span className="cv2-idea-t">{it.title}</span>
            <span className="cv2-idea-meta"><span>{it.src || 'Idea bank'}</span>{it.age && <time>{it.age}</time>}</span>
          </button>
          {it.generating && <p className="cv2-shimmer" role="status">Drafting… it appears in Review</p>}
        </div>
        <div className="cv2-idea-acts">
          {it.generating ? <a className="cv2-k" href={dHash('content', 'now', { lane: it.lane, idea: it.id })}>Open in Review →</a>
            : it.saved ? <button type="button" className="cv2-k" onClick={() => open(it.id)}>Open saved idea</button>
              : !(expanded && !it.outlier) && <button type="button" className="cv2-k cv2-k-p" data-verb="idea-use" disabled={!!busy || it.lane === 'swishdm' || !!it.ivan && !ideaDecidable(it.ivan)} onClick={() => void run(it, true)}>{busy === it.id ? 'Working…' : it.outlier ? 'Save idea' : it.lane === 'swishdm' ? 'Setup pending' : 'Generate draft'}</button>}
          {!it.saved && !it.generating && <Menu label="More for this idea" verb="idea-more" items={[{ key: 'skip', label: it.outlier ? 'Hide on this device' : 'Archive idea', run: () => void run(it, false) }]} />}
        </div>
        {expanded && detail(it)}
      </article>
    }
    return <div className={`cv2 cv2-ideas${phone ? ' cv2-phone' : ''}`} data-cv2="ideas">
      <div className="cv2-bar">
        <Seg label="Client" verb="lane" value={seat} onChange={id => { setSeat(id as Lane); setSel(null); setError('') }}
          options={LANES.map(l => ({ id: l, label: <><SeatAv lane={l} />{LANE_NAME[l]}</>, count: banks[l].n == null && !saved[l].length ? '…' : visibleIdeas(banks[l].items, saved[l], skipped[l]).length }))} />
        <span className="cv2-grow" />
        <button type="button" className="cv2-k cv2-k-q" aria-expanded={insights} data-verb="idea-insights" onClick={() => setInsights(v => !v)}>Insights & evidence {insights ? '▾' : '▸'}</button>
      </div>
      <Answer>{b.loading && !fresh.length ? `Reading ${who}’s ideas…` : b.error && !fresh.length ? `${who}’s ideas could not be read.`
        : <>{counts} for {who}</>}{rankedTime && <span className="cv2-ans-x"> · Ranked {rankedTime} Warsaw</span>}</Answer>
      {insights && <section className="cv2-panel" aria-label="Insights and evidence"><Suspense fallback={<Skeleton lines={3} label="Reading insights" />}><Insights lane={seat} phone={phone} /></Suspense></section>}
      {error && <div className="cv2-banner cv2-banner-bad" role="alert"><span>{error}</span></div>}
      {b.error ? <div className="cv2-banner cv2-banner-bad" role="alert"><span>{fresh.length ? 'Ideas could not be refreshed. These are from the last read.' : 'The ideas read did not come back.'}</span><button type="button" onClick={b.refresh}>Retry</button></div>
        : stalled && <div className="cv2-banner cv2-banner-warn" role="alert"><span>Ideas did not answer in 12 s.</span><button type="button" data-verb="ideas-retry" onClick={b.refresh}>Retry</button></div>}
      {selected.length > 0 && <section aria-label="Selected ideas" className="cv2-sec"><h2 className="cv2-h">Selected <span>drafts you requested and saved ideas</span></h2><div className="cv2-ideas-list">{selected.map(it => v2card(it, null))}</div></section>}
      <section aria-label="Fresh ideas" className="cv2-sec">
        {browsing}
        {selected.length > 0 && <h2 className="cv2-h">Fresh ideas</h2>}
        {b.loading && !fresh.length && !stalled ? <div className="cv2-ideas-list" aria-busy="true">{[0, 1, 2].map(i => <div key={i} className="cv2-ghost cv2-ghost-idea" />)}</div>
          : shown.length > 0 ? <div className="cv2-ideas-list">{shown.map(it => v2card(it, fresh.indexOf(it) + 1))}</div> : !b.loading && !b.error && <p className="cn-say">{fresh.length ? 'No ideas match your search or source.' : 'No fresh ideas waiting.'}</p>}
      </section>
      <div className="cv2-foot">
        {hidden.length > 0 && <button type="button" className="cv2-link" onClick={() => restore(seat, hidden)}>Restore hidden ideas ({hidden.length})</button>}
      </div>
    </div>
  }
  return <div className={`cn-bestideas${phone ? ' cn-bestideas-phone' : ''}`}>
    <div className="cn-client-switch" role="tablist" aria-label="Client">
      {LANES.map(l => <button key={l} type="button" role="tab" aria-selected={seat === l} className={seat === l ? 'cn-on' : ''} data-verb="lane" data-lane={l} onClick={() => { setSeat(l); setSel(null); setError('') }}>{LANE_NAME[l]}</button>)}
    </div>
    {error && <p className="cn-say cn-bad" role="alert">{error}</p>}
    {b.error && <Failed what="Ideas" detail={b.error} onRetry={b.refresh} />}
    {selected.length > 0 && <section aria-label="Selected ideas" className="cn-selected-ideas"><p className="cn-best-caption">Selected <span>· saved ideas and requested drafts</span></p><div className="cn-best-list">{selected.map(card)}</div></section>}
    <section aria-label="Fresh ideas">
      <p className="cn-best-caption">{counts}<span>{rankedTime && ` · Ranked ${rankedTime} Warsaw`}</span></p>
      {browsing}
      {b.loading && !fresh.length ? <Skeleton lines={5} title={false} label="Reading ideas" />
        : !fresh.length ? !b.error && <p className="cn-say">No fresh ideas waiting.</p>
        : shown.length ? <div className="cn-best-list">{shown.map(card)}</div> : <p className="cn-say">No ideas match your search or source.</p>}
    </section>
    {hidden.length > 0 && <button type="button" className="cn-restore-link" onClick={() => restore(seat, hidden)}>Restore hidden ideas ({hidden.length})</button>}
    <details className="cn-idea-insights" onToggle={e => setInsights(e.currentTarget.open)}><summary>Insights & evidence</summary>{insights && <Suspense fallback={<Skeleton lines={3} label="Reading insights"/>}><Insights lane={seat} phone={phone}/></Suspense>}</details>
  </div>
}
