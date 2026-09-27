// The conversation, as the mock's ledger (`.df-hist`): who, kind pills, the words, when.
// Their last message is shown whole; older lines are one line each and open on tap.
// Drafts, internal questions and discarded rows are not history (they live in the pane below).
import { useState } from 'react'
import { eventTime, isDraft, isEngineRetired, isInternalConfirmation, retiredLabel, sendFailed, messageChannel, type InboxMessage, type Thread } from '../../lib/inbox'
import { label } from '../../lib/labels'
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

function statusPill(m: InboxMessage): { text: string; fail: boolean } | null {
  if (m.direction !== 'outbound') return null
  if (sendFailed(m)) return { text: `Send failed: ${label(m.send_blocked_reason)}`, fail: true }
  if (isEngineRetired(m)) return { text: retiredLabel(m), fail: false }
  if (m.approved_at && !m.sent_at) return { text: 'Queued', fail: false }
  return null
}

export function historyRows(t: Thread): InboxMessage[] {
  return t.messages.filter(m => !isDraft(m) && !isInternalConfirmation(m) && m.send_blocked_reason !== 'discarded_in_inbox'
    && (m.direction === 'inbound' || m.sent_at || m.approved_at || sendFailed(m) || isEngineRetired(m)))
}

export function History({ t, cap = 6 }: { t: Thread; cap?: number }) {
  const [all, setAll] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const rows = historyRows(t)
  const lastIn = rows.filter(m => m.direction === 'inbound').at(-1)
  const shown = all ? rows : rows.slice(-cap)
  const first = t.prospect_name.split(' ')[0] || t.prospect_name
  if (!rows.length) {
    return <div className="dm-hist"><p className="dm-hist-empty">No messages yet. {t.draft ? 'The draft below is the first one.' : 'Nothing has been sent or received on this thread yet.'}</p></div>
  }
  return (
    <div className="dm-hist">
      {rows.length > shown.length && (
        <button type="button" className="dm-h dm-h-more" onClick={() => setAll(true)}><b /><span>{rows.length - shown.length} earlier message{rows.length - shown.length > 1 ? 's' : ''}</span><time /></button>
      )}
      {shown.map(m => {
        const inb = m.direction === 'inbound'
        const pill = kindPill(m)
        const st = statusPill(m)
        const blank = pill === 'Invite, blank'
        const text = blank ? 'no note, by design' : (m.message_text ?? '').replace(/^[ \t]*-{3,}[ \t\r]*$/gm, '\n').trim() || '(no text: an image or a file)'
        const whole = m === lastIn || openId === m.id
        const at = eventTime(m)
        return (
          <div key={m.id} className={`dm-h${inb ? ' dm-h-in' : ''}${whole ? ' dm-h-whole' : ''}${st?.fail ? ' dm-h-fail' : ''}`}
            onClick={() => setOpenId(o => (o === m.id ? null : m.id))}>
            <b>{inb ? first : 'You'}</b>
            <span>
              {st && <i className={st.fail ? 'dm-i-fail' : undefined}>{st.text}</i>}
              {pill && <i>{pill}</i>}
              {inb && isReaction(m) && <i>reaction</i>}
              {m.channel === 'email' && inb && m.prospect_email && <i>from {m.prospect_email}</i>}
              {text}
            </span>
            <time>{warsawDow(at)} {warsawDm(at)} {warsawHm(at)}</time>
          </div>
        )
      })}
    </div>
  )
}
