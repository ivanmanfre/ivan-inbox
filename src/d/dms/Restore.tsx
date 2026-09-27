// Every draft thrown away on this thread, in the open conversation (today's RestoreStrip): Read it
// (the whole text), Bring it back (lib restoreDraft, through verbs.bringBack), or the exact reason
// it cannot come back. No 3-day cut: a discard from last month is still readable here.
import { useState } from 'react'
import { canRestore, eventTime, isDiscarded, type InboxMessage, type Thread } from '../../lib/inbox'
import { Btn } from '../ui/Key'
import { warsawDm, warsawHm } from '../ui/time'
import type { DmVerbs } from './verbs'

// Today's whyHeld (src/wb/thread/RestoreStrip.tsx), same conditions in the same order. It NEVER
// gates anything: canRestore is the only gate; this only explains what it decided.
export function whyHeld(t: Thread, m: InboxMessage): string {
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

function Gone({ t, m, verbs }: { t: Thread; m: InboxMessage; verbs: DmVerbs }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const ok = canRestore(t, m)
  const at = m.send_blocked_at
  return (
    <div className="dm-rest" data-discarded={m.id}>
      <div>
        <b>Draft you threw away{at ? ` · ${warsawDm(at)} ${warsawHm(at)}` : ''}{m.discard_mode === 'reply_myself' ? " · you'll reply yourself" : ''}</b>
        <span className="dm-ban-row" style={{ marginTop: 0 }}>
          <Btn verb="read-discarded" aria-expanded={open} onClick={() => setOpen(o => !o)}>{open ? 'Hide it' : 'Read it'}</Btn>
          {ok && <Btn verb="bring-back" disabled={busy} onClick={async () => { setBusy(true); try { await verbs.bringBack(t, m) } finally { setBusy(false) } }}>{busy ? 'Working…' : 'Bring it back'}</Btn>}
        </span>
      </div>
      {open && <blockquote className="dm-quote">{m.message_text}</blockquote>}
      <p className="dm-meta">{ok ? 'It comes back as a draft waiting on you. Nothing is sent until you approve it.' : whyHeld(t, m)}</p>
    </div>
  )
}

export function RestoreStrip({ t, verbs }: { t: Thread; verbs: DmVerbs }) {
  const gone = t.messages.filter(isDiscarded)
  if (!gone.length) return null
  return <>{gone.map(m => <Gone key={m.id} t={t} m={m} verbs={verbs} />)}</>
}
