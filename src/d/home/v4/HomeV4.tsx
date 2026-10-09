import { useMotionLevel } from '../../../ds/motionLevel'
import { useState, type ReactNode } from 'react'
import type { PlaceProps } from '../../places'
import { SEATS, SEAT_NAME, type Seat } from '../../seats'
import { dHash } from '../../route'
import { AnswerRow } from '../../ui/AnswerRow'
import { Figure, mapRead, slotRead } from '../../ui/Figure'
import { Offline } from '../../ui/states'
import { useOnline } from '../../ui/useOnline'
import { seriesOf } from '../../lanes/model'
import { readyOf } from '../../lanes/glance/ready'
import { useHome, type HomeData } from '../reads'
import { HomeTasks } from '../Tasks'
import { when, type Read } from '../model'
import { invites, pill } from './model'
import './home4.css'
import '../phone-ox.css'

function Retry<T>({ r, retry }: { r: Read<T>; retry: () => void }) {
  const why = 'fail' in r ? r.fail : 'v' in r ? r.stale : null
  return why ? <button type="button" className="hm4-retry" data-verb="retry" title={why} onClick={retry}>{'v' in r ? 'Stale' : 'Retry'}</button> : null
}
function Band<T>({ id, label, seat, href, r, retry, children, warn }: { id: string; label: string; seat: Seat; href: string; r: Read<T>; retry: () => void; children: ReactNode; warn?: boolean }) {
  return <div className={`hm4-band hm4-${id}${warn ? ' hm4-warn' : ''}`} data-tile={id} data-seat={seat}>
    <a className="hm4-hit" href={href} aria-label={`${SEAT_NAME[seat]} ${label}`}><span className="hm4-label">{label}{warn && <small className="hm4-pill hm4-pill-warn">Below 3</small>}</span>{children}</a><Retry r={r} retry={retry} />
  </div>
}
function Week({ seat, h }: { seat: Seat; h: HomeData }) {
  const r = h.content[seat], below = 'v' in r && r.v.below
  return <Band id="week" label="Next week" seat={seat} href={dHash('content', null, { lane:seat })} r={r} retry={h.retry.content} warn={below}>
    <Figure r={mapRead(r,w => w.n)} size="xl" unit="posts" />
    <span className="hm4-strip" aria-label={'v' in r ? r.v.days.map(d => `${d.dow}: ${d.posts} posts${d.stub ? `, ${d.stub}` : ''}`).join('; ') : 'Reading next week'}>
      {'v' in r ? r.v.days.map(d => <span key={d.key} title={`${d.dow} ${d.n}: ${d.posts} ${d.posts === 1 ? 'post' : 'posts'}${d.stub ? ` · ${d.stub}` : ''}`} tabIndex={-1}><i className={d.posts ? 'hm4-filled' : ''}>{d.posts > 1 ? d.posts : ''}</i><small>{d.dow[0]}</small></span>) : Array.from({length:5},(_,i) => <span key={i}><i className="ols-skeleton" /><small>&nbsp;</small></span>)}
    </span>
  </Band>
}
function Drafts({ seat, h }: { seat: Seat; h: HomeData }) {
  const r = h.drafts[seat]
  return <Band id="drafts" label="DM drafts" seat={seat} href={dHash('dms',null,{seat})} r={r} retry={h.retry.drafts}>
    <span className={'v' in r && r.v > 0 ? 'hm4-action' : ''}><Figure r={r} size="xl" unit={'v' in r && r.v === 0 ? 'none waiting' : undefined} /></span>
  </Band>
}
function Invites({ seat, h }: { seat: Seat; h: HomeData }) {
  const r = invites(h,seat), bars = seriesOf(h.lanes.cc.value,seat,h.now,'invitation','sent',7)
  const max = Math.max(1,...bars.map(b => b.v ?? 0))
  return <Band id="invites" label="Invites today" seat={seat} href={dHash('lanes',null,{seat})} r={r} retry={h.retry.lanes}>
    <span className="hm4-inv-row"><Figure r={mapRead(r,x => x.inv)} size="xl" unit={'v' in r && r.v.cap != null ? `/${r.v.cap}` : undefined} />
      <span className="hm4-micro">{bars.map(b => <span key={b.day} title={`${b.day}: ${b.v ?? 'no reading'}`} aria-label={`${b.day}: ${b.v ?? 'no reading'}`}><i data-today={b.today} style={{height:`${b.v == null ? 2 : Math.max(2,b.v / max * 24)}px`}} /></span>)}</span>
    </span>
  </Band>
}
function Ready({ seat, h }: { seat: Seat; h: HomeData }) {
  const r = slotRead(h.lanes.ready, v => readyOf(v,seat,h.lanes.gov.value?.find(g => g.client_id === seat)))
  const lanes = 'v' in r ? r.v.lanes.filter(l => l.n > 0) : []
  const max = Math.max(1,...lanes.map(l => l.n))
  return <div className="hm4-ready-band"><Band id="ready" label="Ready" seat={seat} href={dHash('lanes',null,{seat})} r={r} retry={h.retry.lanes}>
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
  </a><Retry r={r} retry={h.retry.lanes} /></div>
}
export function SeatCard({ seat, h }: { seat: Seat; h: HomeData }) {
  return <section className="hm4-card" data-seat={seat} aria-label={SEAT_NAME[seat]} data-bx-block>
    <header><span className="hm4-avatar">{SEAT_NAME[seat][0]}</span><h2>{SEAT_NAME[seat]}</h2><Limit seat={seat} h={h} /></header>
    <div className="hm4-card-bands"><Week seat={seat} h={h} /><Drafts seat={seat} h={h} /><Invites seat={seat} h={h} /><Ready seat={seat} h={h} /></div>
  </section>
}
function Matrix({ h }: { h: HomeData }) {
  const [open, setOpen] = useState(() => {try{return localStorage.getItem('hm4-ready-open')==='1'}catch{return false}})
  function toggle(){setOpen(v=>{try{localStorage.setItem('hm4-ready-open',v?'0':'1')}catch{/* tab only */}return !v})}
  return <section className="hm4-matrix" aria-label="Seats at a glance" data-bx-block>
    <div className="hm4-matrix-row hm4-matrix-head"><span />{SEATS.map(s=><b key={s}>{SEAT_NAME[s]}</b>)}</div>
    <div className="hm4-matrix-row"><b>Next week</b>{SEATS.map(s=><div key={s}><Week seat={s} h={h}/></div>)}</div>
    <div className="hm4-matrix-row"><b>DM drafts</b>{SEATS.map(s=><div key={s}><Drafts seat={s} h={h}/></div>)}</div>
    <div className="hm4-matrix-row"><b>Invites</b>{SEATS.map(s=><div key={s}><Invites seat={s} h={h}/></div>)}</div>
    <div className={`hm4-matrix-row hm4-matrix-ready${open?' hm4-expanded':''}`}><button type="button" aria-expanded={open} onClick={toggle}>Ready {open?'⌄':'›'}</button>{SEATS.map(s=><div key={s}><Ready seat={s} h={h}/></div>)}</div>
    <div className="hm4-matrix-row"><b>Rate limit</b>{SEATS.map(s=><div key={s}><Limit seat={s} h={h}/></div>)}</div>
  </section>
}
export default function HomeV4({ layout }: PlaceProps) {
  const motion = useMotionLevel()
  const h = useHome(), online = useOnline()
  return <div data-motion={motion} className={`hm4 hm4-${layout}`} data-d-scroll={layout==='desktop'?'':undefined} data-layout-v4="home">
    {layout==='desktop' && <AnswerRow title="Home" />}{!online && <Offline since={null} />}
    {layout==='phone' ? <><Matrix h={h}/><HomeTasks v4 /></> : <div className="hm4-grid"><div className="hm4-seats">{SEATS.map(s=><SeatCard key={s} seat={s} h={h}/>)}</div><HomeTasks v4 /></div>}
  </div>
}
