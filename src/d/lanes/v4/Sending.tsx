import { useState } from 'react'
import type { Seat } from '../../seats'
import { Skeleton } from '../../ui/states'
import { fetchSeatSends, mixOf, vertLabel } from '../sendsByLane'
import { useRetryRead } from '../useRead'

export function Sending({ seat, now }: { seat: Seat; now: number }) {
  const [load, retry] = useRetryRead(() => fetchSeatSends(seat), `sendmix:${seat}`)
  const [explain, setExplain] = useState<string | null>(null)
  const today = load.kind === 'ready' ? mixOf(load.data, seat, 'today', now) : null
  const week = load.kind === 'ready' ? mixOf(load.data, seat, '7d', now) : null
  const max = Math.max(1, ...(today?.lanes.map(l => l.n) ?? []))
  return <section className="dl4-panel dl4-sending" data-band="sendmix" data-seat={seat} data-bx-block>
    <h2>Sending today</h2>
    {load.kind === 'loading' && <Skeleton lines={3} label="Reading today's sends" />}
    {load.kind === 'failed' && <p>Could not be read: {load.message} <button type="button" data-verb="retry" onClick={retry}>Retry</button></p>}
    {today && (!today.total ? <p>No invite has gone out today yet.</p> : today.lanes.map(l => <div className="dl4-sent-lane" key={l.key} data-lane={l.key}>
      <button type="button" title={l.info ?? l.label} aria-expanded={explain === l.key} onClick={() => setExplain(explain === l.key ? null : l.key)}>{l.label}</button>
      <div className="dl4-sent-bar"><span className="dl4-bar" style={{ width: `${l.n / max * 100}%` }}>
        {today.byVertical ? l.verts.map(v => <i key={v.key} className={`dl4-v-${v.key}`} style={{ flexGrow: v.n }} />) : <i style={{ flexGrow: 1 }} />}
      </span><b>{l.n} <small>· {week?.lanes.find(x => x.key === l.key)?.n ?? 0} 7d</small></b></div>
      {today.byVertical && <div className="dl4-verts">{l.verts.map(v => <span key={v.key}><i className={`dl4-v-${v.key}`} />{vertLabel(v.key)} {v.n}</span>)}</div>}
      {explain === l.key && l.info && <p className="dl4-explain">{l.info}</p>}
    </div>))}
    {today && <p className="dl4-supply-foot">{today.total} today · {week?.total} in 7 days</p>}
  </section>
}
