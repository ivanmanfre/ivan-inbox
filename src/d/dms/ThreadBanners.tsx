// Which banners a thread shows, in the mock's order.
import type { Thread } from '../../lib/inbox'
import { FollowUpBanner, GapBanner, NoDraftBanner, OwnerHoldBanner, PushedBanner, WaitingBanner } from './Banners'
import type { DmVerbs } from './verbs'
import { blockedFollowup } from './upcoming'

export function Banners({ t, verbs, now, owed, hasDraft, onNote, reload, fuTick, v4 = false }: {
  t: Thread; verbs: DmVerbs; now: number; owed: boolean; hasDraft: boolean; onNote: () => void; reload: () => void; fuTick: number
  /** Brief 4: Pushed and Gap ride inside the draft card (DraftStrips); Waiting is a centred system line. */
  v4?: boolean
}) {
  if (t.spam) return null
  const blocked = blockedFollowup(t)
  if (v4) return <>
    <OwnerHoldBanner t={t} verbs={verbs} onNote={onNote} onRetry={reload} />
    <FollowUpBanner t={t} verbs={verbs} tick={fuTick} />
    {blocked && <div className="dm-ban dm-ban-hl dx-ban-bad" role="note"><b>Follow-up blocked</b><p>{blocked.reason}. The message was not sent.</p><p>Read the thread and write a replacement below.</p></div>}
    {!hasDraft && !t.ownerConfirmation && !blocked && (owed ? <NoDraftBanner t={t} now={now} /> : <div className="dx-sys"><WaitingBanner t={t} /></div>)}
  </>
  return <>
    <OwnerHoldBanner t={t} verbs={verbs} onNote={onNote} onRetry={reload} />
    <FollowUpBanner t={t} verbs={verbs} tick={fuTick} />
    {blocked && <div className="dm-ban dm-ban-hl" role="note"><b>Follow-up blocked</b><p>{blocked.reason}. The message was not sent.</p><p>Read the thread and write a replacement below.</p></div>}
    {!hasDraft && !t.ownerConfirmation && !blocked && (owed ? <NoDraftBanner t={t} now={now} /> : <WaitingBanner t={t} />)}
    {hasDraft && <PushedBanner t={t} verbs={verbs} />}
    {hasDraft && <GapBanner t={t} verbs={verbs} />}
  </>
}

/** Brief 4: the draft's own strips (Pushed, Gap), attached inside the draft card. Same components. */
export function DraftStrips({ t, verbs }: { t: Thread; verbs: DmVerbs }) {
  if (t.spam || !t.draft) return null
  return <>
    <PushedBanner t={t} verbs={verbs} />
    <GapBanner t={t} verbs={verbs} />
  </>
}
