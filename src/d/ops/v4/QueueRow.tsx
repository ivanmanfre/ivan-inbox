import { Avatar } from '../../../ds/Avatar'
import { LiveDot } from '../../../ds/Working'
import { Badge } from '../../../ds/Badge'
import { cardStateOf, type FeedState, type OpsDraft } from '../../../lib/ops'
import { seatOf } from '../../seats'
import { kindTitle, rowLine } from '../model'
export function QueueRow({ d, selected, onPick, held, feed, position = -1, highlight = false }: {
  d: OpsDraft; selected: boolean; onPick: (id: string) => void; held?: boolean; feed?: FeedState; position?: number; highlight?: boolean
}) {
  const line = rowLine(d), seat = seatOf(d.client_id), state = cardStateOf(feed)
  return <button type="button" className={`op-q op4-row${selected ? ' op-on' : ''}`} data-op-row={d.id} data-seat={seat ?? d.client_id}
    aria-current={selected ? 'true' : undefined} data-batch-hl={highlight || undefined} onClick={() => onPick(d.id)}>
    <Avatar name={line.who} initials={line.who.split(/\s+/).slice(0, 2).map(x => x[0]).join('').toUpperCase()} size="sm" tint={seat === 'ivan' ? 1 : seat === 'risedtc' ? 2 : seat === 'arch' ? 3 : 4} />
    <span className="op4-rowmain"><span className="op4-rowtop"><b>{line.who}</b><time className={line.hot ? 'op-hot' : ''}>{line.hot && new Date(String(d.context?.expires_at ?? '')).getTime() - Date.now() < 7200000 && <span className="op4-live" aria-hidden="true">● </span>}{line.time}</time></span>
      <span className="op4-rowbottom"><Badge className={`op4-kind${d.kind === 'comment_outbound' ? ' op4-kind-comment' : ''}`}>{d.kind === 'comment_outbound' ? 'Comment' : kindTitle(d)}</Badge><span className="op-qs">{line.text}</span>
        {held ? <Badge tone="attention">Held</Badge> : position >= 0 ? <Badge tone="accent"><LiveDot label="In the comment line" />Queued {position + 1}</Badge> : state === 'posted' || state === 'failed' || state === 'queued' ? <Badge tone={state === 'failed' ? 'attention' : 'neutral'}>{state === 'posted' ? 'Posted' : state === 'failed' ? 'Failed' : 'Queued'}</Badge> : null}
        {d.context?.needs_davor === true && <Badge tone="attention">Waiting on Davorin</Badge>}
      </span>
    </span>
  </button>
}
