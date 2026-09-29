import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fetchInputs, type InputsBuyer, type InputsOutlier, type InputsPayload, type InputsRead } from '../../../lib/cb22'
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
//      strategy-fit judge, then lift), each with one tap (Use this / Open in Ideas);
//   2. the buyer-fit people (ICP 7+) who engaged with the client's own posts in the last 7 days;
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

const swrQ = (lane: Lane) => `cb22-inputs:${lane}`

/** One read per seat (the seat switch shows every seat's counts); a failed read is never cached. */
export function useInputs(): { reads: Record<Lane, InputsRead | null>; refresh: (l: Lane) => void } {
  const [reads, setReads] = useState<Record<Lane, InputsRead | null>>(() => Object.fromEntries(LANES.map(l => {
    const s = readSwr<InputsPayload>(swrQ(l)); return [l, s ? { kind: 'ready', data: s.payload } : null]
  })) as Record<Lane, InputsRead | null>)
  const seq = useRef<Record<string, number>>({})
  const load = useCallback((l: Lane) => {
    const n = (seq.current[l] = (seq.current[l] ?? 0) + 1)
    void fetchInputs(l).then(r => {
      if (seq.current[l] !== n) return   // an older read resolving after a newer one never wins
      // a failed re-read never replaces a good first paint
      setReads(p => ({ ...p, [l]: r.kind === 'ready' || p[l]?.kind !== 'ready' ? r : p[l] }))
      if (r.kind === 'ready') writeSwr(swrQ(l), r.data)
    })
  }, [])
  useEffect(() => { LANES.forEach(load) }, [load])
  return { reads, refresh: load }
}

export function inputsTitle(reads: Record<Lane, InputsRead | null>, lane: Lane): string {
  const r = reads[lane]
  if (!r) return `Inputs for ${LANE_NAME[lane]}: reading…`
  if (r.kind === 'failed') return `Inputs for ${LANE_NAME[lane]}: the read failed`
  const c = r.data.counts, b = r.data.buyers.length
  // one line, no zero counts (P1 judge): "Rise · 2 in review · 3 recommended · 1 buyer"
  const parts = [c.in_review ? `${c.in_review} in review` : '', c.recommended ? `${c.recommended} recommended` : '', b ? `${b} buyer${b === 1 ? '' : 's'}` : ''].filter(Boolean)
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

function SeatSwitch({ lane, setLane, reads }: { lane: Lane; setLane: (l: Lane) => void; reads: Record<Lane, InputsRead | null> }) {
  return (
    <div className="in-seats" role="tablist" aria-label="Client">
      {LANES.map(l => {
        const r = reads[l]
        const c = r?.kind === 'ready' ? r.data.counts : null
        return (
          <button key={l} type="button" role="tab" aria-selected={lane === l} className={lane === l ? 'in-on' : ''} onClick={() => setLane(l)} data-verb="inputs-seat">
            <b>{LANE_NAME[l]}</b>
            <small>{c ? `${c.in_review} rev · ${c.recommended} rec` : r?.kind === 'failed' ? 'failed' : '…'}</small>
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
    return <a className="in-act in-act-go" href={dHash('content', 'ideas', lane === 'ivan' ? {} : { lane })} data-verb="open-idea">In review · Ideas</a>
  }
  return (
    <button type="button" className="in-act in-act-p" disabled={use[k] === 'busy'} onClick={() => onUse(o)} data-verb="use-outlier">
      {use[k] === 'busy' ? 'Adding…' : 'Use this'}
    </button>
  )
}

function StateChip({ o, card }: { o: InputsOutlier; card?: boolean }) {
  if (o.state === 'in_review') return <span className="in-chip in-chip-rev" data-state="in_review">In review</span>
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
      {sl === 'true' && <span className="in-tag" data-seller-tag="true" title={o.seller?.sells || o.seller?.reason || undefined}>Seller</span>}
      {sl === 'unclear' && <span className="in-tag" data-seller-tag="unclear" title={o.seller?.reason || undefined}>Seller?</span>}
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
          <b data-author>{o.author}</b> · {PLAT[o.platform]} · <span className="in-lift" data-lift={o.lift ?? undefined}>{liftText(o)}</span>{o.published_at ? ` · ${ago(o.published_at)}` : ''}
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
      <div className="in-card-top"><span className="in-big" data-lift={o.lift ?? undefined}>{liftText(o)}</span><StateChip o={o} card /></div>
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
      <div className="in-h"><span>Buyers on {whose} posts · last 7 days</span><span className="in-n">{buyers.length}</span></div>
      {buyers.length === 0 ? <p className="in-say">No one judged ICP 7+ engaged with {whose} posts in the last 7 days.</p> : (
        <ul className={compact ? 'in-chips' : 'in-buyers'}>
          {buyers.map(b => compact ? (
            <li key={b.name + (b.url ?? '')}>{b.url ? <a href={b.url} target="_blank" rel="noreferrer" data-verb="open-buyer">{b.name} <i>{b.icp}</i></a> : <span>{b.name} <i>{b.icp}</i></span>}</li>
          ) : (
            <li key={b.name + (b.url ?? '')} className="in-buyer">
              <span className="in-icp" title="ICP fit, 0-10">{b.icp}</span>
              <div className="in-main">
                <p className="in-meta">{b.url ? <a href={b.url} target="_blank" rel="noreferrer" data-verb="open-buyer"><b>{b.name}</b></a> : <b>{b.name}</b>} · {b.commented ? 'commented' : 'reacted'}{b.posts > 1 ? ` on ${b.posts} posts` : ''}{b.last_seen ? ` · ${ago(b.last_seen)}` : ''}</p>
                {b.headline && <p className="in-why">{b.headline}</p>}
              </div>
            </li>
          ))}
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

export function Inputs({ lane, setLane, layout, reads, refresh, phone }: {
  lane: Lane; setLane: (l: Lane) => void; layout: InputsLayout
  reads: Record<Lane, InputsRead | null>; refresh: (l: Lane) => void; phone?: boolean
}) {
  const toast = useToast()
  const [use, setUse] = useState<UseSt>({})
  const r = reads[lane]
  const onUse = useCallback(async (o: InputsOutlier) => {
    const k = rowKey(lane, o)
    setUse(p => ({ ...p, [k]: 'busy' }))
    const res = await putOutlierOnBoard(lane, o.platform, o.post_id)
    if (res.ok) {
      setUse(p => ({ ...p, [k]: 'done' }))
      toast.show({ message: lane === 'ivan' ? 'Queued for scoring; it shows in Ideas once scored.' : `Added to ${OWNER[lane]}’s ideas for review.`, sub: 'Nothing is scheduled or sent.' })
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
      <section className="in-block in-top" data-inputs-top>
        <div className="in-h in-h-top">
          <span>Top outliers</span>
          <SeatSwitch lane={lane} setLane={setLane} reads={reads} />
        </div>
        {!r ? <Skeleton lines={5} title={false} label="Reading the outliers" />
          : r.kind === 'failed' ? <Failed what={`${LANE_NAME[lane]}’s inputs`} detail={r.message} onRetry={() => refresh(lane)} />
            : r.data.top.length === 0 ? <p className="in-say">No outlier in the last 21 days for {LANE_NAME[lane]}. Older ones are under Every outlier.</p>
              : layout === 'cards' ? (
                <ol className="in-cards">{r.data.top.map(o => <Card key={o.platform + o.post_id} o={o} lane={lane} use={use} onUse={onUse} />)}</ol>
              ) : (
                <ol className="in-list">{r.data.top.map(o => <ListRow key={o.platform + o.post_id} o={o} lane={lane} use={use} onUse={onUse} />)}</ol>
              )}
        {data && <p className="in-foot">{note}</p>}
      </section>
      {data && <Buyers buyers={data.buyers} lane={lane} compact={layout === 'cards' || phone} />}
      <Folds lane={lane} total={data?.counts.outliers ?? 0} />
    </div>
  )
}
