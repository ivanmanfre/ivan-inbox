/* The rarer ledgers, each a sheet from the foot bar: Delivery by lane, Daily
   ledger, Send log, Recurring problems. Plus the inbound decisions list (not
   drawn in the mock; the Inbound band's "Each decision" opens it). Read-only. */
import { type CcPayload } from '../../lib/campaignControl'
import { fetchInboundDecisions, INBOUND_LABEL, type InboundDecision } from '../../lib/inbound'
import { SEATS, SEAT_NAME, type Seat } from '../seats'
import { Sheet } from '../ui/Sheet'
import { LoadLine, Shs } from './CampaignSheet'
import { LedgerSheet } from './LedgerSheet'
import { LogSheet } from './LogSheet'
import { useRead } from './useRead'
import { dm, type Range } from './model'

const CH: Record<string, string> = { invitation: 'Invites', dm: 'DMs', inmail: 'InMail' }
export type SheetKind = 'decisions' | 'log' | 'ledger' | 'delivery' | 'problems'

export function LanesSheet({ kind, seat, p, range, now, setSeat, onClose }: { kind: SheetKind; seat: Seat | null; p: CcPayload | null; range: Range; now: number; setSeat: (s: Seat | null) => void; onClose: () => void }) {
  if (kind === 'log') return <LogSheet seat={seat} setSeat={setSeat} now={now} onClose={onClose} />
  if (kind === 'ledger') return <LedgerSheet p={p} range={range} onClose={onClose} />
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
