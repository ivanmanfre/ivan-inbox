// The conversation, as the mock's ledger (`.df-hist`): who, kind pills, the words, when.
// Every message is shown whole with its links live (today's Linkified), a multi-bubble reply split
// the way LinkedIn delivered it, "To <email>" on a sent email, "Not accepted yet" on a pending
// invite note. Older messages sit behind one "N earlier" tap.
// Drafts, internal questions and discarded rows are not history (they live in the pane below).
import { useState } from 'react'
import { eventTime, isDraft, isEngineRetired, isInternalConfirmation, retiredLabel, sendFailed, messageChannel, type InboxMessage, type Thread } from '../../lib/inbox'
import { label } from '../../lib/labels'
import { Linkified } from '../ui/Linkified'
import { warsawDm, warsawDow, warsawHm } from '../ui/time'
import { isReaction } from './model'

export function kindPill(m: InboxMessage): string | null {
  if (m.ai_model === 'lm_gate_v1') return 'Lead magnet'
  if (m.ai_model === 'manual_mirror') return 'typed on LinkedIn'
  const c = messageChannel(m)
  if (c === 'invite') return /^\(blank invite/i.test(m.message_text ?? '') || !(m.message_text ?? '').trim() ? 'Invite, blank' : 'Invite'
  if (c === 'inmail') return 'InMail'
  if (c === 'email') return 'Email'
  return null
}

function statusPill(m: InboxMessage, stage: string): { text: string; fail: boolean } | null {
  if (m.direction !== 'outbound') return null
  if (sendFailed(m)) return { text: `Send failed: ${label(m.send_blocked_reason)}`, fail: true }
  if (isEngineRetired(m)) return { text: retiredLabel(m), fail: false }
  if (m.approved_at && !m.sent_at) return { text: 'Queued', fail: false }
  // Today's outLabel: an invite note on a person still at connection_sent was not accepted yet.
  if (m.message_type === 'connection_note' && stage === 'connection_sent') return { text: 'Not accepted yet', fail: false }
  return null
}

/** The dispatcher's multi-bubble split (a delimiter-only line), as today's thread renders it. */
export function bubbles(text: string): string[] {
  return text.split(/^[ \t]*-{3,}[ \t\r]*$/m).map(p => p.trim()).filter(Boolean)
}

export function historyRows(t: Thread): InboxMessage[] {
  return t.messages.filter(m => !isDraft(m) && !isInternalConfirmation(m) && m.send_blocked_reason !== 'discarded_in_inbox'
    && (m.direction === 'inbound' || m.sent_at || m.approved_at || sendFailed(m) || isEngineRetired(m)))
}

export function History({ t, cap = 6 }: { t: Thread; cap?: number }) {
  const [all, setAll] = useState(false)
  const rows = historyRows(t)
  const shown = all ? rows : rows.slice(-cap)
  const first = t.prospect_name.split(' ')[0] || t.prospect_name
  if (!rows.length) {
    return <div className="dm-hist"><p className="dm-hist-empty">No messages yet. {t.draft ? 'The draft below is the first one.' : 'Nothing has been sent or received on this thread yet.'}</p></div>
  }
  return (
    <div className="dm-hist">
      {rows.length > shown.length && (
        <button type="button" className="dm-h dm-h-more" data-verb="history-earlier" onClick={() => setAll(true)}><b /><span>{rows.length - shown.length} earlier message{rows.length - shown.length > 1 ? 's' : ''}</span><time /></button>
      )}
      {shown.map(m => {
        const inb = m.direction === 'inbound'
        const pill = kindPill(m)
        const st = statusPill(m, t.stage)
        const blank = pill === 'Invite, blank'
        const email = messageChannel(m) === 'email'
        const parts = blank ? [] : inb ? [(m.message_text ?? '').trim()].filter(Boolean) : bubbles(m.message_text ?? '')
        const at = eventTime(m)
        const to = !inb && email ? (m.recipient_email || m.prospect_email) : null
        return (
          <div key={m.id} className={`dm-h dm-h-whole${inb ? ' dm-h-in' : ''}${st?.fail ? ' dm-h-fail' : ''}`} data-msg={m.id}>
            <b>{inb ? first : 'You'}</b>
            <span>
              {st && <i className={st.fail ? 'dm-i-fail' : undefined}>{st.text}</i>}
              {pill && <i>{pill}</i>}
              {inb && isReaction(m) && <i>reaction</i>}
              {email && inb && m.prospect_email && <i>from {m.prospect_email}</i>}
              {to && <i>to {to}</i>}
              {blank ? 'no note, by design' : parts.length === 0 ? '(no text: an image or a file)'
                : parts.map((p, i) => <span key={i} className="dm-bub">{i > 0 && <br />}<Linkified text={p} /></span>)}
            </span>
            <time>{warsawDow(at)} {warsawDm(at)} {warsawHm(at)}</time>
          </div>
        )
      })}
    </div>
  )
}
