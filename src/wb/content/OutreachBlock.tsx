/* ==========================================================================
   Outreach performance. Reads the matured DM send/reply cells for the open
   lane, puts what is off the pace first, and keeps every raw cell one
   disclosure away. `OutreachView` is pure so the whole surface is testable
   without a fetch.
   ========================================================================== */
import { useCallback, useEffect, useState } from 'react'
import { Failed, CalmEmpty } from './parts'
import { alarmLine, alarmTitle, loadPerf, pct, rankAlarms, stepLabel, type PerfLane, type PerfPayload, type PerfState } from '../../lib/outreachPerf'
import { LANE_LABEL, type ContentLane } from '../../lib/content'
import './content.css'
import './outreach-perf.css'

function Alarms({ p }: { p: PerfPayload }) {
  const ranked = rankAlarms(p.lanes)
  if (!ranked.length) return <div className="a-op-card"><div className="a-op-h">Nothing off</div><div className="a-ct-sub">No lane or variant is below its comparator at the {p.floor}-send floor. Cells under the floor are listed below as too few to call.</div></div>
  return <>{ranked.map(({ lane, alarm }, i) => (
    <div className="a-op-card a-op-alarm" key={`${lane}-${alarm.kind}-${alarm.step}-${alarm.variant ?? ''}-${i}`}>
      <div className="a-op-h">{alarmTitle(lane, alarm)}</div>
      <div className="a-op-line">{alarmLine(alarm)}</div>
      {alarm.kind === 'drift' && (alarm.suspect_dim
        ? <>
            <div className="a-ct-sub">Suspect: {alarm.suspect_dim}</div>
            <ul className="a-op-split">{alarm.split.map(s => <li key={s.value}><span>{s.value}</span><span>{s.replies} of {s.n} ({pct(s.rate)})</span></li>)}</ul>
          </>
        : <div className="a-ct-sub">Spread evenly across sources and variants at this volume.</div>)}
      {alarm.kind === 'sibling' && <div className="a-ct-sub">This variant sits below its siblings in the same lane and step. Copy stays as it is until you change it.</div>}
    </div>
  ))}</>
}

export function Cells({ l }: { l: PerfLane }) {
  return <div className="a-op-tiles">{l.cells.map(c => (
    <div className={`a-op-tile is-${c.status}`} key={c.step}>
      <div className="a-ct-sub">{l.lane} · {stepLabel(c.step)}</div>
      <div className="a-op-rate">{pct(c.rate)}</div>
      <div className="a-ct-sub">{c.replies} of {c.n} · prior {c.base_n ? pct(c.base_rate) : 'none'}</div>
      {c.status === 'thin' && <div className="a-ct-sub">too few to call</div>}
      <div className="a-ct-sub">{c.positive_rate === null ? 'positive: no reply classification on this seat' : `positive ${pct(c.positive_rate)}`}</div>
      {c.viewed_rate !== null && <div className="a-ct-sub">viewed back {pct(c.viewed_rate)} ({c.viewed_n})</div>}
    </div>
  ))}</div>
}

export function Variants({ l }: { l: PerfLane }) {
  if (!l.variants.length) return null
  return <ul className="a-op-split">{l.variants.map(v => (
    <li key={`${v.step}-${v.variant}`}><span>{stepLabel(v.step)} · {v.variant}{v.status === 'sibling' ? ' · below siblings' : v.status === 'thin' ? ' · too few to call' : ''}</span><span>{v.replies} of {v.n} ({pct(v.rate)}){v.viewed_n > 0 && v.viewed_rate !== null ? ` · viewed back ${pct(v.viewed_rate)}` : ''}</span></li>
  ))}</ul>
}

function RawTable({ p }: { p: PerfPayload }) {
  const rows = p.lanes.flatMap(l => l.table.map(r => ({ lane: l.lane, ...r })))
  return <div className="a-op-scroll"><table className="a-op-table">
    <thead><tr><th>Lane</th><th>Step</th><th>Variant</th><th>Source</th><th>Country</th><th>Vertical</th><th>Sent</th><th>Replies</th><th>Rate</th></tr></thead>
    <tbody>{rows.map((r, i) => <tr key={i}><td>{r.lane}</td><td>{stepLabel(r.step)}</td><td>{r.variant}</td><td>{r.source}</td><td>{r.country}</td><td>{r.vertical}</td><td>{r.n}</td><td>{r.replies}</td><td>{pct(r.rate)}</td></tr>)}</tbody>
  </table></div>
}

export function OutreachView({ lane, state, onRetry }: { lane: ContentLane; state: PerfState; onRetry?: () => void }) {
  if (state.kind === 'failed') return <Failed what={`${LANE_LABEL[lane]} outreach performance`} message={state.message} onRetry={onRetry ?? (() => {})} loadedAt={null} />
  if (state.kind === 'loading') return <div className="a-ct-sub a-strat-hold">Loading…</div>
  if (state.kind === 'empty') return <CalmEmpty line={state.reason} loadedAt={null} />
  const p = state.data
  return <>
    <div className="a-ct-sub">DM sends only, active lanes only. A send counts 7 days after it went out. Current window is the last 14 matured days against the 60 days before. Floor {p.floor} sends per cell. Reply basis: {p.reply_basis.threaded} threaded, {p.reply_basis.stamp_only} by thread stamp. Positive counts threaded replies that took a step forward: a yes, a booking, a price or a real question about the offer. Viewed back counts recipients who looked at the profile within 14 days of the message; LinkedIn shows only some viewers, so read it as a floor and compare within one seat.</div>
    <Alarms p={p} />
    <div className="a-bm-h">Lane and step</div>
    {p.lanes.map(l => <div key={l.lane}><Cells l={l} /><Variants l={l} /></div>)}
    <details className="a-strategy-disclosure"><summary>All cells ({p.lanes.reduce((n, l) => n + l.table.length, 0)})</summary><RawTable p={p} /></details>
  </>
}

export function OutreachBlock({ lane }: { lane: ContentLane }) {
  const [state, setState] = useState<PerfState>({ kind: 'loading' })
  // loadPerf already turns a rejection into a failed state; the second .then argument is the
  // belt for the brace, so no path can leave this block stuck on "Loading".
  const load = useCallback(() => {
    setState({ kind: 'loading' })
    void loadPerf(lane).then(setState, e => setState({ kind: 'failed', message: String((e && e.message) || e) }))
  }, [lane])
  useEffect(() => { load() }, [load])
  return <OutreachView lane={lane} state={state} onRetry={load} />
}
