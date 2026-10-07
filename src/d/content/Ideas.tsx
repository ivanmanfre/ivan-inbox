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
import { Answer, Menu, Pill, SeatAv, Seg, type Tone } from './v2/ui'
import { useToast } from '../ui/toast'
import { dHash } from '../route'
import { LANES, LANE_NAME, type Lane } from './model'
import type { IdeaItem } from './ideaModel'
import { IdeaDetail } from './IdeaDetail'
import { IdeaTags } from './ideaTags'
import { SourceBadge, ideaOutlierSource } from './SourceBadge'
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
export function Ideas({ banks, phone, lane, onLaneChange, v2 = false }: { banks: IdeaBanks; phone: boolean; lane?: Lane; onLaneChange?: (lane: Lane) => void; v2?: boolean }) {
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
  const selected = rows.filter(it => it.saved)
  const fresh = rows.filter(it => !it.saved)
  const shown = bench ? fresh : fresh.slice(0, 5)
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
      else await decideClientIdea(it.id, use ? 'approved' : 'rejected')
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
  const card = (it: IdeaItem) => <article key={it.id} className={`cn-best-card${it.saved ? ' cn-best-added' : ''}`} data-idea-id={it.id}>
    <button type="button" className="cn-best-open" data-verb="open" onClick={() => setSel(sel === it.id ? null : it.id)} aria-expanded={sel === it.id}>
      <span className="cn-best-title">{it.title}</span>
      <span className="cn-best-proof">{it.proof || it.src || 'Idea bank'}</span>
    </button>
    <div className="cn-best-meta"><IdeaTags src={it.src} unvalidated={false} unclassified={it.unclassified}/><time>{it.age}</time><EarlyReadChip read={it.patternRead} lane={it.lane} /></div>
    {ideaOutlierSource(it) && <div className="cn-cbrow" data-idea-id={it.id}><SourceBadge src={ideaOutlierSource(it)}/></div>}
    {!(current?.id === it.id && !it.outlier && !it.generating) && <div className="cn-best-acts">{it.generating
      ? <a className="cn-best-use" href={dHash('content', 'now', { lane: it.lane })}>Open Review</a>
      : it.saved ? <button type="button" className="cn-best-use" onClick={() => open(it.id)}>Open saved idea</button> : <>
        <button type="button" className="cn-best-use" data-verb="idea-use" disabled={!!busy || !!it.ivan && !ideaDecidable(it.ivan)} onClick={() => void run(it, true)}>{busy === it.id ? 'Working…' : it.outlier ? 'Save idea' : 'Generate draft'}</button>
        <button type="button" data-verb="idea-skip" disabled={!!busy} onClick={() => void run(it, false)}>{it.outlier ? 'Hide' : 'Archive idea'}</button>
      </>}</div>}
    {current?.id === it.id && <IdeaDetail it={it} onDone={done} compact/>}
  </article>
  if (v2) {
    const who = seat === 'ivan' ? 'Ivan' : LANE_NAME[seat]
    const v2card = (it: IdeaItem, rank: number | null) => {
      const expanded = sel === it.id
      const src = ideaOutlierSource(it)
      return <article key={it.id} className={`cv2-idea${it.saved ? ' cv2-idea-saved' : ''}${it.generating ? ' cv2-idea-gen' : ''}`} data-idea-id={it.id} style={{ '--i': rank ?? 0 } as React.CSSProperties}>
        {rank != null && <span className="cv2-rank" aria-hidden="true">{rank}</span>}
        <div className="cv2-idea-main">
          <button type="button" className="cv2-idea-t" data-verb="open" aria-expanded={expanded} onClick={() => setSel(expanded ? null : it.id)}>{it.title}</button>
          <div className="cv2-idea-meta">
            {it.proof && <b>{it.proof}</b>}
            <Pill tone={ideaTone(it.src)}>{it.src || 'Idea bank'}</Pill>
            <time>{it.age}</time>
            <EarlyReadChip read={it.patternRead} lane={it.lane} />
            {src && <SourceBadge src={src} />}
          </div>
          {it.generating && <p className="cv2-shimmer" role="status">Drafting… it appears in Review</p>}
          {expanded && <IdeaDetail it={it} onDone={done} compact />}
        </div>
        <div className="cv2-idea-acts">
          {it.generating ? <a className="cv2-k" href={dHash('content', 'now', { lane: it.lane })}>Open in Review →</a>
            : it.saved ? <button type="button" className="cv2-k" onClick={() => open(it.id)}>Open saved idea</button>
              : !(expanded && !it.outlier) && <button type="button" className="cv2-k cv2-k-p" data-verb="idea-use" disabled={!!busy || !!it.ivan && !ideaDecidable(it.ivan)} onClick={() => void run(it, true)}>{busy === it.id ? 'Working…' : it.outlier ? 'Save idea' : 'Generate draft'}</button>}
          {!it.saved && !it.generating && <Menu label="More for this idea" verb="idea-more" items={[{ key: 'skip', label: it.outlier ? 'Hide on this device' : 'Archive idea', run: () => void run(it, false) }]} />}
        </div>
      </article>
    }
    return <div className={`cv2 cv2-ideas${phone ? ' cv2-phone' : ''}`} data-cv2="ideas">
      <div className="cv2-bar">
        <Seg label="Client" verb="lane" value={seat} onChange={id => { setSeat(id as Lane); setSel(null); setBench(false); setError('') }}
          options={LANES.map(l => ({ id: l, label: <><SeatAv lane={l} />{LANE_NAME[l]}</>, count: banks[l].n ?? '…' }))} />
        <span className="cv2-grow" />
        <button type="button" className="cv2-k cv2-k-q" aria-expanded={insights} data-verb="idea-insights" onClick={() => setInsights(v => !v)}>Insights & evidence {insights ? '▾' : '▸'}</button>
      </div>
      <Answer>{b.loading && !fresh.length ? `Reading ${who}’s ideas…` : !fresh.length ? `No fresh ideas wait for ${who}.`
        : <>Best {Math.min(5, fresh.length)} for {who} · proof × freshness.{fresh.length > 5 && ` ${fresh.length - 5} more on the bench.`}</>}</Answer>
      {insights && <section className="cv2-panel" aria-label="Insights and evidence"><Suspense fallback={<Skeleton lines={3} label="Reading insights" />}><Insights lane={seat} phone={phone} /></Suspense></section>}
      {error && <div className="cv2-banner cv2-banner-bad" role="alert"><span>{error}</span></div>}
      {b.error ? <div className="cv2-banner cv2-banner-bad" role="alert"><span>Ideas could not be read: {b.error}</span><button type="button" onClick={b.refresh}>Retry</button></div>
        : stalled && <div className="cv2-banner cv2-banner-warn" role="alert"><span>Ideas did not answer in 12 s.</span><button type="button" data-verb="ideas-retry" onClick={b.refresh}>Retry</button></div>}
      {selected.length > 0 && <section aria-label="Selected ideas" className="cv2-sec"><h2 className="cv2-h">Selected <span>drafts you requested and saved ideas</span></h2><div className="cv2-ideas-list">{selected.map(it => v2card(it, null))}</div></section>}
      <section aria-label={bench ? 'On the bench' : 'Best 5'} className="cv2-sec">
        {selected.length > 0 && <h2 className="cv2-h">{bench ? 'On the bench' : 'Best 5'}</h2>}
        {b.loading && !fresh.length && !stalled ? <div className="cv2-ideas-list" aria-busy="true">{[0, 1, 2].map(i => <div key={i} className="cv2-ghost cv2-ghost-idea" />)}</div>
          : fresh.length > 0 && <div className="cv2-ideas-list">{shown.map((it, i) => v2card(it, i + 1))}</div>}
      </section>
      <div className="cv2-foot">
        {fresh.length > 5 && <button type="button" className="cv2-showmore" data-verb="bench" aria-expanded={bench} onClick={() => { setBench(v => !v); setSel(null) }}>{bench ? 'Back to the best 5' : `See the bench · ${fresh.length - 5}`}</button>}
        {hidden.length > 0 && <button type="button" className="cv2-link" onClick={() => restore(seat, hidden)}>Restore hidden ideas ({hidden.length})</button>}
      </div>
    </div>
  }
  return <div className={`cn-bestideas${phone ? ' cn-bestideas-phone' : ''}`}>
    <div className="cn-client-switch" role="tablist" aria-label="Client">
      {LANES.map(l => <button key={l} type="button" role="tab" aria-selected={seat === l} className={seat === l ? 'cn-on' : ''} data-verb="lane" data-lane={l} onClick={() => { setSeat(l); setSel(null); setBench(false); setError('') }}>{LANE_NAME[l]}</button>)}
    </div>
    {error && <p className="cn-say cn-bad" role="alert">{error}</p>}
    {b.error && <Failed what="Ideas" detail={b.error} onRetry={b.refresh} />}
    {selected.length > 0 && <section aria-label="Selected ideas" className="cn-selected-ideas"><p className="cn-best-caption">Selected <span>· saved ideas and requested drafts</span></p><div className="cn-best-list">{selected.map(card)}</div></section>}
    <section aria-label={bench ? 'On the bench' : 'Best 5'}>
      <p className="cn-best-caption">{bench ? 'On the bench' : 'Best 5'} <span>· proof × freshness</span></p>
      {b.loading && !fresh.length ? <Skeleton lines={5} title={false} label="Reading ideas" />
        : !fresh.length ? !b.error && <p className="cn-say">No fresh ideas waiting.</p>
        : <div className="cn-best-list">{shown.map(card)}</div>}
      {fresh.length > 5 && <button type="button" className="cn-bench-link" data-verb="bench" onClick={() => { setBench(v => !v); setSel(null) }}>{bench ? 'Back to best 5' : 'See the bench'}</button>}
    </section>
    {hidden.length > 0 && <button type="button" className="cn-bench-link" onClick={() => restore(seat, hidden)}>Restore hidden ideas ({hidden.length})</button>}
    <details className="cn-idea-insights" onToggle={e => setInsights(e.currentTarget.open)}><summary>Insights & evidence</summary>{insights && <Suspense fallback={<Skeleton lines={3} label="Reading insights"/>}><Insights lane={seat} phone={phone}/></Suspense>}</details>
  </div>
}

/** Source tags on the status pairs (SPEC-content §2.5): calls = info, competitor = danger-soft, X = neutral, sessions = success-soft. */
function ideaTone(src: string | null | undefined): Tone {
  const v = (src ?? '').toLowerCase()
  if (/call/.test(v)) return 'info'
  if (/competitor|rival/.test(v)) return 'bad'
  if (/session|claude|own/.test(v)) return 'ok'
  return 'neutral'
}
