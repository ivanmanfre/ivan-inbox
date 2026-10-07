import { useReplySource } from '../../hooks/useReplySources'
import { touchLabel } from '../../lib/replySources'
import { ReplySourceContent } from './ReplySourceSummary'
// The conversation, as chat bubbles: who, the words, the channel and when.
// Every message is shown whole with its links live (today's Linkified), a multi-bubble reply split
// the way LinkedIn delivered it, "To <email>" on a sent email, "Not accepted yet" on a pending
// invite note. Older messages sit behind one "N earlier" tap.
// Drafts, internal questions and discarded rows are not history (they live in the pane below).
import { Fragment, useState } from 'react'
import { eventTime, isDraft, isEngineRetired, isHiddenRetired, isInternalConfirmation, retiredLabel, sendFailed, messageChannel, type InboxMessage, type Thread } from '../../lib/inbox'
import { label } from '../../lib/labels'
import { Linkified } from '../ui/Linkified'
import { warsawDay, warsawDayWord, warsawHm } from '../ui/time'
import { seatOf } from '../seats'
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

/** An email in the DM timeline says where it went: "To <address>" on ours, "From <address>" on theirs.
 *  Our email legs (a DM draft's email pair, a scan delivery) and their email replies share the
 *  person's thread (grouped by prospect), so they interleave with the LinkedIn messages by time. */
export function emailAddrLine(m: InboxMessage): string | null {
  // On an inbound email row recipient_email holds the address it came FROM (the reply-to), so a
  // colleague answering for them reads right; the prospect's own address is the fallback.
  const addr = m.recipient_email || m.prospect_email
  if (!addr) return null
  return m.direction === 'inbound' ? `From ${addr}` : `To ${addr}${m.email_cc?.length ? ` · Cc ${m.email_cc.join(', ')}` : ''}`
}

export function historyRows(t: Thread): InboxMessage[] {
  return t.messages.filter(m => !isDraft(m) && !isInternalConfirmation(m) && !isHiddenRetired(m) && m.send_blocked_reason !== 'discarded_in_inbox'
    && (m.direction === 'inbound' || m.sent_at || m.approved_at || sendFailed(m) || isEngineRetired(m)))
}

const OURS: Record<string, string> = { ivan: 'You', risedtc: 'Mattan', arch: 'Davorin' }

/** Who wrote our side of this thread: "You" on Ivan's seat, the seat owner's name on Rise and Arch. */
export function oursLabel(t: Pick<Thread, 'client_id'>): string {
  return OURS[seatOf(t.client_id) ?? 'ivan']
}

/** The conversation as chat bubbles (Ivan 09-27: "very hard to distinguish who is doing the DM"):
 *  theirs on the left in grey with their first name on the first bubble of a run, ours on the right
 *  tinted with "You" (or Mattan / Davorin), a day line between days, and each bubble's channel,
 *  status and time underneath. The All conversations log reuses it as is. */
type HistoryProps = { t: Thread; cap?: number; now?: number; onReplyEmail?: () => void; onForwardEmail?: (m: InboxMessage) => void }

export function History(props: HistoryProps) {
  const [retry, setRetry] = useState(0)
  return <HistoryRead key={`${props.t.prospect_id}:${retry}`} {...props} retry={() => setRetry(n => n + 1)} />
}

function HistoryRead({ t, cap = 6, now = Date.now(), onReplyEmail, onForwardEmail, retry }: HistoryProps & { retry: () => void }) {
  const source = useReplySource({ kind: 'operator', clientId: t.client_id ?? 'ivan' }, t.prospect_id, true)
  const [all, setAll] = useState(false)
  const rows = historyRows(t)
  const lastEmail = rows.filter(m => m.direction === 'inbound' && messageChannel(m) === 'email').at(-1)?.id
  const shown = all ? rows : rows.slice(-cap)
  const first = t.prospect_name.split(' ')[0] || t.prospect_name
  const ours = oursLabel(t)
  if (!rows.length) {
    return <div className="dm-hist"><ReplySourceContent state={source} retry={retry} /><p className="dm-hist-empty">No messages yet. {t.draft ? 'The draft below is the first one.' : 'Nothing has been sent or received on this thread yet.'}</p></div>
  }
  let day = ''
  let prevSide: 'in' | 'out' | null = null
  return (
    <div className="dm-hist">
      <ReplySourceContent state={source} retry={retry} />
      {rows.length > shown.length && (
        <button type="button" className="dm-h-more" data-verb="history-earlier" onClick={() => setAll(true)}>{rows.length - shown.length} earlier message{rows.length - shown.length > 1 ? 's' : ''}</button>
      )}
      {shown.map(m => {
        const inb = m.direction === 'inbound'
        const side = inb ? 'in' : 'out'
        const pill = kindPill(m)
        const st = statusPill(m, t.stage)
        const blank = pill === 'Invite, blank'
        const email = messageChannel(m) === 'email'
        const parts = blank ? [] : inb ? [(m.message_text ?? '').trim()].filter(Boolean) : bubbles(m.message_text ?? '')
        const at = eventTime(m)
        const addr = email ? emailAddrLine(m) : null
        const d = warsawDay(at)
        const newDay = d !== day
        day = d
        const firstOfRun = newDay || prevSide !== side
        prevSide = side
        return (
          <Fragment key={m.id}>
            {newDay && <div className="dm-day" role="separator"><span>{warsawDayWord(at, now)}</span></div>}
            <div className={`dm-b dm-b-${side} dm-h-whole${inb ? ' dm-h-in' : ''}${st?.fail ? ' dm-h-fail' : ''}${email ? ' dm-h-email' : ''}${firstOfRun ? ' dm-b-first' : ''}`}
              data-msg={m.id} data-channel={email ? 'email' : undefined} data-side={side}>
              {firstOfRun && <b className="dm-b-who">{inb ? first : ours}</b>}
              <div className="dm-b-body">
                {addr && <small className="dm-h-addr">{addr}</small>}
                {blank ? <em className="dm-b-blank">Invite sent with no note, by design</em> : parts.length === 0 ? <em className="dm-b-blank">(no text: an image or a file)</em>
                  : parts.map((p, i) => <span key={i} className="dm-bub">{i > 0 && <br />}<Linkified text={p} /></span>)}
              </div>
              <div className="dm-b-meta">
                <i>{pill ?? 'LinkedIn'}</i>
                {st && <i className={st.fail ? 'dm-i-fail' : undefined}>{st.text}</i>}
                {inb && isReaction(m) && <i>reaction</i>}
                {source.kind === 'ready' && source.data.first_reply?.reply_id === m.id && <i>First observed reply · {touchLabel(source.data.first_reply.touch)}</i>}
                {source.kind === 'ready' && source.data.latest_reply?.reply_id === m.id && <i>Latest observed reply · {touchLabel(source.data.latest_reply.touch)}</i>}
                <time dateTime={at}>{warsawHm(at)}</time>
              </div>
              {inb && email && (onReplyEmail || onForwardEmail) && <div className="dm-email-actions">
                {m.id === lastEmail && onReplyEmail && <button type="button" className="dm-email-reply" data-verb="reply-email" onClick={onReplyEmail}>Reply by email</button>}
                {onForwardEmail && <button type="button" className="dm-email-reply" data-verb="forward-email" onClick={() => onForwardEmail(m)}>Forward to email</button>}
              </div>}
            </div>
          </Fragment>
        )
      })}
    </div>
  )
}
