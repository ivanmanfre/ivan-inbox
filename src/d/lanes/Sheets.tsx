/* The rarer ledgers, each a sheet from the foot bar: Delivery by lane, Daily
   ledger, Send log, Recurring problems. Plus the inbound decisions list (not
   drawn in the mock; the Inbound band's "Each decision" opens it). Read-only. */
import { type CcPayload } from '../../lib/campaignControl'
import { fetchInboundDecisions, INBOUND_LABEL, type InboundDecision } from '../../lib/inbound'
import { SEAT_NAME, type Seat } from '../seats'
import { Sheet } from '../ui/Sheet'
import { LoadLine } from './CampaignSheet'
import { LedgerSheet } from './LedgerSheet'
import { LogSheet } from './LogSheet'
import { ProblemsSheet } from './ProblemsSheet'
import { DeliverySheet } from './DeliverySheet'
import { useRead } from './useRead'
import { dm, type Range } from './model'

export type SheetKind = 'decisions' | 'log' | 'ledger' | 'delivery' | 'problems'

export function LanesSheet({ kind, seat, p, pFailed, range, now, setSeat, onClose }: { kind: SheetKind; seat: Seat | null; p: CcPayload | null; pFailed: string | null; range: Range; now: number; setSeat: (s: Seat | null) => void; onClose: () => void }) {
  if (kind === 'log') return <LogSheet seat={seat} setSeat={setSeat} now={now} onClose={onClose} />
  if (kind === 'ledger') return <LedgerSheet p={p} range={range} onClose={onClose} />
  if (kind === 'decisions') return <DecisionsSheet seat={seat ?? 'ivan'} onClose={onClose} />
  if (kind === 'delivery') return <DeliverySheet p={p} pFailed={pFailed} range={range} onClose={onClose} />
  return <ProblemsSheet p={p} pFailed={pFailed} onClose={onClose} />
}

function DecisionsSheet({ seat, onClose }: { seat: Seat; onClose: () => void }) {
  const d = useRead(async () => {
    const [a, b] = await Promise.all([fetchInboundDecisions('requests', seat, 60), fetchInboundDecisions('filtered', seat, 60)])
    return [...a, ...b].sort((x, y) => y.decided_at.localeCompare(x.decided_at))
  }, `dec:${seat}`)
  const row = (x: InboundDecision) => (
    <div className="dl-msg" key={x.id}>
      <div className="dl-mh"><b>{x.who}</b><span className="dl-tag">{INBOUND_LABEL[x.lane]}</span><span className={x.outcome === 'dropped' ? 'dl-tag dl-warnt' : 'dl-tag'}>{x.outcome === 'passed' ? 'let in' : 'dropped'}</span><em>{dm(x.decided_at)}</em></div>
      <p>{x.reason ?? 'no reason recorded'}{x.score != null ? ` · score ${x.score}` : ''}{x.detail ? ` · ${x.detail}` : ''}</p>
      {x.quote && <p className="dl-quote">“{x.quote}”</p>}
      {(x.judged_blind || x.surfaced) && <p className="dl-m">{x.judged_blind && <span className="dl-al">judged without a profile</span>}{x.judged_blind && x.surfaced ? ' · ' : ''}{x.surfaced && 're-admitted by hand'}</p>}
      {x.link ? <a className="dl-more" href={x.link} target="_blank" rel="noreferrer">Open profile ↗</a> : <p className="dl-m dl-dimt">no profile link</p>}
    </div>
  )
  return (
    <Sheet open onClose={onClose} className="dl-sheet" title={`Inbound decisions, ${SEAT_NAME[seat]}`}
      sub="Each stranger the automations decided about without you: invitations to this seat and the cold-DM filter. Newest first.">
      <LoadLine l={d} what="the inbound decisions">{rows => rows.length ? <>{rows.map(row)}</> : <p className="dl-sl">Nothing recorded for this seat. Either nothing has come in, or the lane was never armed here: the data cannot tell those apart yet.</p>}</LoadLine>
    </Sheet>
  )
}
