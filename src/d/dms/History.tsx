import { useReplySource } from '../../hooks/useReplySources'
import { touchLabel } from '../../lib/replySources'
import { ReplySourceContent, ReplySourceLine, knownSource } from './ReplySourceSummary'
// The conversation, as chat bubbles: who, the words, the channel and when.
// Every message is shown whole with its links live (today's Linkified), a multi-bubble reply split
// the way LinkedIn delivered it, "To <email>" on a sent email, "Not accepted yet" on a pending
// invite note. Older messages sit behind one "N earlier" tap.
// Drafts, internal questions and discarded rows are not history (they live in the pane below). A held
// message is: "Held, not sent", why, and Send anyway / Edit / Discard, in its place on the timeline.
// A message LinkedIn would not deliver (they blocked us, or cannot receive) is one quiet "Not delivered"
// line in its place, no keys, its words folded under it (Ivan 10-21: "I don't want to see it").
import { canEditHeldDm, canSendRejectedDm } from '../../lib/rejectedDm'
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import { canScheduleHeld, dedupeMessages, heldReasonText, heldSend, operatorSentAt, timelineTime, isDraft, isEngineRetired, isHeldSend, isHiddenRetired, isIntentionalStop, isInternalConfirmation, isPendingSend, isStoppedOnPurpose, isUnreachableSend, pendingSendLabel, retiredLabel, sendFailed, sentThenPending, shownTime, messageChannel, stopLabel, unreachableLabel, type InboxMessage, type Thread } from '../../lib/inbox'
import { label } from '../../lib/labels'
import { Linkified } from '../ui/Linkified'
import { warsawDay, warsawDayTime, warsawDayWord, warsawHm } from '../ui/time'
import { seatOf } from '../seats'
import { isReaction } from './model'
import { Grow } from './Draft'
import { engagementSignals, type CameBackSignal } from '../../wb/dms/cameBackData'
import { emailDetails } from '../../lib/emailPresentation'
import { EmailPreview } from './EmailMessage'

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
  // LinkedIn will not deliver to this person: muted, never a failure and never held.
  if (isUnreachableSend(m)) return { text: unreachableLabel(m), fail: false }
  // A gate held it (Ivan 10-21, Barak): it was never sent and is waiting on him, never "Send failed".
  if (isHeldSend(m)) return { text: 'Held, not sent', fail: true }
  if (sendFailed(m)) return { text: `Send failed: ${label(m.send_blocked_reason)}`, fail: true }
  if (isEngineRetired(m)) return { text: retiredLabel(m), fail: false }
  // Not sent on purpose (an invite went instead, they replied, excluded...): muted, never a failure.
  if (isIntentionalStop(m)) return { text: stopLabel(m), fail: false }
  // Approved and not sent: a SwishDM DM1 waits for the invite to go out and be accepted, anything else is
  // queued for its sender. Never worded like a send (2026-10-19, George at BUFFS).
  if (isPendingSend(m)) return { text: pendingSendLabel(m), fail: false }
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
  // A held row sits in its timeline place, unless it is the draft open in the pane below (Ivan 10-21:
  // a lint-held reply pushed out of the pane by a newer hold or draft used to vanish from both).
  const pane = new Set([t.draft?.id, t.companionDraft?.id])
  // Sent items in true send order, then every pending send (waiting for an accept, queued) after them.
  // A held row sits at its hold, not its creation (timelineTime, Ivan 10-21 Leighton Penrose).
  return sentThenPending([...dedupeMessages(t.messages)].sort((a, b) => Date.parse(timelineTime(a)) - Date.parse(timelineTime(b))).filter(m => isHeldSend(m) ? !pane.has(m.id) : !isDraft(m) && !isInternalConfirmation(m) && !isHiddenRetired(m) && !isEngineRetired(m) && m.send_blocked_reason !== 'discarded_in_inbox'
    && (m.direction === 'inbound' || m.sent_at || m.approved_at || sendFailed(m) || isEngineRetired(m) || isIntentionalStop(m) || isUnreachableSend(m))))
}

/** Under a held bubble: why, and when he sent it if the hold came after (Ivan 10-21, Leighton Penrose:
 *  a Send anyway held again looked exactly like the old held message). */
export function heldWhy(m: InboxMessage): string {
  const reason = heldReasonText(m.send_blocked_reason)
  const sent = operatorSentAt(m)
  if (!sent || !m.send_blocked_at) return reason
  const sameDay = warsawDay(sent.at) === warsawDay(m.send_blocked_at)
  const at = (iso: string) => sameDay ? warsawHm(iso) : warsawDayTime(iso)
  return `${sent.scheduled ? 'Scheduled for' : 'You sent this at'} ${at(sent.at)} · held at ${at(m.send_blocked_at)}: ${reason}`
}

const OURS: Record<string, string> = { ivan: 'You', risedtc: 'Mattan', arch: 'Davorin', swishdm: 'Jonathan' }

/** Who wrote our side of this thread: "You" on Ivan's seat, the seat owner's name on Rise and Arch. */
export function oursLabel(t: Pick<Thread, 'client_id'>): string {
  return OURS[seatOf(t.client_id) ?? 'ivan']
}

/** The conversation as chat bubbles (Ivan 09-27: "very hard to distinguish who is doing the DM"):
 *  theirs on the left in grey with their first name on the first bubble of a run, ours on the right
 *  tinted with "You" (or Mattan / Davorin), a day line between days, and each bubble's channel,
 *  status and time underneath. The All conversations log reuses it as is. */
export type HeldEditThen = 'save' | 'send' | 'later'

type HistoryProps = { onSendAnyways?: (m: InboxMessage) => void; onDiscardHeld?: (m: InboxMessage) => void
  /** Ivan 10-21 (Leighton Penrose): save an edit to a held message, then keep it held, send it, or schedule
   *  it. Resolves true once the edit is saved (the editor closes). `heldLater`: the thread can schedule. */
  onEditHeld?: (m: InboxMessage, text: string, then: HeldEditThen) => Promise<boolean>; heldLater?: boolean; sending?: boolean; t: Thread; cap?: number; engagements?: readonly CameBackSignal[] | null; now?: number; onReplyEmail?: (m: InboxMessage) => void; onForwardEmail?: (m: InboxMessage) => void
  revealMessageId?: string | null; activeEmailReplyId?: string | null
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

function HistoryRead({ onSendAnyways, onDiscardHeld, onEditHeld, heldLater = false, sending, t, cap = 6, now = Date.now(), onReplyEmail, onForwardEmail, retry, v4 = false, engagements, revealMessageId, activeEmailReplyId }: HistoryProps & { retry: () => void }) {
  const source = useReplySource({ kind: 'operator', clientId: t.client_id ?? 'ivan' }, t.prospect_id, true)
  const [all, setAll] = useState(false)
  useEffect(() => {
    if (!revealMessageId) return
    setAll(true)
    const frame = requestAnimationFrame(() => {
      const row = [...document.querySelectorAll<HTMLElement>('[data-msg]')].find(m => m.dataset.msg === revealMessageId)
      row?.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
      row?.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(frame)
  }, [revealMessageId])
  // The held message open in the editor (one at a time) and its words; nothing is saved until Save.
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null)
  const [editBusy, setEditBusy] = useState(false)
  const finishEdit = async (m: InboxMessage, then: HeldEditThen) => {
    if (!onEditHeld || !editing || editing.id !== m.id || editBusy || !editing.text.trim()) return
    setEditBusy(true)
    try { if (await onEditHeld(m, editing.text, then)) setEditing(null) } finally { setEditBusy(false) }
  }
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
  // The fold never hides the thread's open hold: the window starts at it when it is older.
  const openHeld = heldSend(t)
  const heldAt = openHeld ? rows.findIndex(m => m.id === openHeld.id) : -1
  const start = Math.max(0, rows.length - cap)
  const shown = all ? rows : rows.slice(heldAt >= 0 && heldAt < start ? heldAt : start)
  const first = t.prospect_name.split(' ')[0] || t.prospect_name
  const ours = oursLabel(t)
  const owner = seatOf(t.client_id) === 'risedtc' || seatOf(t.client_id) === 'arch' ? `${ours}'s` : 'your'
  // Engagements ride the same clock as the messages; with older messages folded away, the ones before
  // the first shown message fold with them.
  const edge = rows.length > shown.length ? Date.parse(timelineTime(shown[0])) : -Infinity
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
    return !b || a.direction !== b.direction || isPendingSend(a) !== isPendingSend(b) || (!isPendingSend(a) && warsawDay(timelineTime(a)) !== warsawDay(timelineTime(b)))
  }
  let prevPill: string | null = null
  let prevPend = false
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
        // A pending send (waiting for an accept, queued) is not on the day line: it comes after every sent
        // item, carries no clock (its draft/approval time was never a send time) unless it is scheduled.
        const pend = isPendingSend(m)
        const at = pend ? shownTime(m) : timelineTime(m)
        const before = evLines(pend ? Infinity : Date.parse(timelineTime(m)))
        const d = pend ? day : warsawDay(timelineTime(m))
        const newDay = d !== day
        day = d
        const firstOfRun = newDay || prevSide !== side || pend !== prevPend
        prevSide = side
        prevPend = pend
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
        const envelope = email ? emailDetails(m, t) : null
        if (isUnreachableSend(m)) return (
          <Fragment key={m.id}>
            {before}
            {newDay && <div className="dm-day" role="separator"><span>{warsawDayWord(timelineTime(m), now)}</span></div>}
            <details className="dm-h-undelivered" data-msg={m.id} data-undelivered="">
              <summary>{unreachableLabel(m)}{at && <> · <time dateTime={at}>{warsawHm(at)}</time></>}</summary>
              <p>{m.message_text}</p>
            </details>
          </Fragment>
        )
        const held = isHeldSend(m)
        // Stopped on purpose (send audit 2): the quiet line keeps only Discard, never Send anyway.
        const discardable = (held || isStoppedOnPurpose(m)) && !m.approved_at
        const canEdit = held && !t.spam && !!onEditHeld && canEditHeldDm(m)
        const edit = canEdit && editing?.id === m.id ? editing : null
        const editOff = sending || editBusy
        return (
          <Fragment key={m.id}>
            {before}
            {newDay && <div className="dm-day" role="separator"><span>{warsawDayWord(timelineTime(m), now)}</span></div>}
            <div className={`${email ? 'dm-email-history dm-h-email' : `dm-b dm-b-${side}`} dm-h-whole${pend ? ' dm-h-pending' : ''}${inb ? ' dm-h-in' : ''}${st?.fail ? ' dm-h-fail' : ''}${held ? ' dm-h-held' : ''}${edit ? ' dm-h-editing' : ''}${firstOfRun ? ' dm-b-first' : ''}${v4 && last ? ' dx-b-last' : ''}${arrive ? ' dx-arrive' : ''}`}
              data-msg={m.id} data-channel={email ? 'email' : undefined} data-side={side} data-pending={pend ? '' : undefined} data-held={held ? '' : undefined}
              data-reply-target={activeEmailReplyId === m.id ? '' : undefined} tabIndex={email ? -1 : undefined}
              title={v4 ? [kind, st?.text, reaction ? 'reaction' : null, at ? warsawHm(at) : null].filter(Boolean).join(' · ') : undefined}>
              {firstOfRun && !email && <b className="dm-b-who">{inb ? first : ours}</b>}
              {envelope && !edit ? <EmailPreview details={{ ...envelope, date: pend ? at : envelope.date ?? at }} state={st?.text ?? (inb ? 'Received' : 'Sent')} /> : edit ? <div className="dm-b-body dm-b-draft dm-held-edit" data-held-edit={m.id}>
                <Grow autosave={false} value={edit.text} max={360} label={`Edit the held message to ${first}`} onChange={text => setEditing({ id: m.id, text })}
                  onKeyDown={e => { if (e.key === 'Escape' && !editBusy) { e.preventDefault(); setEditing(null) } }} />
              </div> : <div className="dm-b-body">
                {blank ? <em className="dm-b-blank">Invite sent with no note, by design</em> : parts.length === 0 ? <em className="dm-b-blank">Message text unavailable</em>
                  : parts.map((p, i) => <span key={i} className="dm-bub">{i > 0 && <br />}<Linkified text={p} /></span>)}
              </div>}
              {showMeta && (!email || firstObs || latestObs) ? <div className="dm-b-meta">
                {showKind && !email && <i>{kind}</i>}
                {st && !email && <i className={st.fail ? 'dm-i-fail' : undefined}>{st.text}</i>}
                {reaction && <i>reaction</i>}
                {firstObs && <i>{v4 ? `Replied after ${touchLabel(source.data.first_reply!.touch)}` : `First observed reply · ${touchLabel(source.data.first_reply!.touch)}`}</i>}
                {latestObs && <i>Latest observed reply · {touchLabel(source.data.latest_reply!.touch)}</i>}
                {at && !email && <time dateTime={at}>{warsawHm(at)}</time>}
              </div> : at && !email ? <time className="dx-sr" dateTime={at}>{warsawHm(at)}</time> : null}
              {held && <p className="dm-held-why" role="note">{heldWhy(m)}</p>}
              {edit ? <div className="dm-rejected-actions">
                <button type="button" className="dm-email-reply dm-held-key" data-verb="held-edit-cancel" disabled={editBusy} onClick={() => setEditing(null)}>Cancel</button>
                <button type="button" className="dm-email-reply dm-held-key" data-verb="held-edit-save" disabled={editOff || !edit.text.trim()} onClick={() => void finishEdit(m, 'save')}>Save</button>
                {heldLater && canScheduleHeld(m) && <button type="button" className="dm-email-reply dm-held-key" data-verb="held-edit-later" disabled={editOff || !edit.text.trim()} onClick={() => void finishEdit(m, 'later')}>Send later</button>}
                {onSendAnyways && <button type="button" className="dm-email-reply dm-held-key" data-verb="held-edit-send" disabled={editOff || !edit.text.trim()} onClick={() => void finishEdit(m, 'send')}>Send now</button>}
              </div> : !t.spam && ((onSendAnyways && canSendRejectedDm(m)) || (discardable && onDiscardHeld) || canEdit) && <div className="dm-rejected-actions">
                {onDiscardHeld && discardable && <button type="button" className="dm-email-reply dm-discard-held" data-verb="discard-held" disabled={sending} onClick={() => onDiscardHeld(m)}>Discard</button>}
                {canEdit && <button type="button" className="dm-email-reply dm-held-key" data-verb="edit-held" disabled={sending} onClick={() => setEditing({ id: m.id, text: m.message_text ?? '' })}>Edit</button>}
                {onSendAnyways && canSendRejectedDm(m) && <button type="button" className="dm-email-reply dm-send-anyways" data-verb="send-anyways" disabled={sending} onClick={() => onSendAnyways(m)}>Send anyway</button>}
              </div>}
              {inb && email && (onReplyEmail || onForwardEmail) && <div className="dm-email-actions">
                {onReplyEmail && <button type="button" className="dm-email-reply" data-verb="reply-email" onClick={() => onReplyEmail(m)}>Reply by email</button>}
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
