/* Lead supply of the chosen seat (Ivan 09-28: "I'm more interested in seeing
   how the refill capabilities are"): who is ready per lane as bars, then the
   last 14 days of people newly qualified (in) against people invited (out),
   and one sentence on where the pool is heading. Read-only. */
import type { Seat } from '../seats'
import { dm } from './model'
import type { Supply } from './supply'
import type { LanesData } from './useLanesData'
import type { ReadyLane } from './glance/ready'

function LaneRows({ lanes }: { lanes: ReadyLane[] }) {
  const on = lanes.filter(l => !l.off)
  const max = Math.max(1, ...on.map(l => l.n))
  return (
    <div className="dl-rf-lanes">
      {lanes.map(l => (
        <div key={l.lane} className={`dl-rf-lane${l.off ? ' dl-off' : ''}${l.candidate ? ' dl-candidate' : ''}`} title={l.off ? `${l.label}: ${l.off}` : `${l.label}: ${l.capped ? 'at least ' : ''}${l.n} ${l.candidate ? 'candidates; ready count unverified' : 'ready'}`}>
          <span className="dl-rf-ll">{l.label}</span>
          <span className="dl-rf-bar"><i style={{ width: `${l.off ? 0 : Math.max(l.n ? 2 : 0, (l.n / max) * 100)}%` }} /></span>
          <b>{l.off ? ['retry', 'reconnect'].includes(l.lane) ? 'Excluded' : l.off : `${l.capped ? '≥' : ''}${l.n.toLocaleString('en-US')}`}</b>
        </div>
      ))}
    </div>
  )
}

function Lanes({ s }: { s: Supply }) {
  const ready = s.lanes.filter(l => !l.candidate && !l.off)
  const candidates = s.lanes.filter(l => l.candidate)
  const excluded = s.lanes.filter(l => !l.candidate && l.off)
  return <>
    {candidates.length > 0 && <p className="dl-rf-group">Verified ready stock</p>}
    <LaneRows lanes={ready} />
    {candidates.length > 0 && <div role="group" aria-label="Other candidate pools" className="dl-rf-candidates">
      <p className="dl-rf-group">Other candidate pools</p>
      <LaneRows lanes={candidates} />
      <p className="dl-rf-note">Ready counts for these lanes are unverified, so they are excluded from the ready total.</p>
    </div>}
    {excluded.length > 0 && <div className="dl-rf-excluded">
      <LaneRows lanes={excluded} />
      {excluded.some(l => ['retry', 'reconnect'].includes(l.lane)) && <p className="dl-rf-note">Previously contacted leads are excluded from fresh stock.</p>}
    </div>}
  </>
}

function InOut({ s, now }: { s: Supply; now: number }) {
  const days = s.days ?? []
  const max = Math.max(1, ...days.flatMap(d => [d.inn, d.out]))
  const today = new Date(now).toISOString().slice(0, 10)
  return (
    <div className="dl-rf-io" role="img" aria-label={`Last 14 days: ${days.reduce((a, d) => a + d.inn, 0)} people qualified in, ${days.reduce((a, d) => a + d.out, 0)} invited out`}>
      <div className="dl-rf-cols">
        {days.map(d => (
          <div key={d.day} className={`dl-rf-col${d.day === today ? ' dl-rf-now' : ''}`} title={`${dm(d.day + 'T12:00:00Z')}: ${d.inn} in, ${d.out} out`}>
            <span className="dl-rf-pair">
              <i className="dl-in" style={{ height: `${d.inn ? Math.max(3, (d.inn / max) * 100) : 0}%` }} />
              <i className="dl-out" style={{ height: `${d.out ? Math.max(3, (d.out / max) * 100) : 0}%` }} />
            </span>
            <small>{new Date(d.day + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'narrow', timeZone: 'UTC' })}</small>
          </div>
        ))}
      </div>
      <div className="dl-rf-key"><span><i className="dl-in" />newly qualified</span><span><i className="dl-out" />invited</span><span className="dl-dimt">14 days</span></div>
    </div>
  )
}

export function verdict(s: Supply): { text: string; bad: boolean } | null {
  if (s.ready == null) return null
  if (s.ready === 0) return { text: 'Nobody is ready to invite: the seat has nothing to send.', bad: true }
  if (s.refill == null) return { text: 'Nothing was invited in the last 7 days, so the pool is not moving.', bad: false }
  if (s.emptyIn != null) return { text: `More go out than come in: at this pace the ready pool is empty in about ${s.emptyIn} days.`, bad: s.emptyIn < 7 }
  const hold = s.runwayDays != null ? `; today it holds about ${s.runwayDays} day${s.runwayDays === 1 ? '' : 's'} of invites` : ''
  return { text: `More come in than go out (${s.in7} in, ${s.out7} out in 7 days), so the ready pool grows${hold}.`, bad: false }
}

export function Refill({ seat, d, s, now }: { seat: Seat; d: LanesData; s: Supply; now: number }) {
  const v = verdict(s)
  return (
    <div className="dl-panel dl-rf" data-band="refill" data-seat={seat}>
      <div className="dl-panh"><b>Lead supply</b><span>{seat === 'risedtc' ? 'ready stock and candidates' : 'ready now, by lane'}</span></div>
      {!d.ready.value
        ? <p className={`dl-sl ${d.ready.failed ? 'dl-bad' : 'dl-unk'}`}>{d.ready.failed ? `Who is ready could not be read: ${d.ready.failed}` : 'Reading who is ready…'}</p>
        : s.lanes.length ? <Lanes s={s} /> : <p className="dl-sl">No lane has anyone ready.</p>}
      {v && <p className={`dl-rf-v${v.bad ? ' dl-bad' : ''}`}>{v.text}</p>}
      {s.days ? <InOut s={s} now={now} /> : <p className={`dl-sl ${d.replacement.failed ? 'dl-bad' : 'dl-unk'}`}>{d.replacement.failed ? 'The refill could not be read.' : 'Reading the refill…'}</p>}
      <p className="dl-rf-f">New people found this week: <b>{d.engagers.value ? (d.engagers.value[seat] ?? 0).toLocaleString('en-US') : '?'}</b></p>
    </div>
  )
}
