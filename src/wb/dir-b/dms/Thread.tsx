import { useEffect, useRef, useState } from 'react'
import { motion, useDragControls } from 'motion/react'
import {
  Avatar, Banner, Button, Card, Chip, Composer, Divider, Header, Icon, IconButton,
  springSoft,
} from '../../../ds'
import { ContextSheet } from '../../../components/ContextSheet'
import { CopyChatLink } from '../../../components/CopyChatLink'
import { Linkified } from '../../../components/Linkified'
import { useConfirm } from '../../../components/ConfirmSheet'
import { formatReturn, returnsIn, usePushLater } from '../../../components/PushLaterSheet'
import {
  approveDraft, channelFamilies, composeReply, discardDraft, escalateDraftToClient, isDraft, isFollowUp, isMixedChannel,
  saveDraftEmail, saveDraftText, snoozeDraft, unsnoozeDraft,
  markThreadRead, messageChannel, threadChatId, NATIVE_EMAIL_SENDER,
  type InboxMessage, type MsgChannel, type Thread, eventTime, emailSenderLabel } from '../../../lib/inbox'
import { label } from '../../../lib/labels'
import { RestoreStrip } from './RestoreStrip'
import './dms.css'

// Direction B copy of src/screens/ThreadScreen.tsx (S34). Every hook in its
// original order, every write, every guard, every string.
//
// THE ONE MOVE. Only OUR words are boxed; the other party is plain left-aligned
// text (Agent Chat, serafimcloud), so whose words are whose is legible without
// reading a name. Days are dividers rather than pills, and on the phone a
// vertical drag off the header takes the thread back to the list on the soft
// spring — the same gesture, in reverse, that grew the card into it.

function clientName(id: string): string {
  if (id === 'risedtc') return 'Rise'
  if (id === 'arch') return 'Arch'
  if (id === 'ivan') return 'Ivan'
  return id.charAt(0).toUpperCase() + id.slice(1)
}

// How a leg is named to Ivan: by the pipe it rides, which is the only thing that
// distinguishes the two rows he is approving.
function legPipe(m: InboxMessage): string {
  const c = messageChannel(m)
  if (c === 'email') return 'email'
  if (c === 'inmail') return 'InMail'
  if (c === 'invite') return 'connection note'
  return 'DM'
}

function legName(m: InboxMessage): string {
  const c = messageChannel(m)
  if (c === 'email') return m.recipient_email ? `email to ${m.recipient_email}` : 'email'
  if (c === 'inmail') return 'InMail'
  if (c === 'invite') return 'connection note'
  return 'LinkedIn DM'
}

function dayLabel(iso: string): string {
  const d = new Date(iso)
  if (d.toDateString() === new Date().toDateString()) return 'TODAY'
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase()
}

// Micro-label shown above an outbound bubble. Truthful about queue/send state.
function outLabel(m: InboxMessage, stage: string): { text: string; failed: boolean } {
  if (m.send_blocked_at && m.send_blocked_reason !== 'discarded_in_inbox') {
    return { text: `Send failed: ${label(m.send_blocked_reason)}`, failed: true }
  }
  if (m.approved_at && !m.sent_at) return { text: 'Queued', failed: false }
  // manual_mirror = the human typed it in the LinkedIn app; the sync mirrored it in.
  const manual = m.ai_model === 'manual_mirror' ? ' · typed on LinkedIn' : ''
  if (m.message_type === 'connection_note') {
    return stage === 'connection_sent'
      ? { text: 'Not accepted yet', failed: false }
      : { text: `Sent${manual}`, failed: false }
  }
  return { text: `Sent${manual}`, failed: false }
}

const CHAN_TEXT: Record<MsgChannel, string> = {
  email: 'EMAIL', inmail: 'INMAIL', dm: 'DM', invite: 'INVITE',
}

function ChanChip({ chan }: { chan: MsgChannel }) {
  return <Chip tone="quiet">{CHAN_TEXT[chan]}</Chip>
}

// Header line: what surfaces this conversation is actually running on.
function channelSummary(ms: InboxMessage[]): string {
  const name = { linkedin: 'LinkedIn', inmail: 'InMail', email: 'Email' }
  const fams = channelFamilies(ms)
  if (fams.length === 0) return 'LinkedIn'
  if (fams.length === 1) return name[fams[0]]
  return fams.map(f => (f === 'email' ? 'email' : name[f])).join(' + ')
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

const PHONE_MQ = '(max-width: 767px)'

function usePhone(): boolean {
  const [on, setOn] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia(PHONE_MQ).matches)
  useEffect(() => {
    const mq = window.matchMedia(PHONE_MQ)
    const fn = (e: MediaQueryListEvent) => setOn(e.matches)
    mq.addEventListener('change', fn)
    return () => mq.removeEventListener('change', fn)
  }, [])
  return on
}

export function ThreadScreen({ thread, onBack, refresh }: {
  thread: Thread; onBack: () => void; refresh: () => void
}) {
  const draft = thread.draft
  const [edited, setEdited] = useState(draft?.message_text ?? '')
  // Collapsed by default: the composer sits BELOW the scrollable pane inside an
  // overflow:hidden shell, so anything that grows it can push Approve/Discard
  // off-screen with no way to scroll to them.
  const [showEmail, setShowEmail] = useState(false)
  const [editedEmail, setEditedEmail] = useState(draft?.email_mirror_text ?? '')
  // The other leg (Thread.companionDraft): a second pending row on a different
  // channel, staged as one intent with this one.
  const companion = thread.companionDraft
  const [editedCompanion, setEditedCompanion] = useState(companion?.message_text ?? '')
  // Answerability gate: optional escalation. Never gates Approve & send.
  const [askNote, setAskNote] = useState('')
  const [asking, setAsking] = useState(false)
  const [draftErr, setDraftErr] = useState('')
  const [reply, setReply] = useState('')
  const [composeErr, setComposeErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [showCtx, setShowCtx] = useState(false)
  const msgsRef = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const confirm = useConfirm()
  const pushLater = usePushLater()
  const phone = usePhone()
  const drag = useDragControls()

  // Re-seed the editor when the draft row changes (e.g. after a refresh).
  useEffect(() => { setEdited(draft?.message_text ?? '') }, [draft?.id])
  useEffect(() => { setEditedEmail(draft?.email_mirror_text ?? '') }, [draft?.id])
  useEffect(() => { setEditedCompanion(companion?.message_text ?? '') }, [companion?.id])

  // Grow the edit box to fit the draft (capped by max-height in CSS).
  useEffect(() => {
    const el = taRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [edited, draft?.id])

  // Sanctioned: stamps read_at on REAL inbound rows. Fire and forget.
  useEffect(() => {
    if (thread.unread > 0) markThreadRead(thread.prospect_id).catch(console.error)
  }, [thread.prospect_id, thread.unread])

  // Keep the conversation pinned to the newest message.
  useEffect(() => {
    const el = msgsRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [thread.messages.length, thread.prospect_id])

  async function onApprove() {
    if (!draft) return
    const ok = await confirm({
      title: `Send to ${thread.prospect_name}?`,
      message: companion
        ? `Both legs go out: the ${legName(draft)} and the ${legName(companion)}. `
          + 'The sender picks them up within about 2 minutes.'
        : 'The sender picks it up within about 2 minutes.',
      confirmText: companion ? 'Approve & send both' : 'Approve & send',
    })
    if (!ok) return
    setBusy(true); setDraftErr('')
    try {
      // Email first, deliberately: approveDraft stamps approved_at, and the email
      // save guards on that being null.
      if (draft.email_mirror_text != null && editedEmail !== draft.email_mirror_text) {
        await saveDraftEmail(draft.id, editedEmail)
      }
      await approveDraft(draft.id, edited, threadChatId(thread))
      // The other leg is a SEPARATE row, so it is a separate approve — and the
      // first one has already gone. A failure here is reported as the half-send
      // it is, naming the leg that is still sitting there.
      if (companion) {
        try {
          await approveDraft(
            companion.id, editedCompanion,
            messageChannel(companion) === 'email' ? null : threadChatId(thread),
          )
        } catch (e2) {
          setDraftErr(`The ${legName(draft)} is queued, but the ${legName(companion)} `
            + `did not go through: ${errText(e2)} It is still waiting here.`)
        }
      }
      refresh()
    }
    catch (e) { setDraftErr(errText(e)) }
    finally { setBusy(false) }
  }

  async function onDiscard() {
    if (!draft) return
    const ok = await confirm({
      title: companion ? 'Discard both drafts?' : 'Discard this draft?',
      message: companion
        ? `Neither the ${legName(draft)} nor the ${legName(companion)} will be sent.`
        : 'It will not be sent.',
      confirmText: 'Discard',
      danger: true,
    })
    if (!ok) return
    setBusy(true); setDraftErr('')
    try {
      // Both legs or neither. Discarding only the visible one used to leave the
      // other queued and invisible.
      if (companion) await discardDraft(companion.id).catch(() => {})
      // A FALSE IS NOT A DISCARD. The write refuses an already-approved row
      // and returns false, and this is where the operator is told so rather than
      // being shown a discard that did not happen.
      const stopped = await discardDraft(draft.id)
      if (!stopped) {
        setDraftErr('This one was already approved and is in the send queue, so the '
          + 'discard did not stop it. Nothing was changed.')
      }
      refresh()
    } catch (e) { setDraftErr(errText(e)) }
    finally { setBusy(false) }
  }

  // "Later" — any edit he has already made in the box is saved with the push.
  async function onPushLater() {
    if (!draft) return
    const until = await pushLater(thread.prospect_name)
    if (!until) return
    setBusy(true); setDraftErr('')
    try {
      if (edited !== draft.message_text) await saveDraftText(draft.id, edited)
      if (draft.email_mirror_text != null && editedEmail !== draft.email_mirror_text) {
        await saveDraftEmail(draft.id, editedEmail)
      }
      await snoozeDraft(draft.id, until)
      // The other leg travels with it.
      if (companion) {
        if (editedCompanion !== companion.message_text) await saveDraftText(companion.id, editedCompanion)
        await snoozeDraft(companion.id, until)
      }
      refresh()
    } catch (e) { setDraftErr(errText(e)) }
    finally { setBusy(false) }
  }

  async function onBringBack() {
    if (!draft) return
    setBusy(true); setDraftErr('')
    try {
      await unsnoozeDraft(draft.id)
      if (companion) await unsnoozeDraft(companion.id)
      refresh()
    }
    catch (e) { setDraftErr(errText(e)) }
    finally { setBusy(false) }
  }

  // U4: the freehand path is the one nothing has read, so it takes the same
  // sheet and the same wording as the approve path.
  async function onSend() {
    const t = reply.trim()
    if (!t || busy) return
    const ok = await confirm({
      title: `Send this to ${thread.prospect_name}?`,
      message: 'Your own words, not a reviewed draft. The sender picks it up within about 2 minutes.',
      confirmText: 'Send it',
    })
    if (!ok) return
    setBusy(true); setComposeErr('')
    try { await composeReply(thread, t); setReply(''); refresh() }
    catch (e) { setComposeErr(errText(e)) }
    finally { setBusy(false) }
  }

  // Bubbles: everything except discarded rows and unapproved drafts.
  const bubbles = thread.messages.filter(
    m => m.send_blocked_reason !== 'discarded_in_inbox' && !isDraft(m),
  )
  // Judged on what is actually ON SCREEN.
  const mixed = isMixedChannel(bubbles)

  const emailDisabled = thread.channel === 'email'
  const engagedDisabled = thread.stage === 'engaged'
  const composerNote = emailDisabled
    ? 'Email compose lands in v1.1. Approving email drafts works now.'
    : engagedDisabled
      ? 'Not connected yet. A reply here would go out as a connection invite, so compose is off for this thread.'
      : ''

  let lastDay = ''

  return (
    <motion.div
      className="dirb-th"
      drag={phone ? 'y' : false}
      dragListener={false}
      dragControls={drag}
      dragSnapToOrigin
      dragConstraints={{ top: 0, bottom: 0 }}
      dragElastic={{ top: 0, bottom: 0.4 }}
      transition={springSoft}
      onDragEnd={(_e, info) => { if (info.offset.y > 120) onBack() }}
    >
      <div onPointerDown={e => { if (phone) drag.start(e) }}>
        <Header
          lead={<IconButton icon="back" label="Back" onClick={onBack} />}
          title={
            <button type="button" className="dirb-th-name" onClick={() => setShowCtx(true)}>
              <span className="dirb-truncate">{thread.prospect_name}</span>
              <Icon name="expand" size={16} />
            </button>
          }
          sub={<>
            {thread.prospect_company ? <>{thread.prospect_company} · </> : null}
            <b>{clientName(thread.client_id)}</b> · {channelSummary(bubbles)} · {label(thread.stage)}
          </>}
          tail={<>
            {/* The hand-off. The decision that a conversation needs Mattan is
                made HERE, reading it, so the link is one tap from the message
                that prompted it. */}
            <CopyChatLink
              chatProviderId={thread.chat_provider_id}
              url={thread.linkedin_url}
              name={thread.prospect_name}
            />
            <Avatar name={thread.prospect_name} size="lg" tint={3} />
          </>}
        />
      </div>
      {showCtx && <ContextSheet thread={thread} onClose={() => setShowCtx(false)} />}

      <div className="dirb-thread" ref={msgsRef}>
        {bubbles.map(m => {
          // Label the day the message was SENT. created_at is when we stored it.
          const day = dayLabel(eventTime(m))
          const showDay = day !== lastDay
          lastDay = day
          const chan = messageChannel(m)
          if (m.direction === 'inbound') {
            return (
              <div key={m.id} style={{ display: 'contents' }}>
                {showDay && (
                  <div className="dirb-daydiv">
                    <Divider /><span className="ds-t-eyebrow dirb-dim">{day}</span><Divider />
                  </div>
                )}
                {/* Only on a mixed thread. On a pure-LinkedIn one there is
                    nothing to disambiguate. */}
                {mixed && (
                  <div className="dirb-blbl ds-t-meta dirb-dim" data-side="in">
                    <ChanChip chan={chan} />Their reply
                  </div>
                )}
                <div className="dirb-bubble ds-t-body" data-mine="false">
                  {chan === 'email' && m.prospect_email && (
                    <div className="ds-t-meta dirb-emailmeta">From {m.prospect_email}</div>
                  )}
                  <Linkified text={m.message_text} />
                </div>
              </div>
            )
          }
          const lbl = outLabel(m, thread.stage)
          return (
            <div key={m.id} style={{ display: 'contents' }}>
              {showDay && (
                <div className="dirb-daydiv">
                  <Divider /><span className="ds-t-eyebrow dirb-dim">{day}</span><Divider />
                </div>
              )}
              <div className="dirb-blbl ds-t-meta dirb-dim" data-side="out" data-failed={lbl.failed}>
                <ChanChip chan={chan} />{lbl.text}
              </div>
              {/* The dispatcher stores a multi-bubble reply as ONE row whose
                  bubbles are joined by "\n---\n", but LinkedIn delivers one
                  bubble per segment. Split + trim MUST mirror the dispatcher. */}
              {(m.message_text ?? '').split(/^[ \t]*-{3,}[ \t\r]*$/m).map(p => p.trim()).filter(Boolean).map((part, i) => (
                <div
                  key={i}
                  className={`dirb-bubble ds-t-body${m.ai_model === 'manual_mirror' ? ' dirb-bubble-manual' : ''}`}
                  data-mine="true"
                  data-ours={m.ai_model === 'manual_mirror' ? 'true' : 'false'}
                >
                  {chan === 'email' && i === 0 && m.prospect_email && (
                    <div className="ds-t-meta dirb-emailmeta">To {m.prospect_email}</div>
                  )}
                  <Linkified text={part} />
                </div>
              ))}
            </div>
          )
        })}
      </div>

      {/* A draft that was thrown away had no surface anywhere. The strip is the
          only place it is readable, and the only place a restore is offered. */}
      <RestoreStrip thread={thread} refresh={refresh} />

      {draft && (
        <Card
          className="dirb-th-card"
          lead={<Icon name="wand" size={20} />}
          title={
            <>
              {thread.draftSnoozedUntil !== null ? `Pushed to ${formatReturn(thread.draftSnoozedUntil)}`
                : thread.draftStale ? 'AI draft · you already replied'
                  : isFollowUp(draft) ? 'AI follow-up · waiting on you'
                    : 'AI draft · waiting on you'}
              {/* The pair is announced HERE, not only at the second box. */}
              {companion && (
                <span className="dirb-dim">
                  {' '}· 2 messages: {legPipe(draft)} + {legPipe(companion)}
                </span>
              )}
            </>
          }
          foot={
            <div className="dirb-acts">
              <Button variant="quiet" size="sm" disabled={busy} onClick={busy ? undefined : onDiscard}>Discard</Button>
              {thread.draftSnoozedUntil === null && (
                <Button variant="quiet" size="sm" disabled={busy} onClick={busy ? undefined : onPushLater}>Later</Button>
              )}
              <span className="dirb-acts-end">
                <Button variant="primary" size="sm" disabled={busy} onClick={busy ? undefined : onApprove}>
                  {companion ? 'Send both' : 'Approve & send'}
                </Button>
              </span>
            </div>
          }
        >
          {/* Everything between the header and the action bar scrolls INSIDE the
              card, capped so the conversation it is answering stays on screen. */}
          <div className="dirb-th-scroll">
            {thread.draftSnoozedUntil !== null && (
              <Banner
                tone="neutral"
                icon="timer"
                action={<Button variant="quiet" size="sm" disabled={busy} onClick={onBringBack}>Bring back now</Button>}
              >
                Out of your queue until then, {returnsIn(thread.draftSnoozedUntil)}. It comes
                back sooner if {thread.prospect_name.split(' ')[0]} writes.
              </Banner>
            )}
            {thread.draftStale && (
              <div className="ds-t-meta dirb-warn">
                Your own reply went out after their last message — this draft is probably not needed.
              </div>
            )}
            {/* An email draft carries its recipient on its face. */}
            {messageChannel(draft) === 'email' && draft.recipient_email && (
              <div className="ds-t-meta dirb-dim">
                Email to {draft.recipient_email} (from {NATIVE_EMAIL_SENDER})
              </div>
            )}
            <textarea
              ref={taRef}
              className="ds-textarea dirb-draftbox"
              aria-label="Draft"
              value={edited}
              onChange={e => setEdited(e.target.value)}
              disabled={busy}
            />
            {draft.context_gap && (
              <div className="dirb-inset dirb-col">
                <div className="ds-t-body">
                  This answers something our RISE notes do not cover
                  {draft.context_gap.why ? `: ${draft.context_gap.why}` : '.'}
                </div>
                {draft.context_gap.question && (
                  <div className="ds-t-body dirb-quiet">For Mattan: {draft.context_gap.question}</div>
                )}
                <div className="dirb-acts">
                  <Button
                    variant="quiet"
                    size="sm"
                    iconEnd={askNote ? 'check' : undefined}
                    onClick={asking || askNote ? undefined : () => {
                      setAsking(true); setAskNote('')
                      escalateDraftToClient(draft.id)
                        .then(n => setAskNote(n))
                        .catch(e => setAskNote(e?.message || 'Could not queue that.'))
                        .finally(() => setAsking(false))
                    }}
                  >{askNote ? 'Asked' : asking ? 'Queueing…' : 'Ask Mattan'}</Button>
                  {draft.context_gap.chat_url && (
                    <a
                      className="ds-t-meta"
                      href={draft.context_gap.chat_url}
                      target="_blank"
                      rel="noreferrer"
                    >open the conversation</a>
                  )}
                  <span className="ds-t-meta dirb-dim">Optional. You can send this draft as it is.</span>
                </div>
                {askNote && <div className="ds-t-meta dirb-dim">{askNote}</div>}
              </div>
            )}
            {draft.draft_evidence && (
              <details className="dirb-dev">
                <summary className="ds-t-meta">Where this came from</summary>
                <div className="dirb-col">
                  {draft.draft_evidence.learned && draft.draft_evidence.learned.length > 0 && (
                    <div className="dirb-col">
                      <span className="ds-t-eyebrow dirb-dim">Learned from Mattan</span>
                      {draft.draft_evidence.learned.map(f => (
                        <div key={f.id} className="dirb-devrow">
                          <span className="ds-t-body">{f.fact}</span>
                          <span className="ds-t-meta dirb-dim">his own DM{f.from ? ` to ${f.from}` : ''}, {(f.at || '').slice(0, 10)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {draft.draft_evidence.facts && (
                    <div className="dirb-col">
                      <span className="ds-t-eyebrow dirb-dim">RISE notes</span>
                      <div className="dirb-devrow">
                        <span className="ds-t-body">{draft.draft_evidence.facts.slug}</span>
                        <span className="ds-t-meta dirb-dim">v{draft.draft_evidence.facts.version ?? '?'}</span>
                      </div>
                    </div>
                  )}
                  {(draft.draft_evidence.store_fact || draft.draft_evidence.anchor || draft.draft_evidence.scan_finding) && (
                    <div className="dirb-col">
                      <span className="ds-t-eyebrow dirb-dim">Grounding</span>
                      {draft.draft_evidence.store_fact && <div className="dirb-devrow"><span className="ds-t-body">{draft.draft_evidence.store_fact}</span><span className="ds-t-meta dirb-dim">their store</span></div>}
                      {draft.draft_evidence.anchor && <div className="dirb-devrow"><span className="ds-t-body">{draft.draft_evidence.anchor}</span><span className="ds-t-meta dirb-dim">anchor client</span></div>}
                      {draft.draft_evidence.scan_finding && <div className="dirb-devrow"><span className="ds-t-body">{draft.draft_evidence.scan_finding}</span><span className="ds-t-meta dirb-dim">their scan</span></div>}
                    </div>
                  )}
                  {draft.draft_evidence.exemplars && draft.draft_evidence.exemplars.length > 0 && (
                    <div className="dirb-col">
                      <span className="ds-t-eyebrow dirb-dim">Voice copied from</span>
                      {draft.draft_evidence.exemplars.slice(0, 3).map((x, i) => (
                        <div key={i} className="dirb-devrow">
                          <span className="ds-t-body">{x.reply}</span>
                          <span className="ds-t-meta dirb-dim">to {x.prospect || 'a lead'}, {(x.at || '').slice(0, 10)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </details>
            )}
            {/* The other leg, in full, editable. Not a preview: this is a real
                pending row and the buttons below send it. */}
            {companion && (
              <div className="dirb-inset dirb-col">
                <div className="ds-t-meta dirb-dim">
                  {messageChannel(companion) === 'email' ? 'Email' : 'LinkedIn DM'} · also goes out
                  {messageChannel(companion) === 'email' && companion.recipient_email
                    ? ` to ${companion.recipient_email} (from ${NATIVE_EMAIL_SENDER})`
                    : ''}
                </div>
                <textarea
                  className="ds-textarea dirb-draftbox"
                  aria-label="The other leg"
                  value={editedCompanion}
                  onChange={e => setEditedCompanion(e.target.value)}
                  disabled={busy}
                />
              </div>
            )}
            {/* Only on a row that is NOT itself the email. */}
            {draft.recipient_email && messageChannel(draft) !== 'email' && (
              <div className="dirb-inset dirb-col">
                <div className="ds-t-meta dirb-dim">
                  Approving also sends this email to {draft.recipient_email}{emailSenderLabel(thread.client_id)}
                  {draft.email_mirror_text && (
                    <Button variant="quiet" size="sm" onClick={() => setShowEmail(v => !v)}>
                      {showEmail ? 'Hide email' : 'Show email'}
                    </Button>
                  )}
                </div>
                {showEmail && draft.email_mirror_text && (
                  <textarea
                    className="ds-textarea dirb-draftbox"
                    aria-label="The email that goes with it"
                    value={editedEmail}
                    onChange={e => setEditedEmail(e.target.value)}
                    disabled={busy}
                  />
                )}
              </div>
            )}
          </div>
          {draftErr && <Banner tone="urgent" icon="alert">{draftErr}</Banner>}
        </Card>
      )}

      <div className="dirb-foot">
        {composerNote ? (
          <div className="ds-t-meta dirb-dim">{composerNote}</div>
        ) : (
          <Composer
            value={reply}
            onChange={setReply}
            onSend={onSend}
            placeholder="Write your own reply…"
            mode={busy ? 'empty' : reply.trim() ? 'ready' : 'empty'}
          />
        )}
        {composeErr && <div className="ds-t-meta dirb-err">{composeErr}</div>}
      </div>
    </motion.div>
  )
}
