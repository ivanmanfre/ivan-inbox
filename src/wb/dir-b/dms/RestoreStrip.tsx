import { useState } from 'react'
import { Button, Card, Chip } from '../../../ds'
import { canRestore, eventTime, isDiscarded, restoreDraft, type InboxMessage, type Thread } from '../../../lib/inbox'
import './dms.css'

// THE RESTORE CONTROL. Direction B copy of src/exp/v2c/RestoreStrip.tsx.
//
// RESTORE IS NOT APPROVE, and the copy says so rather than leaving it to be
// discovered. The write clears two columns and nothing else; `approved_at` stays
// NULL, which is the whole reason the dispatcher cannot pick the row up.
//
// THIS IS NOT AN UNDO FOR APPROVE, and no such thing is built.
//
// WHY THE CONTROL DISAPPEARS RATHER THAN REFUSING. `canRestore` holds the
// restore whenever our own side has spoken since the ruling. The row is still
// shown, because reading what was thrown away is the point; only the button is
// withheld.

// The sentence under an ineligible row. It NEVER gates anything: `canRestore` is
// the only gate, and this only explains what it decided.
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
    <Card
      tone="quiet"
      className="dirb-th-card"
      lead={<Chip tone="quiet" icon="undo">Draft you threw away</Chip>}
      tail={
        <span className="dirb-acts">
          <Button
            variant="quiet" size="sm" onClick={() => setOpen(o => !o)}
            aria-expanded={open}
          >{open ? 'Hide it' : 'Read it'}</Button>
          {allowed && (
            <Button variant="default" size="sm" busy={busy} onClick={run}>
              {busy ? 'Working…' : 'Bring it back'}
            </Button>
          )}
        </span>
      }
    >
      {open && <div className="dirb-quote ds-t-body">{m.message_text}</div>}
      <div className="ds-t-meta dirb-dim">
        {allowed
          // Says what the button does, in the words of what happens next. It
          // does not send and it does not approve.
          ? 'It comes back as a draft waiting on you. Nothing is sent until you approve it.'
          : whyHeld(thread, m)}
      </div>
      {note && <div className="ds-t-meta dirb-err">{note}</div>}
    </Card>
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
