/* Invites sent, by lane, for the chosen seat: today (Warsaw day) or the last 7
   days. Each lane is one bar; on Arch the bar splits by the vertical the sender
   chose for the copy (games, apps, D2C, PC). A lane name explains itself on
   hover, and on tap for the phone (laneInfo.ts). Read-only (sendsByLane.ts). */
import { useState } from 'react'
import type { Seat } from '../seats'
import { fetchSeatSends, mixOf, vertLabel, type Mix } from './sendsByLane'
import { useRetryRead } from './useRead'

function Lanes({ m }: { m: Mix }) {
  const max = Math.max(1, ...m.lanes.map(l => l.n))
  const [open, setOpen] = useState<string | null>(null)
  return (
    <div className="dl-bl-lanes">
      {m.lanes.map(l => (
        <div key={l.key} className="dl-bl-lane" data-lane={l.key}>
          <div className="dl-bl-row">
            {l.info
              ? <button type="button" className="dl-bl-l dl-bl-lq" title={l.info} aria-expanded={open === l.key} onClick={() => setOpen(o => (o === l.key ? null : l.key))}>{l.label}</button>
              : <span className="dl-bl-l">{l.label}</span>}
            <span className="dl-bl-bar" style={{ width: `${Math.max(3, (l.n / max) * 100)}%` }}>
              {m.byVertical
                ? l.verts.map(v => <i key={v.key} className={`dl-v-${v.key}`} style={{ flexGrow: v.n }} title={`${vertLabel(v.key)} ${v.n}`} />)
                : <i className="dl-v-all" style={{ flexGrow: 1 }} />}
            </span>
            <b>{l.n}</b>
          </div>
          {open === l.key && l.info && <p className="dl-bl-why">{l.info}</p>}
          {m.byVertical && <div className="dl-bl-v">{l.verts.map(v => <span key={v.key}><i className={`dl-v-${v.key}`} />{vertLabel(v.key)} <b>{v.n}</b></span>)}</div>}
        </div>
      ))}
    </div>
  )
}

export function SendMix({ seat, now }: { seat: Seat; now: number }) {
  const [win, setWin] = useState<'today' | '7d'>('today')
  const [load, retry] = useRetryRead(() => fetchSeatSends(seat), `sendmix:${seat}`)
  const m = load.kind === 'ready' ? mixOf(load.data, seat, win, now) : null
  return (
    <div className="dl-panel dl-bl" data-band="sendmix" data-seat={seat}>
      <div className="dl-panh">
        <b>Invites sent, by lane</b>
        <span>{m ? `${m.total} ${win === 'today' ? 'today' : 'in 7 days'}` : ''}</span>
        <span className="dl-bl-keys" role="group" aria-label="Window">
          {(['today', '7d'] as const).map(w => <button key={w} type="button" className={`dl-rkey${w === win ? ' dl-on' : ''}`} aria-pressed={w === win} onClick={() => setWin(w)}>{w === 'today' ? 'Today' : '7 days'}</button>)}
        </span>
      </div>
      {load.kind === 'loading' && <p className="dl-sl dl-unk">Reading today's sends…</p>}
      {load.kind === 'failed' && <p className="dl-sl dl-bad">Could not be read: {load.message} <button type="button" className="dl-more" onClick={retry}>Retry</button></p>}
      {m && (m.total ? <Lanes m={m} /> : <p className="dl-sl">{win === 'today' ? 'No invite has gone out today yet.' : 'No invite went out in the last 7 days.'}</p>)}
    </div>
  )
}
