// Which banners a thread shows, in the mock's order.
import type { Thread } from '../../lib/inbox'
import { FollowUpBanner, GapBanner, NoDraftBanner, OwnerHoldBanner, PushedBanner, WaitingBanner } from './Banners'
import type { DmVerbs } from './verbs'

export function Banners({ t, verbs, now, owed, hasDraft, onNote, reload }: {
  t: Thread; verbs: DmVerbs; now: number; owed: boolean; hasDraft: boolean; onNote: () => void; reload: () => void
}) {
  if (t.spam) return null
  return <>
    <OwnerHoldBanner t={t} verbs={verbs} onNote={onNote} onRetry={reload} />
    <FollowUpBanner t={t} verbs={verbs} reload={reload} />
    {!hasDraft && !t.ownerConfirmation && (owed ? <NoDraftBanner t={t} now={now} /> : <WaitingBanner t={t} />)}
    {hasDraft && <PushedBanner t={t} verbs={verbs} />}
    {hasDraft && <GapBanner t={t} verbs={verbs} />}
  </>
}
