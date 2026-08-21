import { useState } from 'react'
import { canRestore, eventTime, isDiscarded, restoreDraft, type InboxMessage, type Thread } from '../../lib/inbox'

// THE RESTORE CONTROL. Phase 4a shipped the write and the eligibility rule; this
// is the only place either of them is offered.
//
// WHY A DISCARDED DRAFT NEEDS A SURFACE AT ALL. Nothing rendered one before.
// `isDraft` excludes blocked rows, so a discarded draft leaves `thread.draft`;
// ThreadScreen's own `bubbles` filter drops `discarded_in_inbox` explicitly; and
// the failed-send log excludes the same reason on purpose (sends.ts:104). The
// row was reachable from nowhere, which is fine for a decision that was right
// and useless for one that was a mis-tap.
//
// 🔴 RESTORE IS NOT APPROVE, and the copy says so rather than leaving it to be
// discovered. The write clears two columns and nothing else; `approved_at` stays
// NULL, which is the whole reason the dispatcher cannot pick the row up. The
// full link-by-link trace is in
// goal-runs/workbench-2026-plan-2026-08-21/phase4a-restore.md section 2 and is
// not repeated here: restore moves a row from blocked-and-invisible to
// pending-and-visible, and both states are outside the sender's predicate.
// Sending still takes one human tap on Approve, made after the copy is back on
// screen and readable.
//
// 🔴 THIS IS NOT AN UNDO FOR APPROVE, and no such thing is built. The dispatcher
// claims rows on `sent_at IS NULL` without re-checking `approved_at`, so a
// client-side undo would report success while the message went out. Restore is
// safe for the opposite reason: it is a database guard that matches only rows
// the sender was never going to see.
//
// WHY THE CONTROL DISAPPEARS RATHER THAN REFUSING. `composeReply` discards the
// pending AI draft the moment Ivan hand-types his own reply, so a restored draft
// can be an answer to a message a human has already answered. `canRestore` holds
// the restore whenever our own side has spoken since the ruling, including
// during the two-minute window where the hand-typed reply is still queued and
// technically OLDER than the discard. The row is still shown, because reading
// what was thrown away is the point; only the button is withheld.

// The sentence under an ineligible row. It NEVER gates anything: `canRestore` is
// the only gate, and this only explains what it decided. Kept in the same order
// as the conditions in canRestore so the two read alike.
function whyHeld(t: Thread, m: InboxMessage): string {
  const queued = t.messages.some(o => o.direction === 'outbound' && !o.sent_at && o.approved_at !== null)
  if (queued) {
    return 'A reply on this thread is already in the send queue. Bringing this draft '
      + 'back would put a second message in front of the same person.'
  }
  const at = Date.parse(m.send_blocked_at ?? '')
  const spoke = t.messages.some(o => {
    if (o.id === m.id || o.direction !== 'outbound') return false
    const when = Date.parse(eventTime(o))
    return Number.isNaN(when) || Number.isNaN(at) || when > at
  })
  if (spoke) {
    return 'You have written on this thread since this draft was thrown away, so '
      + 'bringing it back would answer the same message twice.'
  }
  return 'This one cannot come back from here.'
}

function DiscardedRow({ thread, m, refresh }: {
  thread: Thread; m: InboxMessage; refresh: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [open, setOpen] = useState(false)
  const allowed = canRestore(thread, m)

  async function run() {
    setBusy(true); setNote('')
    try {
      const did = await restoreDraft(m.id)
      // 🔴 A FALSE IS NOT A SUCCESS. PostgREST reports no error for a zero-row
      // update, so without saying this the operator would be told the draft is
      // back while the list refetches it away. Phase 4a made both writes return
      // whether a row was actually affected precisely so this screen could tell
      // the truth about it.
      if (!did) {
        setNote('Nothing changed. This row has moved on since the screen loaded, '
          + 'so the draft was left alone. Reloading the conversation.')
      }
      refresh()
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Could not bring the draft back.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="wb-disc">
      <div className="wb-disc-h">
        <span className="wb-disc-t">Draft you threw away</span>
        <button
          type="button" className="wb-disc-x" onClick={() => setOpen(o => !o)}
          aria-expanded={open}
        >{open ? 'Hide it' : 'Read it'}</button>
        {allowed && (
          <button type="button" className="wb-disc-b" disabled={busy} onClick={run}>
            {busy ? 'Working…' : 'Bring it back'}
          </button>
        )}
      </div>
      {open && <div className="wb-disc-body">{m.message_text}</div>}
      <div className="wb-disc-s">
        {allowed
          // Says what the button does, in the words of what happens next. It
          // does not send and it does not approve.
          ? 'It comes back as a draft waiting on you. Nothing is sent until you approve it.'
          : whyHeld(thread, m)}
      </div>
      {note && <div className="wb-disc-note">{note}</div>}
    </div>
  )
}

export function RestoreStrip({ thread, refresh }: { thread: Thread; refresh: () => void }) {
  const gone = thread.messages.filter(isDiscarded)
  if (gone.length === 0) return null
  return (
    <>
      {gone.map(m => (
        <DiscardedRow key={m.id} thread={thread} m={m} refresh={refresh} />
      ))}
    </>
  )
}
