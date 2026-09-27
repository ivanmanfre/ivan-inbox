/* Daily ledger and Custom range, as today's Overview draws them (DayLedger,
   RangeSummary), in D. Read-only.
   Ledger: Invites = CONFIRMED invitations by Warsaw day from the monitor's
   payload (the legacy ledger counts message rows, refused attempts included;
   it is only used, and captioned, when the payload lacks that day). Accepted %
   of that day's invites, "−N burned" (cap spent on refused sends), a total row,
   7 days (14 when the range is 30d or 90d).
   Custom range: from / to (URL `from=&to=`), `inbox_range_kpis` per seat, exact,
   no era cutoff. */
import { useState } from 'react'
import type { CcPayload } from '../../lib/campaignControl'
import { buildLedger, fetchDayLedger, fetchRangeKpis, type RangeKpiRow } from '../../lib/kpis'
import { SEATS, SEAT_NAME, type Seat } from '../seats'
import { Btn } from '../ui/Key'
import { Sheet } from '../ui/Sheet'
import { LoadLine, Shs } from './CampaignSheet'
import { dm, type Range } from './model'
import { useRead } from './useRead'

const dayWord = (day: string, today: string) => day === today ? 'Today'
  : new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${day}T12:00:00Z`))

export function confirmedInvites(p: CcPayload | null, seat: Seat, day: string): number | null {
  if (!p) return null
  const r = p.ranges.daily.find(d => d.client_id === seat && d.channel === 'invitation' && d.day === day)
  return r ? r.sent : null
}

export function LedgerSheet({ p, range, onClose }: { p: CcPayload | null; range: Range; onClose: () => void }) {
  const rows = useRead(fetchDayLedger, 'ledger')
  const days = range === '7d' ? 7 : 14
  const today = new Date().toISOString().slice(0, 10)
  const pct = (a: number, i: number) => (i > 0 ? ` ${Math.round((a / i) * 100)}%` : '')
  return (
    <Sheet open onClose={onClose} className="dl-sheet" title="Daily ledger"
      sub={`Last ${days} days per seat · invites by Warsaw day, the rest by UTC day.`}>
      <LoadLine l={rows} what="the daily ledger">{data => data.length === 0 ? <p className="dl-sl">The daily ledger has no rows.</p> : <>{SEATS.map(s => {
        const led = buildLedger(data, s, days, today)
        let legacy = 0
        const inv = (day: string, fallback: number) => { const v = confirmedInvites(p, s, day); if (v == null) { legacy++; return fallback } return v }
        const view = led.map(d => ({ ...d, inv: inv(d.day, d.invites) }))
        const tot = view.reduce((a, d) => ({ inv: a.inv + d.inv, acc: a.acc + d.accepted, dms: a.dms + d.dms, im: a.im + d.inmails, burned: a.burned + d.burned }), { inv: 0, acc: 0, dms: 0, im: 0, burned: 0 })
        return (
          <div key={s}>
            <Shs>{SEAT_NAME[s]}</Shs>
            <table className="dl-steps"><thead><tr><th>Day</th><th>Invites</th><th>Accepted</th><th>DMs</th><th>InMail</th><th>Cap</th></tr></thead><tbody>
              {view.map(r => (
                <tr key={r.day}><td>{dayWord(r.day, today)}</td><td className="dl-m">{r.inv}</td><td className="dl-m">{r.accepted}<span className="dl-dimt">{pct(r.accepted, r.inv)}</span></td>
                  <td className="dl-m">{r.dms}</td><td className="dl-m">{r.inmails}</td>
                  <td className="dl-m">{r.cap_used == null ? '—' : `${r.cap_used}/${r.cap_limit ?? '?'}`}{r.burned > 0 && <span className="dl-al"> −{r.burned} burned</span>}</td></tr>
              ))}
              <tr className="dl-tot"><td>{days}d</td><td className="dl-m">{tot.inv}</td><td className="dl-m">{tot.acc}<span className="dl-dimt">{pct(tot.acc, tot.inv)}</span></td><td className="dl-m">{tot.dms}</td><td className="dl-m">{tot.im}</td>
                <td className="dl-m">{tot.burned > 0 ? <span className="dl-al">−{tot.burned} burned</span> : '—'}</td></tr>
            </tbody></table>
            {legacy > 0 && <p className="dl-sl">{legacy} of these days are not in the monitor&apos;s payload: their Invites are message rows, refused attempts included, unverified.</p>}
          </div>
        )
      })}
      <p className="dl-sl">Invites = confirmed invitations. Cap = the seat&apos;s counter, spent before LinkedIn answers; when it runs ahead of Invites those slots went to refused sends (burned). Accepted is of that day&apos;s invites and only rises.</p></>}</LoadLine>
    </Sheet>
  )
}

const iso = (t: number) => new Date(t).toISOString().slice(0, 10)

export function RangeSheet({ from, to, setRange, onClose }: { from: string | null; to: string | null; setRange: (from: string, to: string) => void; onClose: () => void }) {
  const [f, setF] = useState(from ?? iso(Date.now() - 13 * 864e5))
  const [t, setT] = useState(to ?? iso(Date.now()))
  const ok = Boolean(from && to && from <= to)
  const rows = useRead<RangeKpiRow[]>(ok ? () => fetchRangeKpis(from!, to!) : null, `rk:${from}:${to}`)
  return (
    <Sheet open onClose={onClose} className="dl-sheet" title="Custom range"
      sub="Any two days. Counted from the raw tables for exactly those days, no era cutoff; accepts are counted on the invites sent inside the range.">
      <form className="dl-rng" onSubmit={e => { e.preventDefault(); if (f && t && f <= t) setRange(f, t) }}>
        <label>From <input type="date" value={f} max={t || undefined} onChange={e => setF(e.target.value)} /></label>
        <label>To <input type="date" value={t} min={f || undefined} max={iso(Date.now())} onChange={e => setT(e.target.value)} /></label>
        <Btn type="submit" verb="range-apply" disabled={!f || !t || f > t}>Show</Btn>
      </form>
      {!ok ? <p className="dl-sl">Pick two days and press Show.</p> : <LoadLine l={rows} what="the range">{rs => <>
        <Shs>{dm(`${from}T12:00:00Z`)} to {dm(`${to}T12:00:00Z`)}</Shs>
        <table className="dl-steps"><thead><tr><th>Seat</th><th>Invites</th><th>Accepted</th><th>Conversations</th><th>Calls</th></tr></thead><tbody>
          {SEATS.map(s => {
            const r = rs.find(x => (x.client_id ?? 'ivan') === s || (s === 'ivan' && !x.client_id))
            return <tr key={s}><td>{SEAT_NAME[s]}</td>{r ? <>
              <td className="dl-m">{r.sent}</td><td className="dl-m">{r.accepted}<span className="dl-dimt">{r.sent ? ` ${Math.round((r.accepted / r.sent) * 100)}%` : ''}</span></td>
              <td className="dl-m">{r.convos}</td><td className="dl-m">{r.calls}</td></> : <td className="dl-m dl-dimt" colSpan={4}>no row for this seat</td>}</tr>
          })}
        </tbody></table>
        <p className="dl-sl">Seats are never added together.</p>
      </>}</LoadLine>}
    </Sheet>
  )
}
