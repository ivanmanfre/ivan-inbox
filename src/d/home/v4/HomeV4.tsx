import { useMotionLevel } from '../../../ds/motionLevel'
import { useState, type ReactNode } from 'react'
import type { PlaceProps } from '../../places'
import { SEATS, SEAT_NAME, type Seat } from '../../seats'
import { dHash } from '../../route'
import { AnswerRow } from '../../ui/AnswerRow'
import { Figure, mapRead, slotRead } from '../../ui/Figure'
import { FailLine, Offline } from '../../ui/states'
import { useOnline } from '../../ui/useOnline'
import { seriesOf } from '../../lanes/model'
import { readyOf } from '../../lanes/glance/ready'
import { useHome, type HomeData } from '../reads'
import { HomeTasks } from '../Tasks'
import { HotNow } from '../HotNow'
import { readyRead, when, type Read } from '../model'
import { invites, pill } from './model'
import { buildQueue, type QueueSection } from './queue'
import './home4.css'
import { HomeCard } from '../../content/today/HomeCard'
import { useOps } from '../../../hooks/useOps'
import { pendingOps, type OpsDraft } from '../../../lib/ops'
import type { NextPost } from '../../../lib/contentNext'
import { useFrameCounts } from '../../counts/useFrameCounts'
import { refreshNextPosts, useNextPosts } from '../../content/next/store'
import { useStalled } from '../../ui/timeout'
import { useClock } from '../../ui/useClock'
import { warsawDayTime } from '../../ui/time'
import '../phone-ox.css'

/** #39: a failed read says so in a visible line ("Lanes read failed · Retry"), never only in a tooltip.
 *  A stale one keeps its small Stale key. `src` names the read that failed. */
function Retry<T>({ r, retry, src }: { r: Read<T>; retry: () => void; src: string }) {
  if ('fail' in r) return <FailLine what={src} why={r.fail} onRetry={retry} />
  const why = 'v' in r ? r.stale : null
  return why ? <button type="button" className="hm4-retry" data-verb="retry" title={why} onClick={retry}>Stale</button> : null
}
function Band<T>({ id, label, seat, href, r, retry, src, children, warn }: { id: string; label: string; seat: Seat; href: string; r: Read<T>; retry: () => void; src: string; children: ReactNode; warn?: boolean }) {
  return <div className={`hm4-band hm4-${id}${warn ? ' hm4-warn' : ''}`} data-tile={id} data-seat={seat}>
    <a className="hm4-hit" href={href} aria-label={`${SEAT_NAME[seat]} ${label}`}><span className="hm4-label">{label}{warn && <small className="hm4-pill hm4-pill-warn">Below 3</small>}</span>{children}</a><Retry r={r} retry={retry} src={src} />
  </div>
}
function Week({ seat, h }: { seat: Seat; h: HomeData }) {
  const r = h.content[seat], below = 'v' in r && r.v.below
  return <Band id="week" label="Next week" seat={seat} href={dHash('content', null, { lane:seat })} r={r} retry={h.retry.content} src="Content" warn={below}>
    <Figure r={mapRead(r,w => w.n)} size="xl" unit="posts" />
    <span className="hm4-strip" aria-label={'v' in r ? r.v.days.map(d => `${d.dow}: ${d.posts} posts${d.stub ? `, ${d.stub}` : ''}`).join('; ') : 'Reading next week'}>
      {'v' in r ? r.v.days.map(d => <span key={d.key} title={`${d.dow} ${d.n}: ${d.posts} ${d.posts === 1 ? 'post' : 'posts'}${d.stub ? ` · ${d.stub}` : ''}`} tabIndex={-1}><i className={d.posts ? 'hm4-filled' : ''}>{d.posts > 1 ? d.posts : ''}</i><small>{d.dow[0]}</small></span>) : Array.from({length:5},(_,i) => <span key={i}><i className="ols-skeleton" /><small>&nbsp;</small></span>)}
    </span>
  </Band>
}
/** #36: one DM number everywhere: "DMs waiting" is the sidebar's and the tab's number; drafts ride under it. */
function Drafts({ seat, h }: { seat: Seat; h: HomeData }) {
  const r = h.waiting[seat], d = h.drafts[seat]
  return <Band id="drafts" label="DMs waiting" seat={seat} href={dHash('dms',null,{seat})} r={r} retry={h.retry.drafts} src="DMs">
    <span className={'v' in r && r.v > 0 ? 'hm4-action' : ''}><Figure r={r} size="xl" unit={'v' in r && r.v === 0 ? 'none waiting' : undefined} /></span>
    {'v' in r && r.v > 0 && 'v' in d && <small className="hm4-sub">{d.v} drafted</small>}
  </Band>
}
function Review({ seat, h }: { seat: Seat; h: HomeData }) {
  const r = h.review[seat]
  return <Band id="review" label="Posts to review" seat={seat} href={dHash('content', 'now', { lane: seat })} r={r} retry={h.retry.review} src="Content">
    <span className={'v' in r && r.v > 0 ? 'hm4-action' : ''}><Figure r={r} size="xl" unit={'v' in r && r.v === 0 ? 'none waiting' : undefined} /></span>
  </Band>
}
function Invites({ seat, h }: { seat: Seat; h: HomeData }) {
  const r = invites(h,seat), bars = seriesOf(h.lanes.cc.value,seat,h.now,'invitation','sent',7)
  const max = Math.max(1,...bars.map(b => b.v ?? 0))
  return <Band id="invites" label="Invites today" seat={seat} href={dHash('lanes',null,{seat})} r={r} retry={h.retry.lanes} src="Lanes">
    <span className="hm4-inv-row"><Figure r={mapRead(r,x => x.inv)} size="xl" unit={'v' in r && r.v.cap != null ? `/${r.v.cap}` : undefined} />
      <span className="hm4-micro">{bars.map(b => <span key={b.day} title={`${b.day}: ${b.v ?? 'no reading'}`} aria-label={`${b.day}: ${b.v ?? 'no reading'}`}><i data-today={b.today} style={{height:`${b.v == null ? 2 : Math.max(2,b.v / max * 24)}px`}} /></span>)}</span>
    </span>
  </Band>
}
const readyR = (seat: Seat, h: HomeData) => seat === 'swishdm' ? readyRead(h.lanes, seat) : slotRead(h.lanes.ready, v => readyOf(v,seat,h.lanes.gov.value?.find(g => g.client_id === seat)))
function Ready({ seat, h }: { seat: Seat; h: HomeData }) {
  const r = readyR(seat, h)
  const lanes = 'v' in r ? r.v.lanes.filter(l => l.n > 0) : []
  const max = Math.max(1,...lanes.map(l => l.n))
  return <div className="hm4-ready-band"><Band id="ready" label="Ready" seat={seat} href={dHash('lanes',null,{seat})} r={r} retry={h.retry.lanes} src="Lanes">
    <Figure r={mapRead(r,x => x.total)} size="xl" />
  </Band><div className="hm4-ready-lanes">{Array.from({length:3},(_,i) => {const l=lanes[i];return <div key={l?.lane ?? i}>{l ? <a href={l.campaignId ? dHash('lanes',null,{sheet:'campaign',c:l.campaignId}) : dHash('lanes',null,{seat})} title={l.off ?? (l.candidate ? 'Candidates, not verified ready' : l.label)} className={l.off || l.candidate ? 'hm4-dim' : undefined}><span>{l.label}</span><b>{l.capped ? '≥' : ''}{l.n}</b><i style={{width:`${l.n / max * 32}px`}} /></a> : 'wait' in r ? <span className="ols-skeleton" /> : <span>&nbsp;</span>}</div>})}</div>
    {lanes.length > 3 && <a className="hm4-more" href={dHash('lanes',null,{seat})}>+{lanes.length-3} more</a>}
  </div>
}
function Limit({ seat, h }: { seat: Seat; h: HomeData }) {
  const r = pill(h,seat), v = 'v' in r ? r.v : null
  const time = v?.time ? v.word === 'At cap' ? `resets ${v.time}` : v.word === 'Limited' ? `resumes ${when(v.time,h.now)}` : when(v.time,h.now) : null
  return <div className="hm4-limit"><a className={`hm4-pill hm4-pill-${v?.tone ?? 'neutral'}`} href={dHash('lanes',null,{sheet:'control',for:seat})} title={v?.why ?? 'Rate limit'} aria-label={`${SEAT_NAME[seat]} rate limit: ${v?.word ?? 'unverified'}${time ? ` · ${time}` : ''}`}>
    {'wait' in r ? <span className="ols-skeleton" aria-label="Reading rate limit" /> : v ? <><span className="hm4-w">{v.word}</span>{time && <small><span className="hm4-sep"> · </span>{time}</small>}</> : 'Rate limit ?'}
  </a><Retry r={r} retry={h.retry.lanes} src="Lanes" /></div>
}
export function SeatCard({ seat, h }: { seat: Seat; h: HomeData }) {
  return <section className="hm4-card" data-seat={seat} aria-label={SEAT_NAME[seat]} data-bx-block>
    <header><span className="hm4-avatar">{SEAT_NAME[seat][0]}</span><h2>{SEAT_NAME[seat]}</h2><Limit seat={seat} h={h} /></header>
    <div className="hm4-card-bands"><Week seat={seat} h={h} /><Review seat={seat} h={h} /><Drafts seat={seat} h={h} /><Invites seat={seat} h={h} /><Ready seat={seat} h={h} /></div>
  </section>
}
/** Phone matrix: a cell is too narrow for the line, so a row whose read failed gets one line under it. */
function RowFail({ src, rs, retry }: { src: string; rs: Read<unknown>[]; retry: () => void }) {
  const f = rs.find((r): r is { fail: string } => 'fail' in r)
  return f ? <div className="hm4-matrix-fail"><FailLine what={src} why={f.fail} onRetry={retry} /></div> : null
}
function Matrix({ h }: { h: HomeData }) {
  const [open, setOpen] = useState(() => {try{return localStorage.getItem('hm4-ready-open')==='1'}catch{return false}})
  function toggle(){setOpen(v=>{try{localStorage.setItem('hm4-ready-open',v?'0':'1')}catch{/* tab only */}return !v})}
  const seats = SEATS.filter(s => s !== 'anna')
  return <section className="hm4-matrix" aria-label="Seats at a glance" data-bx-block>
    <div className="hm4-matrix-row hm4-matrix-head"><span />{seats.map(s=><b key={s}>{SEAT_NAME[s]}</b>)}</div>
    <div className="hm4-matrix-row"><b>Next week</b>{seats.map(s=><div key={s}><Week seat={s} h={h}/></div>)}</div>
    <RowFail src="Content" rs={seats.map(s => h.content[s])} retry={h.retry.content} />
    <div className="hm4-matrix-row"><b>Posts to review</b>{seats.map(s=><div key={s}><Review seat={s} h={h}/></div>)}</div>
    <RowFail src="Content" rs={seats.map(s => h.review[s])} retry={h.retry.review} />
    <div className="hm4-matrix-row"><b>DMs waiting</b>{seats.map(s=><div key={s}><Drafts seat={s} h={h}/></div>)}</div>
    <RowFail src="DMs" rs={seats.map(s => h.waiting[s])} retry={h.retry.drafts} />
    <div className="hm4-matrix-row"><b>Invites</b>{seats.map(s=><div key={s}><Invites seat={s} h={h}/></div>)}</div>
    <RowFail src="Lanes" rs={seats.map(s => invites(h, s))} retry={h.retry.lanes} />
    <div className={`hm4-matrix-row hm4-matrix-ready${open?' hm4-expanded':''}`}><button type="button" aria-expanded={open} onClick={toggle}>Ready {open?'⌄':'›'}</button>{seats.map(s=><div key={s}><Ready seat={s} h={h}/></div>)}</div>
    <RowFail src="Lanes" rs={seats.map(s => readyR(s, h))} retry={h.retry.lanes} />
    <div className="hm4-matrix-row"><b>Rate limit</b>{seats.map(s=><div key={s}><Limit seat={s} h={h}/></div>)}</div>
    <RowFail src="Lanes" rs={seats.map(s => pill(h, s))} retry={h.retry.lanes} />
  </section>
}
// ---- The queue: what needs him, in money order (queue.ts), fed from the reads Home already makes. ----

/** The post states in the words Content uses for them (Review: "Being re-checked", the Held tag). */
const STATE_WORD: Record<NextPost['state'], string> = { ready: 'ready', checking: 'being re-checked', held: 'held' }
const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
/** A booking card as one queue row: who booked, and the call time in Warsaw time (Ops' own words when the time is unreadable). */
function bookingOf(d: OpsDraft) {
  const c = d.context ?? {}, t = Date.parse(text(c.when_iso))
  return { id: d.id, who: text(c.prospect_name) || text(c.company) || 'Booking', when: Number.isFinite(t) ? warsawDayTime(t) : text(c.when_str) }
}

type Ops = ReturnType<typeof useOps>
/** `failed` names each read that could not be read; `loading` = a read has no live answer yet (still out, or only a
 *  saved copy painted). Only when neither holds is an empty queue "Nothing needs you." `retry` re-runs the failed reads. */
type QueueRead = { sections: QueueSection[]; total: number; loading: boolean; failed: string[]; retry: () => void }

function useQueue(h: HomeData, ops: Ops, opsStalled: boolean): QueueRead {
  const counts = useFrameCounts(), next = useNextPosts(), now = useClock(60_000)
  const failed: string[] = []
  const again = new Set<() => void>(), refreshDms = () => counts.refresh('dms')
  let loading = false
  const waiting: Record<string, number | null> = {}
  for (const s of SEATS) {
    const r = h.waiting[s], slice = counts.dms[s]
    // A failed re-read keeps its last value: the row stays, and the seat is still named as not read.
    waiting[s] = 'v' in r ? r.v : null
    if ('fail' in r || slice.failed) { failed.push(`${SEAT_NAME[s]} replies`); again.add(refreshDms) }
    else if ('wait' in r || slice.saved) loading = true
  }
  // A board read that failed is named even over a good earlier read (its rows stay); a saved board is still reading.
  if (ops.error || opsStalled) { failed.push('bookings'); again.add(ops.refresh) }
  else if (!ops.loadedAt || ops.saved) loading = true
  const call = counts.nextCall
  if (call.failed) { failed.push('next call'); again.add(() => counts.refresh('nextCall')) }
  else if (call.value == null || call.saved) loading = true
  if (next.failed) { failed.push("today's posts"); again.add(() => { void refreshNextPosts() }) }
  else if (!next.loaded) loading = true
  const sections = buildQueue({
    waiting,
    bookings: pendingOps(ops.drafts, now).filter(d => d.kind === 'booking').map(bookingOf),
    nextCall: call.value?.start ? { title: call.value.title || 'Call', start: call.value.start } : null,
    posts: next.posts.map(p => ({ id: p.draft_id, slot_at: p.slot_at, post_text: p.post_text, state: STATE_WORD[p.state] ?? p.state })),
    now: new Date(now),
  })
  return { sections, total: sections.reduce((n, s) => n + s.count, 0), loading, failed, retry: () => { for (const f of again) f() } }
}

const things = (n: number) => `${n} ${n === 1 ? 'thing needs' : 'things need'} you.`
/** The answer line: a count only when every read finished; partial when one failed; the page name while reading. */
function answer(q: QueueRead): string {
  if (q.failed.length) return q.total > 0 ? `At least ${things(q.total)}` : 'Could not read everything that needs you.'
  if (q.loading) return 'Home'
  return q.total > 0 ? things(q.total) : 'Nothing needs you.'
}

function Queue({ q }: { q: QueueRead }) {
  const empty = !q.loading && q.failed.length === 0 && q.sections.length === 0
  return <section className="hm4-queue" aria-label="What needs you" data-home-queue data-bx-block>
    {q.sections.map(s => <section key={s.id} className="hm4-q-sec" data-queue={s.id} aria-labelledby={`hm4-q-${s.id}`}>
      <h2 id={`hm4-q-${s.id}`} className="hm4-q-h">{s.title}</h2>
      <ul className="hm4-q-list">{s.items.map(i => <li key={i.key}>
        <a className={`hm4-q-row${i.warn ? ' hm4-q-warn' : ''}`} href={i.href}><span className="hm4-q-l">{i.label}</span>{i.meta && <small className="hm4-q-m">{i.meta}</small>}</a>
      </li>)}</ul>
    </section>)}
    {q.failed.length > 0 && <p className="hm4-q-note" role="status">Could not read: {q.failed.join(', ')}. <button type="button" className="d-failline-k" data-verb="retry" onClick={q.retry}>Retry</button></p>}
    {q.loading && <p className="hm4-q-wait" role="status"><span className="ols-skeleton" aria-hidden="true" /><span className="ols-sr">Reading what needs you</span></p>}
    {empty && <p className="hm4-q-note">Nothing needs you.</p>}
  </section>
}

export default function HomeV4({ layout }: PlaceProps) {
  const motion = useMotionLevel()
  const h = useHome(), online = useOnline()
  // One board read for the bookings and the Tasks column. 12 s without a live answer (a saved board is not one)
  // counts as failed, re-read quietly every 20 s (Home owns this timer; the Tasks block gets the same verdict).
  const ops = useOps()
  const opsStalled = useStalled((!ops.loadedAt || ops.saved) && !ops.error, ops.refresh)
  const q = useQueue(h, ops, opsStalled)
  // R17: the Tasks block, with its Add row, is hidden only while its read has not finished, whatever the number of open tasks.
  const tasks = Boolean(ops.loadedAt || ops.error || opsStalled)
  return <div data-motion={motion} className={`hm4 hm4-${layout}`} data-d-scroll={layout==='desktop'?'':undefined} data-layout-v4="home">
    {layout==='desktop' && <AnswerRow title={answer(q)} />}{!online && <Offline since={null} />}
    <Queue q={q} />
    <HomeCard />
    <HotNow />
    {tasks && <HomeTasks v4 ops={ops} stalled={opsStalled} />}
    <h2 className="hm4-lanes-h">Lane numbers</h2>
    {layout==='phone' ? <Matrix h={h}/> : <div className="hm4-seats">{SEATS.filter(s => s !== 'anna').map(s=><SeatCard key={s} seat={s} h={h}/>)}</div>}
  </div>
}
