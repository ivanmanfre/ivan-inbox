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
import { useToast } from '../ui/toast'
import { LANES, LANE_NAME, type Lane } from './model'
import type { IdeaItem } from './ideaModel'
import { IdeaDetail } from './IdeaDetail'
import { IdeaTags } from './ideaTags'
import { SourceBadge, ideaOutlierSource } from './SourceBadge'
import './ideas.css'

export type IdeaBank = {
  items: IdeaItem[]; n: number | null; loading: boolean; error: string | null; refresh: () => void
  scores: IdeaScoreRead; facets: Facet[]; lm?: number | null; unclassified?: number; chip: BanditChipRead
}
export type IdeaBanks = Record<Lane, IdeaBank>
const NO_SCORES: IdeaScoreRead = { ok: false, byRef: new Map(), validated: false }
const NO_CHIP: BanditChipRead = { ok: false, weekStart: null, byRef: new Map(), slots: [] }
function useBank(lane: Lane, enabled: boolean): IdeaBank {
  const [items, setItems] = useState<IdeaItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [version, setVersion] = useState(0)
  const refresh = useCallback(() => setVersion(v => v + 1), [])
  useEffect(() => {
    if (!enabled) return
    let live = true
    const controller = new AbortController()
    setLoading(true)
    void fetchRankedIdeas(lane, controller.signal).then(rows => { if (live) { setItems(rows); setError(null) } })
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
  return { ivan, risedtc, arch }
}
// Kept for callers of the previous facet helper; the best-five surface needs no filters.
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
  catch { return { ivan: [], risedtc: [], arch: [] } }
}
export function Ideas({ banks, phone, lane, onLaneChange }: { banks: IdeaBanks; phone: boolean; lane?: Lane; onLaneChange?: (lane: Lane) => void }) {
  const toast = useToast()
  const [internalSeat, setInternalSeat] = useState<Lane>('ivan')
  const seat = lane ?? internalSeat
  const setSeat = (l: Lane) => { setInternalSeat(l); onLaneChange?.(l) }
  const [sel, setSel] = useState<string | null>(null)
  const [bench, setBench] = useState(false)
  const [saved, setSaved] = useState<Record<Lane, IdeaItem[]>>(readPicks)
  const [skipped, setSkipped] = useState(readSkips)
  const [insights, setInsights] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const b = banks[seat]
  const rows = visibleIdeas(b.items, saved[seat], skipped[seat])
  const shown = bench ? rows : rows.slice(0, 5)
  const current = rows.find(i => i.id === sel)
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
      else await decideClientIdea(it.id, use ? 'approved' : 'rejected')
      if (use) {
        picked = { ...picked, saved: true, generating: !it.outlier }
        setSaved(s => { const list = [picked, ...s[it.lane].filter(i => i.id !== picked.id)]; writeSwr(`content-idea-picks:${it.lane}`, list); return { ...s, [it.lane]: list } })
        toast.show({ message: 'Added ✓', action: { label: 'open', verb: 'open', run: () => { setSeat(it.lane); open(picked.id) } } })
      } else {
        setSkipped(s => { const next = { ...s, [it.lane]: [...s[it.lane], it.id] }; writeSwr('content-idea-skips-v1', next); return next })
        toast.show({ message: 'Skipped.', ...(it.outlier ? { sub: 'Hidden on this device.' } : {}) })
      }
      banks[it.lane].refresh()
    } catch (e) { setError(e instanceof Error ? e.message : 'The idea did not change.') }
    finally { setBusy(null) }
  }
  return <div className={`cn-bestideas${phone ? ' cn-bestideas-phone' : ''}`}>
    <div className="cn-client-switch" role="tablist" aria-label="Client">
      {LANES.map(l => <button key={l} type="button" role="tab" aria-selected={seat === l} className={seat === l ? 'cn-on' : ''} data-verb="lane" data-lane={l} onClick={() => { setSeat(l); setSel(null); setBench(false); setError('') }}>{LANE_NAME[l]}</button>)}
    </div>
    <p className="cn-best-caption">{bench ? 'On the bench' : 'Best 5'} <span>· proof × freshness</span></p>
    {error && <p className="cn-say cn-bad" role="alert">{error}</p>}
    {b.error && <Failed what="Ideas" detail={b.error} onRetry={b.refresh} />}
    {b.loading && !rows.length ? <Skeleton lines={5} title={false} label="Reading ideas" />
      : !rows.length ? !b.error && <p className="cn-say">No fresh ideas waiting.</p>
      : <div className="cn-best-list">{shown.map(it => <article key={it.id} className={`cn-best-card${it.saved ? ' cn-best-added' : ''}`} data-idea-id={it.id}>
        <button type="button" className="cn-best-open" data-verb="open" onClick={() => setSel(sel === it.id ? null : it.id)} aria-expanded={sel === it.id}>
          <span className="cn-best-title">{it.title}</span>
          <span className="cn-best-proof">{it.proof || it.src || 'Idea bank'}</span>
        </button>
        <div className="cn-best-meta"><IdeaTags src={it.src} unvalidated={false} unclassified={it.unclassified}/><time>{it.age}</time></div>
        {ideaOutlierSource(it) && <div className="cn-cbrow" data-idea-id={it.id}><SourceBadge src={ideaOutlierSource(it)}/></div>}
        <div className="cn-best-acts">{it.saved ? <button type="button" className="cn-best-use" onClick={() => open(it.id)}>Added ✓ · open</button> : <>
          <button type="button" className="cn-best-use" data-verb="idea-use" disabled={!!busy || !!it.ivan && !ideaDecidable(it.ivan)} onClick={() => void run(it, true)}>{busy === it.id ? 'Working…' : 'Use'}</button>
          <button type="button" data-verb="idea-skip" disabled={!!busy} onClick={() => void run(it, false)}>Skip</button>
        </>}</div>
        {current?.id === it.id && <IdeaDetail it={it} onDone={done} compact/>}
      </article>)}</div>}
    <details className="cn-idea-insights" onToggle={e => setInsights(e.currentTarget.open)}><summary>Insights & evidence</summary>{insights && <Suspense fallback={<Skeleton lines={3} label="Reading insights"/>}><Insights lane={seat} phone={phone}/></Suspense>}</details>
    {rows.length > 5 && <button type="button" className="cn-bench-link" data-verb="bench" onClick={() => { setBench(v => !v); setSel(null) }}>{bench ? 'Back to best 5' : 'See the bench'}</button>}
  </div>
}
