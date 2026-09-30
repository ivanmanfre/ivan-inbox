import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { fetchInputs, fetchInputsCounts, type InputsBuyer, type InputsCounts, type InputsOutlier, type InputsPayload, type InputsRead } from '../../../lib/cb22'
import { putOutlierOnBoard } from '../../../lib/outliers'
import { readSwr, writeSwr } from '../../../lib/swr'
import { ConfirmProvider } from '../../../wb/chrome/ConfirmSheet'
import { dHash } from '../../route'
import { Failed, Skeleton } from '../../ui/states'
import { useToast } from '../../ui/toast'
import { LANES, LANE_NAME, OWNER, type Lane } from '../model'
import './inputs.css'

// CONTENT > INPUTS (CB-22). What to act on this week, per client, in this order:
//   1. the top outliers (<= 5, ranked by cb22_inputs: in review, recommended, the
//      strategy-fit judge, then lift), each with one tap (Save idea / Open in Ideas);
//   2. potential buyers (ICP 7+) recorded on the client's own posts in the last 7 days;
//   3. everything else folded: every outlier, the market readout, the evidence archive.
// Two layouts: 'list' (default, the ballot winner) and 'cards' (the runner-up), switched by
// ?layout=cards or the remembered choice (localStorage d-inputs-layout). Correlation only:
// a buyer here is who engaged, never what a post caused.
const OutliersView = lazy(() => import('../../../wb/content/outliers'))
const MarketsView = lazy(() => import('../../../wb/content/markets').then(m => ({ default: m.MarketsView })))
const EvidenceBlock = lazy(() => import('../../../wb/content/evidence/EvidenceBlock').then(m => ({ default: m.EvidenceBlock })))

export type InputsLayout = 'list' | 'cards'
const LAYOUT_KEY = 'd-inputs-layout'
export function layoutOf(q: URLSearchParams): InputsLayout {
  const v = q.get('layout')
  // a ?layout= link (BALLOT.html) is remembered, so the choice survives seat switches and later visits
  if (v === 'cards' || v === 'list') { rememberLayout(v); return v }
  try { return localStorage.getItem(LAYOUT_KEY) === 'cards' ? 'cards' : 'list' } catch { return 'list' }
}
function rememberLayout(l: InputsLayout) { try { localStorage.setItem(LAYOUT_KEY, l) } catch { /* private mode */ } }

type InputsReadState = InputsRead & { savedAt?: string; refreshError?: string }

const swrQ = (lane: Lane) => `cb22-inputs:${lane}`

// The light seat counts live at module level so SeatSwitch (inside Inputs) reads them without a new prop on index.tsx.
let lightCounts: InputsCounts | null = null
const countSubs = new Set<() => void>()
const subCounts = (f: () => void) => { countSubs.add(f); return () => { countSubs.delete(f) } }
const getCounts = () => lightCounts

/** The first paint is cached per seat; the seat counts come from ONE light call; a seat's heavy read happens when it is selected (see Inputs). A failed read is never cached. */
export function useInputs(): { reads: Record<Lane, InputsReadState | null>; refresh: (l: Lane) => void } {
  const [reads, setReads] = useState<Record<Lane, InputsReadState | null>>(() => Object.fromEntries(LANES.map(l => {
    const s = readSwr<InputsPayload>(swrQ(l)); return [l, s ? { kind: 'ready', data: s.payload, savedAt: s.savedAt } : null]
  })) as Record<Lane, InputsReadState | null>)
  const seq = useRef<Record<string, number>>({})
  const load = useCallback((l: Lane) => {
    const n = (seq.current[l] = (seq.current[l] ?? 0) + 1)
    const receive = (r: InputsRead) => {
      if (seq.current[l] !== n) return   // an older read resolving after a newer one never wins
      const savedAt = new Date().toISOString()
      // Keep the saved rows visible and disclose a failed refresh beside them.
      setReads(p => ({ ...p, [l]: r.kind === 'ready' ? { ...r, savedAt }
        : p[l]?.kind === 'ready' ? { ...p[l], refreshError: r.message } : r }))
      if (r.kind === 'ready') writeSwr(swrQ(l), r.data)
    }
    void fetchInputs(l).then(receive).catch(e => receive({ kind: 'failed', message: e instanceof Error ? e.message : 'Outliers could not refresh.' }))
  }, [])
  useEffect(() => {
    void fetchInputsCounts().then(c => { if (c) { lightCounts = c; countSubs.forEach(f => f()) } })
  }, [])
  return { reads, refresh: load }
}

export function inputsTitle(reads: Record<Lane, InputsReadState | null>, lane: Lane): string {
  const r = reads[lane]
  if (!r) return `Outliers for ${LANE_NAME[lane]}: reading…`
  if (r.kind === 'failed') return `Outliers for ${LANE_NAME[lane]}: the read failed`
  const c = r.data.counts, b = r.data.buyers.length
  // one line, no zero counts (P1 judge): "Rise · 2 in review · 3 recommended · 1 buyer"
  const parts = [c.in_review ? `${c.in_review} saved ideas` : '', c.recommended ? `${c.recommended} recommended` : '', b ? `${b} potential buyer${b === 1 ? '' : 's'}` : ''].filter(Boolean)
  return `${LANE_NAME[lane]} · ${parts.length ? parts.join(' · ') : `${r.data.top.length} top outliers`}`
}

function ago(iso: string | null): string {
  if (!iso) return ''
  const d = (Date.now() - Date.parse(iso)) / 86400000
  return !Number.isFinite(d) ? '' : d < 1 ? 'today' : `${Math.round(d)}d`
}
const PLAT: Record<string, string> = { linkedin: 'LinkedIn', x: 'X' }
function hook(text: string): string {
  const lines = text.replace(/\r/g, '').split('\n').map(s => s.trim()).filter(Boolean)
  let h = lines[0] ?? ''
  for (let i = 1; h.length < 60 && i < lines.length; i++) h += ' ' + lines[i]
  return h.length > 220 ? h.slice(0, 217) + '…' : h
}

function SeatSwitch({ lane, setLane, reads }: { lane: Lane; setLane: (l: Lane) => void; reads: Record<Lane, InputsReadState | null> }) {
  const light = useSyncExternalStore(subCounts, getCounts)
  return (
    <div className="in-seats" role="tablist" aria-label="Client">
      {LANES.map(l => {
        const r = reads[l]
        // the selected seat shows its own read; another seat shows the light call's counts (its cached read may be days old)
        const heavy = r?.kind === 'ready' ? r.data.counts : null
        const c = l === lane ? heavy ?? light?.[l] ?? null : light?.[l] ?? heavy
        return (
          <button key={l} type="button" role="tab" aria-selected={lane === l} className={lane === l ? 'in-on' : ''} onClick={() => setLane(l)} data-verb="inputs-seat">
            <b>{LANE_NAME[l]}</b>
            <small>{c ? `${c.in_review} saved · ${c.recommended} rec` : r?.kind === 'failed' ? 'failed' : '…'}</small>
          </button>
        )
      })}
    </div>
  )
}

type UseSt = Record<string, string>

const rowKey = (lane: Lane, o: InputsOutlier) => `${lane}:${o.platform}:${o.post_id}`

function Action({ o, lane, use, onUse }: { o: InputsOutlier; lane: Lane; use: UseSt; onUse: (o: InputsOutlier) => void }) {
  const k = rowKey(lane, o)
  if (o.state === 'decided') return <span className="in-act in-act-done" data-verb="decided">Decided</span>
  if (o.state === 'in_review' || use[k] === 'done') {
    return <a className="in-act in-act-go" href={dHash('content', 'ideas', lane === 'ivan' ? {} : { lane })} data-verb="open-idea">Open in Ideas</a>
  }
  return (
    <button type="button" className="in-act in-act-p" disabled={use[k] === 'busy'} onClick={() => onUse(o)} data-verb="use-outlier">
      {use[k] === 'busy' ? 'Saving…' : 'Save idea'}
    </button>
  )
}

function StateChip({ o, card }: { o: InputsOutlier; card?: boolean }) {
  if (o.state === 'in_review') return <span className="in-chip in-chip-rev" data-state="in_review">Saved idea</span>
  if (o.state === 'decided') return <span className="in-chip in-chip-dec" data-state="decided">Decided</span>
  // list rows mark "recommended" with a lime rank numeral instead of a chip (P1 judge); cards keep the chip
  if (o.state === 'recommended' && card) return <span className="in-chip in-chip-rec" data-state="recommended">Recommended</span>
  return null
}

/** "3.2×" for a lifted row; a search row has no lift, so it shows its likes ("212 likes"). Never "null×" or NaN. */
function liftText(o: InputsOutlier): string {
  if (o.lift != null && Number.isFinite(o.lift)) return `${o.lift}×`
  const n = o.likes ?? o.likes_line
  return n != null && Number.isFinite(n) ? `${n} like${n === 1 ? '' : 's'}` : '—'
}

/** CB-27 source / seller tags (risedtc and arch rows only; Ivan's rows carry none). */
function SourceTags({ o }: { o: InputsOutlier }) {
  const sl = o.seller?.seller
  return (
    <>
      {o.sources?.includes('search') && <span className="in-tag" data-source-tag="search">Search</span>}
      {o.sources?.includes('steady') && <span className="in-tag" data-source-tag="steady">Steady</span>}
      {sl === 'true' && <span className="in-tag" data-seller-tag="true" title={o.seller?.sells || o.seller?.reason || undefined}>Sells to this reader</span>}
      {sl === 'unclear' && <span className="in-tag" data-seller-tag="unclear" title={o.seller?.reason || undefined}>Sells to this reader?</span>}
    </>
  )
}

function ListRow({ o, lane, use, onUse }: { o: InputsOutlier; lane: Lane; use: UseSt; onUse: (o: InputsOutlier) => void }) {
  const k = rowKey(lane, o)
  return (
    <li className="in-row" data-outlier-rank={o.rank} data-platform={o.platform} data-post-id={o.post_id}>
      <span className={`in-rk${o.state === 'recommended' ? ' in-rec' : ''}`} data-state={o.state ?? undefined} title={o.state === 'recommended' ? 'Recommended this week' : undefined}>{o.rank}</span>
      <div className="in-main">
        <p className="in-meta">
          <b data-author>{o.author}</b> · {PLAT[o.platform]} · <span className="in-lift" data-lift={o.lift ?? ''}>{liftText(o)}</span>{o.published_at ? ` · ${ago(o.published_at)}` : ''}
          <SourceTags o={o} /><StateChip o={o} />
        </p>
        {o.url ? <a className="in-hook in-hook-a" href={o.url} target="_blank" rel="noreferrer" data-verb="open-post">{hook(o.text)}</a> : <p className="in-hook">{hook(o.text)}</p>}
        {o.reason && <p className="in-why">{o.fit != null ? `Fit ${o.fit}/10 · ` : ''}{o.reason}</p>}
        {o.calendar_note && <p className="in-note" data-calendar-note>{o.calendar_note}</p>}
        {use[k] && use[k] !== 'busy' && use[k] !== 'done' && <p className="in-why in-bad" role="alert">{use[k]}</p>}
      </div>
      <div className="in-side">
        <Action o={o} lane={lane} use={use} onUse={onUse} />
      </div>
    </li>
  )
}

function Card({ o, lane, use, onUse }: { o: InputsOutlier; lane: Lane; use: UseSt; onUse: (o: InputsOutlier) => void }) {
  const k = rowKey(lane, o)
  return (
    <li className="in-card" data-outlier-rank={o.rank} data-platform={o.platform} data-post-id={o.post_id}>
      <div className="in-card-top"><span className="in-big" data-lift={o.lift ?? ''}>{liftText(o)}</span><StateChip o={o} card /></div>
      <p className="in-meta"><b data-author>{o.author}</b> · {PLAT[o.platform]}{o.published_at ? ` · ${ago(o.published_at)}` : ''}<SourceTags o={o} /></p>
      <p className="in-hook">{hook(o.text)}</p>
      {o.reason && <p className="in-why">{o.fit != null ? `Fit ${o.fit}/10 · ` : ''}{o.reason}</p>}
      {o.calendar_note && <p className="in-note" data-calendar-note>{o.calendar_note}</p>}
      {use[k] && use[k] !== 'busy' && use[k] !== 'done' && <p className="in-why in-bad" role="alert">{use[k]}</p>}
      <div className="in-card-foot">
        <Action o={o} lane={lane} use={use} onUse={onUse} />
        {o.url && <a className="in-open" href={o.url} target="_blank" rel="noreferrer" data-verb="open-post">Open ↗</a>}
      </div>
    </li>
  )
}

function Buyers({ buyers, lane, compact }: { buyers: InputsBuyer[]; lane: Lane; compact?: boolean }) {
  const whose = lane === 'ivan' ? 'your' : `${OWNER[lane]}’s`
  return (
    <section className={`in-block${compact ? ' in-buyers-strip' : ''}`} data-inputs-buyers>
      <div className="in-h"><span>Potential buyers on {whose} posts</span><span className="in-n">{buyers.length}</span></div>
      <p className="in-say">People scored 7/10 or higher for buyer fit and recorded in the past 7 days. Reactions and comments may be older.</p>
      {buyers.length === 0 ? <p className="in-say">No people with a buyer-fit score of 7/10 or higher were recorded for {whose} posts in the past 7 days.</p> : (
        <ul className="in-buyers">
          {buyers.map(b => <li key={b.name + (b.url ?? '')} className="in-buyer">
            <span className="in-icp" title="Buyer fit, 0-10">{b.icp}</span>
            <div className="in-main">
              <p className="in-meta">{b.url ? <a href={b.url} target="_blank" rel="noreferrer" data-verb="open-buyer"><b>{b.name}</b></a> : <b>{b.name}</b>} · {b.commented ? 'commented' : 'reacted'}{b.posts > 1 ? ` on ${b.posts} posts` : ''}{b.last_seen ? <> · last recorded <time dateTime={b.last_seen} title={b.last_seen}>{ago(b.last_seen)}</time></> : ''}</p>
              {b.headline && <p className="in-why">{b.headline}</p>}
              {b.why && <p className="in-why">Buyer fit: {b.why}</p>}
              {b.post_title && <p className="in-why">Recorded on: {b.post_title}</p>}
            </div>
          </li>)}
        </ul>
      )}
    </section>
  )
}

function Folds({ lane, total }: { lane: Lane; total: number }) {
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const fold = (id: string, label: string, body: React.ReactNode) => (
    <details className="in-fold" onToggle={e => { const o = (e.currentTarget as HTMLDetailsElement).open; setOpen(p => ({ ...p, [id]: o })) }} data-inputs-fold={id}>
      <summary>{label}</summary>
      {open[id] && (
        <div className="cn-legacy app wb ds-shell wb-work" data-wblane={lane}>
          <ConfirmProvider><Suspense fallback={<Skeleton lines={5} label="Loading" />}>{body}</Suspense></ConfirmProvider>
        </div>
      )}
    </details>
  )
  return (
    <div className="in-folds">
      {fold('all', `Every outlier (${total})`, <OutliersView key={lane} lane={lane} />)}
      {fold('markets', 'Market readout', <MarketsView key={lane} lane={lane} />)}
      {fold('evidence', 'Evidence: this week, winners, coverage, results', <EvidenceBlock key={lane} lane={lane} />)}
    </div>
  )
}

export function Inputs({ lane, setLane, layout, reads, refresh, phone, insightsOnly }: {
  lane: Lane; setLane: (l: Lane) => void; layout: InputsLayout
  reads: Record<Lane, InputsReadState | null>; refresh: (l: Lane) => void; phone?: boolean; insightsOnly?: boolean
}) {
  const toast = useToast()
  const [use, setUse] = useState<UseSt>({})
  const r = reads[lane]
  // a seat's heavy read runs once per page session, the first time it is selected (a "Save idea" still re-reads)
  const fetched = useRef<Set<Lane>>(new Set())
  useEffect(() => {
    if (fetched.current.has(lane)) return
    fetched.current.add(lane)
    refresh(lane)
  }, [lane, refresh])
  const onUse = useCallback(async (o: InputsOutlier) => {
    const k = rowKey(lane, o)
    setUse(p => ({ ...p, [k]: 'busy' }))
    const res = await putOutlierOnBoard(lane, o.platform, o.post_id)
    if (res.ok) {
      setUse(p => ({ ...p, [k]: 'done' }))
      toast.show({ message: lane === 'ivan' ? 'Saved to Ideas.' : `Saved to ${OWNER[lane]}’s Ideas.`, sub: 'Nothing is scheduled or sent.' })
      refresh(lane)
    } else setUse(p => ({ ...p, [k]: res.message }))
  }, [lane, refresh, toast])
  const data = r?.kind === 'ready' ? r.data : null
  const note = useMemo(() => {
    if (!data) return ''
    const when = data.last_run?.finished_at ? ago(data.last_run.finished_at) : ''
    const run = !when ? 'weekly run: first Monday 15:10 UTC' : when === 'today' ? 'weekly run today' : `weekly run ${when} ago`
    return `${data.counts.window} outliers in 21 days · ${data.counts.judged} judged for fit · ${run}`
  }, [data])

  return (
    <div className={`in in-${layout}`} data-inputs-view data-client={lane} data-layout={layout}>
      {r?.kind === 'ready' && r.refreshError && <div className="in-refresh-notice" role="alert"><p>Showing saved data from {r.savedAt ? <time dateTime={r.savedAt}>{new Date(r.savedAt).toLocaleString()}</time> : 'an unknown time'}.</p><p>Refresh failed: {r.refreshError}</p><button type="button" onClick={() => refresh(lane)}>Retry</button></div>}
      {r?.kind === 'ready' && r.savedAt && !r.refreshError && <p className="in-foot">Last read <time dateTime={r.savedAt}>{new Date(r.savedAt).toLocaleString()}</time>.</p>}
      {!insightsOnly && <section className="in-block in-top" data-inputs-top>
        <div className="in-h in-h-top">
          <span>Top outliers</span>
          <SeatSwitch lane={lane} setLane={setLane} reads={reads} />
        </div>
        {!r ? <Skeleton lines={5} title={false} label="Reading the outliers" />
          : r.kind === 'failed' ? <Failed what={`${LANE_NAME[lane]}’s outliers`} detail={r.message} onRetry={() => refresh(lane)} />
            : r.data.top.length === 0 ? <p className="in-say">No sources currently pass the selection checks for {LANE_NAME[lane]}. Browse Every outlier below for other sources.</p>
              : layout === 'cards' ? (
                <ol className="in-cards">{r.data.top.map(o => <Card key={o.platform + o.post_id} o={o} lane={lane} use={use} onUse={onUse} />)}</ol>
              ) : (
                <ol className="in-list">{r.data.top.map(o => <ListRow key={o.platform + o.post_id} o={o} lane={lane} use={use} onUse={onUse} />)}</ol>
              )}
        {data && <p className="in-foot">{note}</p>}
      </section>}
      {insightsOnly && !r && <Skeleton lines={3} label="Reading insights"/>}
      {insightsOnly && r?.kind === 'failed' && <Failed what="Insights" detail={r.message} onRetry={() => refresh(lane)}/>}
      {data && <Buyers buyers={data.buyers} lane={lane} compact={layout === 'cards' || phone} />}
      <Folds lane={lane} total={data?.counts.outliers ?? 0} />
    </div>
  )
}

/** The existing buyer and evidence readers, folded under Ideas. */
export function IdeaInsights({ lane, phone }: { lane: Lane; phone?: boolean }) {
  const { reads, refresh } = useInputs()
  return <Inputs lane={lane} setLane={() => {}} layout="list" reads={reads} refresh={refresh} phone={phone} insightsOnly/>
}

/** Full source inputs, loaded only for the selected client. */
export function InputsPage({ lane, setLane, phone, query }: { lane: Lane; setLane: (lane: Lane) => void; phone?: boolean; query: URLSearchParams }) {
  const { reads, refresh } = useInputs()
  return <Inputs lane={lane} setLane={setLane} layout={layoutOf(query)} reads={reads} refresh={refresh} phone={phone} />
}
