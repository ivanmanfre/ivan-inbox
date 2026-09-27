/* The Control detail of one seat (`?sheet=control&for=<seat>`), opened from the
   Control band's "Detail ›". Everything today's Control panel prints for a seat
   (wb/sends/Control.tsx ControlSummary + ControlPanel) that the band has no
   room for: channel caps from the payload, the session in full, why it cannot
   send now, the pause keys (seat + the global kill switch), supply and the
   per-source-lane table, the governor, every incident (closed ones too), and
   the Evidence / Private detail folds. Read-only. */
import { STATUS_WORD, monitorLiveness, type CcChannel, type CcPayload } from '../../lib/campaignControl'
import type { GovernorRow } from '../../lib/kpis'
import { dHash } from '../route'
import { SEAT_NAME, type Seat } from '../seats'
import { Sheet } from '../ui/Sheet'
import { Shs } from './CampaignSheet'
import { EvidenceFolds, GovernorDetail, IncidentDetail } from './controlParts'
import { ago, clientOf, controlOf, dm, hm, reasonWord, seatEligible, until } from './model'
import { KILL_SWITCH_KEY, PAUSE_KEY, type Pauses } from './reads'

const PACE: Record<string, string> = { no_target: 'no target set for this seat', on_track: 'on track against the target', behind: 'behind the target', not_yet: 'too early in the session to judge' }
const at = (t: string | null | undefined, now: number) => (!t ? 'not set' : `${dm(t) === dm(now) ? 'today' : dm(t)} ${hm(t)}`)

function Channel({ ch, title }: { ch: CcChannel | null | undefined; title: string }) {
  const c = ch?.capacity
  return (
    <div>
      <small>{title}</small>
      <em className={ch?.confirmed_sent ? '' : 'dl-z'}>{ch ? ch.confirmed_sent : '?'}</em>
      <span className="dl-cap">{!ch ? 'no reading' : c?.daily_cap ? `cap ${c.daily_used ?? '?'}/${c.daily_cap} today` : 'no daily cap in the payload'}
        {c?.weekly_cap ? ` · ${c.weekly_used ?? '?'}/${c.weekly_cap} week` : ''}</span>
    </div>
  )
}

export function ControlSheet({ seat, p, pFailed = null, gov, pauses, pausesFailed, now, onClose }: {
  seat: Seat; p: CcPayload | null; pFailed?: string | null; gov: GovernorRow | null; pauses: Pauses | null; pausesFailed: string | null; now: number; onClose: () => void
}) {
  const c = clientOf(p, seat)
  const v = c ? controlOf(c, now) : null
  const inv = c?.invitation
  const s = inv?.session
  const stale = p && monitorLiveness(p, now) === 'stale' && p.monitor.last_tick_at ? Math.max(1, Math.round((now - Date.parse(p.monitor.last_tick_at)) / 6e4)) : null
  const fr = c?.freshness
  const incidents = c?.incidents ?? []
  const pause = (key: string, v2: string | undefined) => {
    const live = v2 && Date.parse(v2) > now
    return <div className="dl-kv" key={key}><span className="dl-k">{key === KILL_SWITCH_KEY ? 'Manual stop, all seats' : 'Seat pause'}</span>{' '}
      {v2 ? <><b className={live ? 'dl-al' : ''}>{live ? `until ${at(v2, now)}` : `ended ${at(v2, now)}`}</b>{live ? ` (${until(v2, now)})` : ''}</> : 'not set'} <span className="dl-dimt">{key}</span></div>
  }
  return (
    <Sheet open onClose={onClose} className="dl-sheet" title={`${SEAT_NAME[seat]}, control detail`}
      sub={c ? `${STATUS_WORD[stale ? 'unknown' : c.status]} · data ${fr?.data_age_s != null ? `${Math.round(fr.data_age_s / 60)} min old` : 'age unknown'} · rules ${fr?.rule_version ?? 'unknown'} · ${p?.source_mode ?? 'snapshot'}` : 'This seat has no control reading in the snapshot.'}>
      {!p ? <p className={`dl-sl ${pFailed ? 'dl-bad' : 'dl-unk'}`}>{pFailed ? `The send monitor could not be read: ${pFailed}` : 'Reading the send monitor…'}</p> : !c || !v || !inv ? <p className="dl-sl">No control reading for this seat.</p> : <>
        {stale != null && <p className="dl-sl dl-bad">The monitor has not reported in for {stale} minutes; these figures may be out of date. Payload said: {STATUS_WORD[c.status].toLowerCase()}, {c.status_reason}</p>}
        {stale == null && <p className="dl-sl">{c.status_reason}</p>}
        <div className="dl-kv"><span className="dl-k">Next</span> {c.next_action?.action ?? 'nothing recorded'}{c.next_action?.owner ? ` · owner ${c.next_action.owner}` : ''} · {v.closed ? 'opens' : 'next check'} {at(v.closed ? s?.next_opening_at : c.next_check_at, now)}</div>
        <Shs>Today, never added together</Shs>
        <div className="dl-wk4 dl-wk3"><Channel ch={inv} title="Invites" /><Channel ch={c.dm} title="DMs" /><Channel ch={c.inmail} title="InMail" /></div>
        <Shs>Sending session</Shs>
        <div className="dl-kv">{v.window}{s?.weekday_rule ? ` · ${s.weekday_rule}` : ''}</div>
        {v.closed ? <div className="dl-kv">Not sending now · opens {v.opens ?? 'not scheduled'}</div> : <>
          <div className="dl-kv">{s?.elapsed_eligible_opportunities ?? '?'} of {s?.expected_opportunities_total ?? '?'} sending opportunities elapsed{v.pct != null ? ` · ${v.pct}%` : ''}</div>
          {v.pct != null && <div className="dl-bar"><i style={{ width: `${v.pct}%` }} /></div>}
          <div className="dl-kv">Pace: {PACE[inv.pace] ?? inv.pace} · {inv.planned_by_now != null ? `${inv.confirmed_sent} sent against ${inv.planned_by_now} planned by now` : (inv.planned_by_now_reason ?? 'no target configured').replace(/_/g, ' ')}</div>
        </>}
        {v.blockers.length > 0 && <p className="dl-sl dl-bad">Cannot send right now: {v.blockers.join('; ')}.</p>}
        <Shs>Pauses</Shs>
        {pausesFailed && !pauses ? <p className="dl-sl dl-bad">The pause keys could not be read: {pausesFailed}</p>
          : <>{pause(PAUSE_KEY[seat], pauses?.[seat])}{pause(KILL_SWITCH_KEY, pauses?.all)}</>}
        <Shs tail={inv.eligible_stock_scope ? `scope ${inv.eligible_stock_scope}` : undefined}>Eligible supply</Shs>
        <div className="dl-kv"><b>{seatEligible(inv) ?? 'unknown'}</b> eligible{v.pools.length ? ` · ${v.pools.map(([k, x]) => `${k} ${x}`).join(', ')}` : ''}</div>
        {typeof (inv.eligible_stock_by_pool as Record<string, unknown> | null)?.note === 'string' && <p className="dl-sl">{String((inv.eligible_stock_by_pool as Record<string, unknown>).note)}</p>}
        {(inv.by_lane ?? []).length > 0 && (
          <table className="dl-steps"><thead><tr><th>Source lane</th><th>Today</th><th>Eligible</th><th>Can send now</th></tr></thead><tbody>
            {(inv.by_lane ?? []).map(l => (
              <tr key={l.source_lane}><td>{l.source_lane.replace(/_/g, ' ')}</td><td className="dl-m">{l.confirmed_sent}</td><td className="dl-m">{l.eligible_stock ?? '?'}</td>
                <td className={l.executable_now ? 'dl-m' : 'dl-al'}>{l.executable_now ? 'yes' : `no: ${(l.executable_reasons ?? []).map(reasonWord).join('; ') || 'no reason given'}`}</td></tr>
            ))}
          </tbody></table>
        )}
        <a className="dl-more" href={dHash('content', 'strategy')}>What we filter on ›</a>
        <Shs>Governor</Shs>
        {gov ? <GovernorDetail g={gov} /> : <p className="dl-sl dl-unk">No governor reading for this seat.</p>}
        <Shs tail={incidents.length}>Incidents, open and closed</Shs>
        {incidents.length === 0 ? <p className="dl-sl">No incident on this seat.</p> : incidents.map(i => <IncidentDetail key={i.incident_key} inc={i} now={now} />)}
        <EvidenceFolds p={p} ids={[...(c.status_basis?.evidence_ids ?? []), ...(inv.evidence_ids ?? []), ...incidents.flatMap(i => i.evidence_ids ?? [])]} />
        <p className="dl-sl dl-dimt">Monitor tick {ago(p.monitor.last_tick_at, now)} · as of {hm(p.as_of)} Warsaw.</p>
      </>}
    </Sheet>
  )
}
