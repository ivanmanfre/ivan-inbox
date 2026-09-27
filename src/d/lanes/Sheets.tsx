/* The rarer ledgers, each a sheet from the foot bar: Delivery by lane, Daily
   ledger, Send log, Recurring problems. Plus the inbound decisions list (not
   drawn in the mock; the Inbound band's "Each decision" opens it). Read-only. */
import { type CcPayload } from '../../lib/campaignControl'
import { fetchInboundDecisions, INBOUND_LABEL, type InboundDecision } from '../../lib/inbound'
import { buildLedger, fetchDayLedger } from '../../lib/kpis'
import { fetchSendLog, fetchSendLogTotals } from '../../lib/sends'
import { SEATS, SEAT_NAME, seatOf, type Seat } from '../seats'
import { Sheet } from '../ui/Sheet'
import { LoadLine, Shs, useRead } from './CampaignSheet'
import { dm, hm, type Range } from './model'

const CH: Record<string, string> = { invitation: 'Invites', dm: 'DMs', inmail: 'InMail' }
export type SheetKind = 'decisions' | 'log' | 'ledger' | 'delivery' | 'problems'

export function LanesSheet({ kind, seat, p, range, onClose }: { kind: SheetKind; seat: Seat | null; p: CcPayload | null; range: Range; onClose: () => void }) {
  if (kind === 'log') return <LogSheet onClose={onClose} />
  if (kind === 'ledger') return <LedgerSheet onClose={onClose} />
  if (kind === 'decisions') return <DecisionsSheet seat={seat ?? 'ivan'} onClose={onClose} />
  if (kind === 'delivery') {
    const rows = p ? p.ranges.rows.filter(r => r.interval === range && r.source_lane !== '__all__' && r.sent) : []
    return (
      <Sheet open onClose={onClose} className="dl-sheet" title="Delivery by lane" sub={`Last ${range.replace('d', ' days')}, confirmed sends only. Lanes are read from the campaign name, so an Arch lane can sit inside a campaign named for another.`}>
        {!p ? <p className="dl-sl dl-bad">The send monitor could not be read.</p> : SEATS.map(s => (
          <div key={s}>
            <Shs>{SEAT_NAME[s]}</Shs>
            <table className="dl-steps"><thead><tr><th>Lane</th><th>Channel</th><th>Sent</th><th>People</th></tr></thead><tbody>
              {rows.filter(r => r.client_id === s).sort((a, b) => b.sent - a.sent).map(r => (
                <tr key={`${r.channel}:${r.source_lane}`}><td>{r.source_lane.replace(/_/g, ' ')}</td><td>{CH[r.channel] ?? r.channel}</td><td className="dl-m">{r.sent}</td><td className="dl-m">{r.unique_recipients ?? 'unknown'}</td></tr>
              ))}
            </tbody></table>
            <p className="dl-sl">{p.ranges.compare.filter(r => r.client_id === s && r.current === range).map(r =>
              `${CH[r.channel] ?? r.channel} ${r.sent_current} against ${r.sent_previous} the ${range} before${r.delta_pp != null ? ` (accept ${r.accept_rate_current_pct}% against ${r.accept_rate_previous_pct}%)` : ''}`).join('. ') || `No earlier ${range} to compare with.`}</p>
          </div>
        ))}
      </Sheet>
    )
  }
  const rec = p?.recurrence ?? null
  const picks = (rec?.items ?? []).filter(i => i.rank?.daily_pick).slice(0, 3)
  return (
    <Sheet open onClose={onClose} className="dl-sheet" title="Recurring problems"
      sub={rec ? `Weekly result: ${(rec.weekly?.result ?? 'unknown').replace(/_/g, ' ')}. Today's picks from the recurrence ledger.` : 'This snapshot carries no recurrence ledger, so nothing recurring is shown.'}>
      {rec && !picks.length && <p className="dl-sl">No problem was picked for today.</p>}
      {picks.map(i => (
        <div className="dl-msg" key={i.recurrence_id}>
          <div className="dl-mh"><b>{i.title}</b><em>{i.independent ? `${i.independent.distinct_events} events, ${i.independent.distinct_days} days` : ''}</em></div>
          <p>{i.withheld ? `Repair withheld${i.withheld_reason ? `: ${i.withheld_reason}` : '.'}` : `Recommended repair: ${i.recommended_fix ?? 'none recorded'}`}</p>
        </div>
      ))}
    </Sheet>
  )
}

function LogSheet({ onClose }: { onClose: () => void }) {
  const log = useRead(() => fetchSendLog('all', 40), 'log')
  const tot = useRead(() => fetchSendLogTotals('all'), 'logtot')
  const t = tot.kind === 'ready' ? tot.data : null
  const items = log.kind === 'ready' ? log.data : []
  const sent = items.filter(x => x.kind === 'sent'), failed = items.filter(x => x.kind === 'failed')
  const kind = (m: { message_type: string }) => (m.message_type === 'connection_note' ? 'Invite' : m.message_type === 'inmail' ? 'InMail' : m.message_type === 'email' ? 'Email' : 'DM')
  return (
    <Sheet open onClose={onClose} className="dl-sheet" title="Send log"
      sub={t ? `Newest ${sent.length} of ${t.sent.toLocaleString('en-US')} sent · ${failed.length} of ${t.blocked.toLocaleString('en-US')} blocked. All three seats, each row says whose.` : 'All three seats, each row says whose.'}>
      <LoadLine l={log} what="the send log">{() => <>
        <Shs tail={failed.length}>Blocked, newest</Shs>
        {failed.map(b => <div className="dl-lg dl-f" key={b.id}><time>{dm(b.event_at)} {hm(b.event_at)}</time><span className="dl-k">Failed</span><p><span className="dl-nm">{b.prospect_name}</span> · {(b.reason ?? 'send failed').replace(/_/g, ' ')}</p><span className="dl-s">{SEAT_NAME[seatOf(b.client_id) ?? 'ivan']}</span></div>)}
        <Shs tail={sent.length}>Sent, newest</Shs>
        {sent.map(m => <div className="dl-lg" key={m.id}><time>{dm(m.event_at)} {hm(m.event_at)}</time><span className="dl-k">{kind(m)}</span><p><span className="dl-nm">{m.prospect_name}</span> · {!m.message_text || /^\(blank invite/.test(m.message_text) ? 'no note' : m.message_text.replace(/\s+/g, ' ')}</p><span className="dl-s">{SEAT_NAME[seatOf(m.client_id) ?? 'ivan']}</span></div>)}
      </>}</LoadLine>
    </Sheet>
  )
}

function LedgerSheet({ onClose }: { onClose: () => void }) {
  const rows = useRead(fetchDayLedger, 'ledger')
  return (
    <Sheet open onClose={onClose} className="dl-sheet" title="Daily ledger"
      sub="Last 7 days per seat. Cap = the seat's counter, spent before LinkedIn answers; when it runs ahead of invites, those slots went to refused sends.">
      <LoadLine l={rows} what="the daily ledger">{data => data.length === 0 ? <p className="dl-sl">The daily ledger has no rows.</p> : <>{SEATS.map(s => (
        <div key={s}>
          <Shs>{SEAT_NAME[s]}</Shs>
          <table className="dl-steps"><thead><tr><th>Day</th><th>Invites</th><th>Accepted</th><th>DMs</th><th>InMail</th><th>Cap</th></tr></thead><tbody>
            {buildLedger(data, s, 7).map((r, i) => (
              <tr key={r.day}><td>{i === 0 ? 'Today' : new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${r.day}T12:00:00Z`))}</td>
                <td className="dl-m">{r.invites}</td><td className="dl-m">{r.accepted}</td><td className="dl-m">{r.dms}</td><td className="dl-m">{r.inmails}</td>
                <td className="dl-m">{r.cap_used == null ? '—' : `${r.cap_used}/${r.cap_limit}`}</td></tr>
            ))}
          </tbody></table>
        </div>
      ))}</>}</LoadLine>
    </Sheet>
  )
}

function DecisionsSheet({ seat, onClose }: { seat: Seat; onClose: () => void }) {
  const d = useRead(async () => {
    const [a, b] = await Promise.all([fetchInboundDecisions('requests', seat, 30), fetchInboundDecisions('filtered', seat, 30)])
    return [...a, ...b].sort((x, y) => y.decided_at.localeCompare(x.decided_at))
  }, `dec:${seat}`)
  const row = (x: InboundDecision) => (
    <div className="dl-msg" key={x.id}>
      <div className="dl-mh"><b>{x.who}</b><span className="dl-tag">{INBOUND_LABEL[x.lane]}</span><span className={x.outcome === 'dropped' ? 'dl-tag dl-warnt' : 'dl-tag'}>{x.outcome === 'passed' ? 'let in' : 'dropped'}</span><em>{dm(x.decided_at)}</em></div>
      <p>{x.reason ?? 'no reason recorded'}{x.score != null ? ` · score ${x.score}` : ''}{x.detail ? ` · ${x.detail}` : ''}</p>
      {x.quote && <p className="dl-quote">“{x.quote}”</p>}
      {x.link && <a className="dl-more" href={x.link} target="_blank" rel="noreferrer">Open profile ↗</a>}
    </div>
  )
  return (
    <Sheet open onClose={onClose} className="dl-sheet" title={`Inbound decisions, ${SEAT_NAME[seat]}`}
      sub="Each stranger the automations decided about without you: invitations to this seat and the cold-DM filter. Newest first.">
      <LoadLine l={d} what="the inbound decisions">{rows => rows.length ? <>{rows.map(row)}</> : <p className="dl-sl">No decisions recorded for this seat yet.</p>}</LoadLine>
    </Sheet>
  )
}
