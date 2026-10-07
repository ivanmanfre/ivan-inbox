import type { OpsDraft } from '../../../lib/ops'
import { seatFullName } from '../../../lib/ops'
import type { PendingCardState } from '../../../wb/ops/usePendingCard'
import { Badge } from '../../../ds/Badge'
import { warsawDayTime } from '../../ui/time'

export function Preview({ d, st }: { d: OpsDraft; st: PendingCardState }) {
  let text = null
  if (st.isOutbound) text = st.approveUrl
    ? <>{st.tag && st.canTagAuthor ? <>Posts as: <Badge tone="accent">@{st.authorName}</Badge></> : 'Posts untagged:'} {st.body}</>
    : 'Copied for you to paste from Mattan’s seat.'
  else if (st.isComment && !st.commentCloseOnly) text = <>Replies as {seatFullName(d.client_id)}: {st.tag && st.canTag && <Badge tone="accent">@{st.commenterName}</Badge>} {st.body}</>
  else if (st.weeklyDispatches) text = <>Sends {d.context?.send_after ? warsawDayTime(String(d.context.send_after)) : 'within about a minute'}: the report from the app, then your line from your own account.</>
  else if (d.kind === 'precall_email') text = <>Emails {String(d.context?.invitee_email ?? 'the invitee')} from im@ within about 5 minutes.</>
  return text ? <div className="op4-preview" data-preview>{text}</div> : null
}
