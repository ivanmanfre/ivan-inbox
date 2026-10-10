import { useReplySource } from '../../hooks/useReplySources'
import { touchLabel } from '../../lib/replySources'
import { ReplySourceContent, ReplySourceLine, knownSource } from './ReplySourceSummary'
// The conversation, as chat bubbles: who, the words, the channel and when.
// Every message is shown whole with its links live (today's Linkified), a multi-bubble reply split
// the way LinkedIn delivered it, "To <email>" on a sent email, "Not accepted yet" on a pending
// invite note. Older messages sit behind one "N earlier" tap.
// Drafts, internal questions and discarded rows are not history (they live in the pane below).
import { canSendRejectedDm } from '../../lib/rejectedDm'
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import { eventTime, isDraft, isEngineRetired, isHiddenRetired, isInternalConfirmation, retiredLabel, sendFailed, messageChannel, type InboxMessage, type Thread } from '../../lib/inbox'
import { label } from '../../lib/labels'
import { Linkified } from '../ui/Linkified'
import { warsawDay, warsawDayWord, warsawHm } from '../ui/time'
import { seatOf } from '../seats'
import { isReaction } from './model'
import { engagementSignals, type CameBackSignal } from '../../wb/dms/cameBackData'

export function kindPill(m: InboxMessage): string | null {
  if (m.ai_model === 'lm_gate_v1') return 'Lead magnet'
  if (m.ai_model === 'manual_mirror') return 'typed on LinkedIn'
  const c = messageChannel(m)
  if (c === 'invite') return /^\(blank invite/i.test(m.message_text ?? '') || !(m.message_text ?? '').trim() ? 'Invite, blank' : 'Invite'
  if (c === 'inmail') return 'InMail'
  if (c === 'email') return 'Email'
  return null
}

export function statusPill(m: InboxMessage, stage: string): { text: string; fail: boolean } | null {
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
type HistoryProps = { onSendAnyways?: (m: InboxMessage) => void; sending?: boolean; t: Thread; cap?: number; engagements?: readonly CameBackSignal[] | null; now?: number; onReplyEmail?: () => void; onForwardEmail?: (m: InboxMessage) => void
  /** Brief 4: meta once per run (status, reaction, email and a channel change always), arrivals grow from their tail. */
  v4?: boolean }

export function History(props: HistoryProps) {
  const [retry, setRetry] = useState(0)
  return <HistoryRead key={`${props.t.prospect_id}:${retry}`} {...props} retry={() => setRetry(n => n + 1)} />
}

/** One engagement in the timeline (Ivan 10-10: "it only says reacted to something, I need to know to what"):
 *  which post they reacted to or commented on, linked, at its time. Never a profile view or a scan reopen. */
function EngagementLine({ s, owner }: { s: CameBackSignal; owner: string }) {
  const verb = s.kind === 'comment' ? 'Commented on' : s.kind === 'reaction' ? 'Reacted to' : 'Engaged with'
  // The tracker stores the first 80 characters, often mid-word: end a cut title on a whole word.
  const raw = s.post_title?.trim()
  const title = raw && raw.length >= 78 ? `${raw.replace(/\s+\S*$/, '').replace(/[\s.,;:!?-]+$/, '')}…` : raw
  const href = s.post_url && /^https:\/\//i.test(s.post_url) ? s.post_url : null
  const label = title ? `“${title}”` : 'the post (title not recorded)'
  return (
    <div className="dm-ev" data-signal={s.kind} data-at={s.at}>
      <span>{verb} {owner} post: {href ? <a href={href} target="_blank" rel="noreferrer" data-verb="open-engaged-post">{label}</a> : label}</span>
      {s.kind === 'comment' && s.detail?.trim() && <q>{s.detail.trim()}</q>}
      <time dateTime={s.at}>{warsawHm(s.at)}</time>
    </div>
  )
}

function HistoryRead({ onSendAnyways, sending, t, cap = 6, now = Date.now(), onReplyEmail, onForwardEmail, retry, v4 = false, engagements }: HistoryProps & { retry: () => void }) {
  const source = useReplySource({ kind: 'operator', clientId: t.client_id ?? 'ivan' }, t.prospect_id, true)
  const [all, setAll] = useState(false)
  // Above the empty return (09-09 rule). Which bubbles were already on screen for this thread, and
  // which arrived while it was open (>400 ms after it opened): those keep the arrival class.
  const seen = useRef<{ pid: string; at: number; ids: Set<string>; arrived: Set<string> }>({ pid: '', at: 0, ids: new Set(), arrived: new Set() })
  const rows = historyRows(t)
  const idsKey = rows.map(m => m.id).join(',')
  useEffect(() => {
    const s = seen.current
    if (s.pid !== t.prospect_id) { seen.current = { pid: t.prospect_id, at: Date.now(), ids: new Set(idsKey.split(',')), arrived: new Set() }; return }
    for (const id of idsKey.split(',')) s.ids.add(id)
  }, [t.prospect_id, idsKey])
  const lastEmail = rows.filter(m => m.direction === 'inbound' && messageChannel(m) === 'email').at(-1)?.id
  const shown = all ? rows : rows.slice(-cap)
  const first = t.prospect_name.split(' ')[0] || t.prospect_name
  const ours = oursLabel(t)
  const owner = seatOf(t.client_id) === 'risedtc' || seatOf(t.client_id) === 'arch' ? `${ours}'s` : 'your'
  // Engagements ride the same clock as the messages; with older messages folded away, the ones before
  // the first shown message fold with them.
  const edge = rows.length > shown.length ? Date.parse(eventTime(shown[0])) : -Infinity
  const evs = engagementSignals(engagements).filter(e => Date.parse(e.at) >= edge).reverse()
  if (!rows.length && !evs.length) {
    return <div className="dm-hist">{v4 ? <ReplySourceLine state={source} retry={retry} /> : <ReplySourceContent state={source} retry={retry} />}<p className="dm-hist-empty">No messages yet. {t.draft ? 'The draft below is the first one.' : 'Nothing has been sent or received on this thread yet.'}</p></div>
  }
  let day = ''
  let prevSide: 'in' | 'out' | null = null
  // v4 run bookkeeping: a run is the same side on the same day; meta sits on its last bubble.
  const s0 = seen.current
  const fresh = v4 && s0.pid === t.prospect_id && Date.now() - s0.at > 400
  const lastOfRun = (i: number) => {
    const a = shown[i], b = shown[i + 1]
    return !b || a.direction !== b.direction || warsawDay(eventTime(a)) !== warsawDay(eventTime(b))
  }
  let prevPill: string | null = null
  let nextEv = 0
  const evLines = (before: number) => {
    const out: ReactNode[] = []
    while (nextEv < evs.length && Date.parse(evs[nextEv].at) < before) {
      const e = evs[nextEv++]
      const d = warsawDay(e.at)
      const newDay = d !== day
      day = d
      prevSide = null
      out.push(<Fragment key={`ev:${e.kind}:${e.at}:${e.post_url ?? ''}`}>
        {newDay && <div className="dm-day" role="separator"><span>{warsawDayWord(e.at, now)}</span></div>}
        <EngagementLine s={e} owner={owner} />
      </Fragment>)
    }
    return out
  }
  let runShown: string | null = null
  return (
    <div className="dm-hist">
      {v4 ? <ReplySourceLine state={source} retry={retry} /> : <ReplySourceContent state={source} retry={retry} />}
      {rows.length > shown.length && (
        <button type="button" className="dm-h-more" data-verb="history-earlier" onClick={() => setAll(true)}>{rows.length - shown.length} earlier message{rows.length - shown.length > 1 ? 's' : ''}</button>
      )}
      {shown.map((m, i) => {
        const inb = m.direction === 'inbound'
        const side = inb ? 'in' : 'out'
        const pill = kindPill(m)
        const st = statusPill(m, t.stage)
        const blank = pill === 'Invite, blank'
        const email = messageChannel(m) === 'email'
        const parts = blank ? [] : inb ? [(m.message_text ?? '').trim()].filter(Boolean) : bubbles(m.message_text ?? '')
        const at = eventTime(m)
        const before = evLines(Date.parse(at))
        const addr = email ? emailAddrLine(m) : null
        const d = warsawDay(at)
        const newDay = d !== day
        day = d
        const firstOfRun = newDay || prevSide !== side
        prevSide = side
        const kind = pill ?? 'LinkedIn'
        const channelChanged = !firstOfRun && prevPill !== null && prevPill !== kind
        prevPill = kind
        const reaction = inb && isReaction(m)
        // v4: plain "LinkedIn · 10:46" only on the last bubble of a run; a non-default kind ("typed on
        // LinkedIn", Invite) once per run; a status, a reaction, an email and a channel change always on
        // their own bubble. Every bubble keeps its full meta in the tooltip.
        if (firstOfRun) runShown = null
        const last = lastOfRun(i)
        const needKind = pill !== null ? kind !== runShown : (last && runShown === null) || channelChanged
        // Brief 4: only a known source earns a badge, and only on the first reply (the latest one repeats it).
        const firstObs = source.kind === 'ready' && source.data.first_reply?.reply_id === m.id && (!v4 || knownSource(source.data.first_reply))
        const latestObs = source.kind === 'ready' && source.data.latest_reply?.reply_id === m.id && !v4
        const showMeta = !v4 || last || Boolean(st) || reaction || email || needKind || firstObs || latestObs
        const showKind = !v4 || needKind || (last && kind !== runShown)
        if (showMeta && showKind) runShown = kind
        if (fresh && !s0.ids.has(m.id)) s0.arrived.add(m.id)
        const arrive = v4 && s0.arrived.has(m.id)
        return (
          <Fragment key={m.id}>
            {before}
            {newDay && <div className="dm-day" role="separator"><span>{warsawDayWord(at, now)}</span></div>}
            <div className={`dm-b dm-b-${side} dm-h-whole${inb ? ' dm-h-in' : ''}${st?.fail ? ' dm-h-fail' : ''}${email ? ' dm-h-email' : ''}${firstOfRun ? ' dm-b-first' : ''}${v4 && last ? ' dx-b-last' : ''}${arrive ? ' dx-arrive' : ''}`}
              data-msg={m.id} data-channel={email ? 'email' : undefined} data-side={side}
              title={v4 ? [kind, st?.text, reaction ? 'reaction' : null, warsawHm(at)].filter(Boolean).join(' · ') : undefined}>
              {firstOfRun && <b className="dm-b-who">{inb ? first : ours}</b>}
              <div className="dm-b-body">
                {addr && <small className="dm-h-addr">{addr}</small>}
                {blank ? <em className="dm-b-blank">Invite sent with no note, by design</em> : parts.length === 0 ? <em className="dm-b-blank">(no text: an image or a file)</em>
                  : parts.map((p, i) => <span key={i} className="dm-bub">{i > 0 && <br />}<Linkified text={p} /></span>)}
              </div>
              {showMeta ? <div className="dm-b-meta">
                {showKind && <i>{kind}</i>}
                {st && <i className={st.fail ? 'dm-i-fail' : undefined}>{st.text}</i>}
                {reaction && <i>reaction</i>}
                {firstObs && <i>{v4 ? `Replied after ${touchLabel(source.data.first_reply!.touch)}` : `First observed reply · ${touchLabel(source.data.first_reply!.touch)}`}</i>}
                {latestObs && <i>Latest observed reply · {touchLabel(source.data.latest_reply!.touch)}</i>}
                <time dateTime={at}>{warsawHm(at)}</time>
              </div> : <time className="dx-sr" dateTime={at}>{warsawHm(at)}</time>}
              {onSendAnyways && !t.spam && canSendRejectedDm(m) && <div className="dm-rejected-actions"><button type="button" className="dm-email-reply dm-send-anyways" data-verb="send-anyways" disabled={sending} onClick={() => onSendAnyways?.(m)}>Send anyways</button></div>}
              {inb && email && (onReplyEmail || onForwardEmail) && <div className="dm-email-actions">
                {m.id === lastEmail && onReplyEmail && <button type="button" className="dm-email-reply" data-verb="reply-email" onClick={onReplyEmail}>Reply by email</button>}
                {onForwardEmail && <button type="button" className="dm-email-reply" data-verb="forward-email" onClick={() => onForwardEmail(m)}>Forward to email</button>}
              </div>}
            </div>
          </Fragment>
        )
      })}
      {evLines(Infinity)}
    </div>
  )
}
