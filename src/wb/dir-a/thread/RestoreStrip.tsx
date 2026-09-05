/* ==========================================================================
   src/wb/dir-a/thread/RestoreStrip.tsx — S14-9 to S14-11.

   Rebuilt from src/exp/v2c/RestoreStrip.tsx. The eligibility gate, the
   false-is-not-a-success guard, the held-reason sentences and every string come
   over untouched. The strip is now a Group whose foot carries the two controls;
   the reason line sits on the row it belongs to.
   ========================================================================== */
import { useState } from 'react'
import { Banner, Button } from '../../../ds'
import { Group } from '../kit'
import { canRestore, eventTime, isDiscarded, restoreDraft, type InboxMessage, type Thread } from '../../../lib/inbox'
import './thread.css'

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
      // A FALSE IS NOT A SUCCESS. PostgREST reports no error for a zero-row
      // update, so without saying this the operator would be told the draft is
      // back while the list refetches it away.
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
    <Group
      label="Draft you threw away"
      quiet
      tail={
        <Button
          variant="quiet"
          size="sm"
          icon={open ? 'discloseUp' : 'disclose'}
          aria-expanded={open}
          onClick={() => setOpen(o => !o)}
        >{open ? 'Hide it' : 'Read it'}</Button>
      }
      foot={allowed
        ? (
          <>
            <Button variant="quiet" icon="undo" busy={busy} disabled={busy} onClick={run}>
              {busy ? 'Working…' : 'Bring it back'}
            </Button>
            {/* Says what the button does, in the words of what happens next. It
                does not send and it does not approve. */}
            <span className="a-meta">
              It comes back as a draft waiting on you. Nothing is sent until you approve it.
            </span>
          </>
        )
        : <span className="a-meta">{whyHeld(thread, m)}</span>}
      pad={open || Boolean(note)}
    >
      {(open || note) && (
        <div className="a-stack" data-tight>
          {open && <div className="a-quote a-pre">{m.message_text}</div>}
          {note && <Banner tone="attention" icon="alert">{note}</Banner>}
        </div>
      )}
    </Group>
  )
}

export function RestoreStrip({ thread, refresh }: { thread: Thread; refresh: () => void }) {
  const gone = thread.messages.filter(isDiscarded)
  if (gone.length === 0) return null
  return (
    <div className="a-thread-restore">
      {gone.map(m => (
        <DiscardedRow key={m.id} thread={thread} m={m} refresh={refresh} />
      ))}
    </div>
  )
}
