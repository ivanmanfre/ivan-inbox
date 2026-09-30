// Which banners a thread shows, in the mock's order.
import type { Thread } from '../../lib/inbox'
import { FollowUpBanner, GapBanner, NoDraftBanner, OwnerHoldBanner, PushedBanner, WaitingBanner } from './Banners'
import type { DmVerbs } from './verbs'
import { blockedFollowup } from './upcoming'

export function Banners({ t, verbs, now, owed, hasDraft, onNote, reload, fuTick }: {
  t: Thread; verbs: DmVerbs; now: number; owed: boolean; hasDraft: boolean; onNote: () => void; reload: () => void; fuTick: number
}) {
  if (t.spam) return null
  const blocked = blockedFollowup(t)
  return <>
    <OwnerHoldBanner t={t} verbs={verbs} onNote={onNote} onRetry={reload} />
    <FollowUpBanner t={t} verbs={verbs} tick={fuTick} />
    {blocked && <div className="dm-ban dm-ban-hl" role="note"><b>Follow-up blocked</b><p>{blocked.reason}. The message was not sent.</p><p>Read the thread and write a replacement below.</p></div>}
    {!hasDraft && !t.ownerConfirmation && !blocked && (owed ? <NoDraftBanner t={t} now={now} /> : <WaitingBanner t={t} />)}
    {hasDraft && <PushedBanner t={t} verbs={verbs} />}
    {hasDraft && <GapBanner t={t} verbs={verbs} />}
  </>
}
