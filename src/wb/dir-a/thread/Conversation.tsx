/* ==========================================================================
   src/wb/dir-a/thread/Conversation.tsx — S14 / S34, Direction A.

   Rebuilt from src/exp/v2c/ThreadPeer.tsx (the ladder and the pane head) and
   src/screens/ThreadScreen.tsx (the conversation itself). Every write, every
   confirm sheet, the half-send report, the both-legs-or-neither discard, the
   edit-then-push save order, the read stamp, the pin-to-newest scroll, the
   textarea auto-grow, the dispatcher-mirroring bubble split and every string are
   the ones that were there.

   What changed is the view:
     · the pane head and the thread's own nav are ONE compact sticky head, so the
       name, the avatar and the close are said once instead of twice,
     · the stage ladder is the system's Stepper (done / current / todo),
     · THE OTHER PARTY IS NOT BOXED. Their words sit on the canvas; only what we
       drafted or sent carries a box, because the box is what marks our own turn,
     · every message carries a mono time, and a day is a DayHeader.
   ========================================================================== */
import { useEffect, useRef, useState } from 'react'
import { Banner, Button, Chip, Composer, DayHeader, Icon, IconButton, Stepper, Textarea } from '../../../ds'
import { Bar, Body, Group, Head, Screen } from '../kit'
import { ChatLink, Face } from '../dms/parts'
import { RestoreStrip } from './RestoreStrip'
import { ContextSheet } from '../../../components/ContextSheet'
import { Linkified } from '../../../components/Linkified'
import { useConfirm } from '../../../components/ConfirmSheet'
import { formatReturn, returnsIn, usePushLater } from '../../../components/PushLaterSheet'
import {
  approveDraft, channelFamilies, composeReply, discardDraft, escalateDraftToClient, isDraft, isFollowUp, isMixedChannel,
  saveDraftEmail, saveDraftText, snoozeDraft, unsnoozeDraft,
  markThreadRead, messageChannel, threadChatId, NATIVE_EMAIL_SENDER,
  type InboxMessage, type MsgChannel, type Thread, eventTime, emailSenderLabel } from '../../../lib/inbox'
import { label } from '../../../lib/labels'
import { STAGE_LADDER, stageIsOff, stageStep } from '../../../exp/v2c/stage'
import './thread.css'

function clientName(id: string): string {
  if (id === 'risedtc') return 'Rise'
  if (id === 'arch') return 'Arch'
  if (id === 'ivan') return 'Ivan'
  return id.charAt(0).toUpperCase() + id.slice(1)
}

// How a leg is named to Ivan: by the pipe it rides, which is the only thing that
// distinguishes the two rows he is approving. legPipe is the header form (the
// address is already on the card); legName carries it for the confirm sheets,
// where the sheet is the last thing he reads before both messages go out.
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

/** The clock on a message. A time, in mono, on every one of them. */
function clockTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

// Micro-label shown above an outbound message. Truthful about queue/send state.
// The channel it rode is carried by the chip beside it, not by this text.
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

/* A channel is a category, and a category is never a colour: the chip says which
   pipe it rode, in words, at the one chip size the system has. */
function ChanChip({ chan }: { chan: MsgChannel }) {
  return <Chip>{CHAN_TEXT[chan]}</Chip>
}

// Header line: what surfaces this conversation is actually running on.
// threadKind collapses to 'email' the moment ONE email exists, which read as
// "Email" on a thread that is 6 LinkedIn messages and 1 email.
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

/* THE LADDER, as the system's Stepper. It is the one fact the thread's own
   header cannot express: that header prints the stage string, which says nothing
   about what came before or what comes next. An unknown stage still prints its
   label rather than a guessed position, and an off-pipeline stage says so. */
function Ladder({ stage }: { stage: string }) {
  const step = stageStep(stage)
  const off = stageIsOff(stage)
  if (off) {
    return (
      <span className="a-wrapline" title={`Stage: ${label(stage)}`}>
        <Icon name="blocked" size={16} />
        <span className="a-meta">Archived</span>
      </span>
    )
  }
  if (step === null) {
    // A stage this file has not seen. Say so rather than draw a guess, and say
    // it in words, not the raw column.
    return <span className="a-meta a-dim">{stage ? label(stage) : 'no stage'}</span>
  }
  return (
    <span className="a-thread-ladder" title={`Stage: ${label(stage)}`}>
      <Stepper
        label="Stage"
        steps={STAGE_LADDER.map((l, i) => ({
          id: l,
          label: l,
          state: i < step ? 'done' as const : i === step ? 'current' as const : 'todo' as const,
        }))}
      />
    </span>
  )
}

export function Conversation({ thread, refresh, onBack, onClose, onAsk, mobile }: {
  thread: Thread
  refresh: () => void
  onBack: () => void
  onClose: () => void
  onAsk: () => void
  mobile: boolean
}) {
  const draft = thread.draft
  const [edited, setEdited] = useState(draft?.message_text ?? '')
  // Collapsed by default: the composer sits BELOW the scrollable message pane
  // inside an overflow:hidden shell, so anything that grows it can push
  // Approve/Discard off-screen with no way to scroll to them.
  const [showEmail, setShowEmail] = useState(false)
  const [editedEmail, setEditedEmail] = useState(draft?.email_mirror_text ?? '')
  // The other leg (Thread.companionDraft): a second pending row on a different
  // channel, staged as one intent with this one. Its own box, its own edits, and
  // it rides EVERY decision below — a DM promising an email must not be sendable
  // without the email that backs it, and vice versa.
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
  const editRef = useRef<HTMLDivElement>(null)
  const confirm = useConfirm()
  const pushLater = usePushLater()

  // Re-seed the editor when the draft row changes (e.g. after a refresh).
  useEffect(() => { setEdited(draft?.message_text ?? '') }, [draft?.id])
  useEffect(() => { setEditedEmail(draft?.email_mirror_text ?? '') }, [draft?.id])
  useEffect(() => { setEditedCompanion(companion?.message_text ?? '') }, [companion?.id])

  // Grow the edit box to fit the draft (capped by max-height in CSS) so long
  // drafts are readable and editable without a tiny scroll window.
  useEffect(() => {
    const el = editRef.current?.querySelector('textarea')
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
      // save guards on that being null. Saving after would silently no-op and send
      // the pre-edit copy to their inbox.
      if (draft.email_mirror_text != null && editedEmail !== draft.email_mirror_text) {
        await saveDraftEmail(draft.id, editedEmail)
      }
      await approveDraft(draft.id, edited, threadChatId(thread))
      // The other leg is a SEPARATE row, so it is a separate approve — and the
      // first one has already gone. A failure here is reported as the half-send it
      // is, naming the leg that is still sitting there, rather than as "approve
      // failed" over a message that is already queued.
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
      // other queued and invisible — the exact failure this pairing exists to end.
      if (companion) await discardDraft(companion.id).catch(() => {})
      // A FALSE IS NOT A DISCARD. Discarding an already-approved row wrote two
      // columns the dispatcher does not read, the row left the inbox, and the
      // message still went out on the next two-minute tick. The write now refuses
      // that row and returns false, and this is where the operator is told so
      // rather than being shown a discard that did not happen.
      const stopped = await discardDraft(draft.id)
      if (!stopped) {
        setDraftErr('This one was already approved and is in the send queue, so the '
          + 'discard did not stop it. Nothing was changed.')
      }
      refresh()
    } catch (e) { setDraftErr(errText(e)) }
    finally { setBusy(false) }
  }

  // "Later" — the decision that was missing between the two terminal ones. Any
  // edit he has already made in the box is saved with the push: he often fixes
  // the copy first and only then decides the timing is wrong, and losing that
  // work would teach him to discard instead.
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
      // The other leg travels with it — a push that parked only half of a pair
      // would leave the rest sendable on its own.
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

  // Approving a REVIEWED draft asked for confirmation while typing a fresh
  // message and sending it asked for none, which is backwards — the freehand path
  // is the one nothing has read. Same sheet, same wording as the approve path, so
  // the two consequential actions on this screen behave the same way.
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

  // Messages: everything except discarded rows and unapproved drafts (drafts
  // live in the card).
  const bubbles = thread.messages.filter(
    m => m.send_blocked_reason !== 'discarded_in_inbox' && !isDraft(m),
  )
  // Judged on what is actually ON SCREEN — a pending email draft sitting in the
  // card below has not happened yet and must not relabel the conversation.
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
    <Screen className="a-thread">
      {/* ONE head. The name opens the context sheet, which is a real affordance
          and not chrome; the ladder, the draft marker, Ask Claude and the close
          are what the pane owns. */}
      <Head
        lead={<>
          <IconButton icon="back" label="Back" onClick={onBack} />
          <Face name={thread.prospect_name} />
        </>}
        title={
          <button type="button" className="a-plain a-thread-who" onClick={() => setShowCtx(true)}>
            <span className="a-nowrap">{thread.prospect_name}</span>
            <Icon name="person" size={16} label="Open the context for this person" />
          </button>
        }
        sub={<>
          {thread.prospect_company ? <>{thread.prospect_company} · </> : null}
          <b>{clientName(thread.client_id)}</b> · {channelSummary(bubbles)} · {label(thread.stage)}
        </>}
        tail={<>
          {thread.draft && <Chip icon="wand">DRAFT</Chip>}
          {/* The hand-off. The decision that a conversation needs Mattan is made
              HERE, reading it, so the link is one tap from the message that
              prompted it. */}
          <ChatLink
            chatProviderId={thread.chat_provider_id}
            url={thread.linkedin_url}
            name={thread.prospect_name}
          />
          <Button variant="quiet" icon="ask" onClick={onAsk}>Ask Claude</Button>
          {!mobile && <IconButton icon="close" label="Close" onClick={onClose} />}
        </>}
      />
      <Bar>
        <Ladder stage={thread.stage} />
      </Bar>
      {showCtx && <ContextSheet thread={thread} onClose={() => setShowCtx(false)} />}

      <Body className="a-thread-msgs" innerRef={msgsRef}>
        {bubbles.map(m => {
          // Label the day the message was SENT. created_at is when we stored it,
          // so a reply backfilled the next morning was filed under TODAY despite
          // being written the day before.
          const day = dayLabel(eventTime(m))
          const showDay = day !== lastDay
          lastDay = day
          const chan = messageChannel(m)
          const at = clockTime(eventTime(m))
          if (m.direction === 'inbound') {
            return (
              <div key={m.id} className="a-thread-turn" data-side="in">
                {showDay && <DayHeader label={day} />}
                <div className="a-thread-lbl">
                  {/* The channel chip only on a mixed thread. On a pure-LinkedIn
                      one there is nothing to disambiguate and a label over every
                      inbound message is noise. */}
                  {mixed && <><ChanChip chan={chan} /><span>Their reply</span></>}
                  <span className="a-mono">{at}</span>
                </div>
                {/* NOT BOXED. Their words are the page; ours are the reply. */}
                <div className="a-thread-said">
                  {chan === 'email' && m.prospect_email && (
                    <div className="a-meta">From {m.prospect_email}</div>
                  )}
                  <span className="a-pre"><Linkified text={m.message_text} /></span>
                </div>
              </div>
            )
          }
          const lbl = outLabel(m, thread.stage)
          return (
            <div key={m.id} className="a-thread-turn" data-side="out">
              {showDay && <DayHeader label={day} />}
              <div className="a-thread-lbl" data-right="">
                <ChanChip chan={chan} />
                <span className={lbl.failed ? 'a-sev-urgent' : undefined}>{lbl.text}</span>
                <span className="a-mono">{at}</span>
              </div>
              {/* A reply Ivan or Mattan typed in the LinkedIn app carries a
                  different weight from one the engine sent, so it is MARKED and
                  not merely footnoted. It is also the only evidence the mirror
                  leaves of a hand-sent message. */}
              {/* The dispatcher stores a multi-bubble reply as ONE row whose parts
                  are joined by a delimiter line, but LinkedIn delivers one bubble
                  per segment. Render it the way the recipient actually saw it.
                  Split + trim MUST mirror the dispatcher: it splits on a
                  delimiter-only LINE and trims each part, so a draft written with
                  blank lines around the delimiter still sends clean. */}
              {(m.message_text ?? '').split(/^[ \t]*-{3,}[ \t\r]*$/m).map(p => p.trim()).filter(Boolean).map((part, i) => (
                <div
                  key={i}
                  className="a-thread-box"
                  data-manual={m.ai_model === 'manual_mirror' ? '' : undefined}
                >
                  {/* An email carries its recipient on its face. The DM above it
                      went to a LinkedIn chat, this one went to an address, and
                      that is the whole difference the operator is trying to see. */}
                  {chan === 'email' && i === 0 && m.prospect_email && (
                    <div className="a-meta">To {m.prospect_email}</div>
                  )}
                  <span className="a-pre"><Linkified text={part} /></span>
                </div>
              ))}
            </div>
          )
        })}
      </Body>

      {/* A draft that was thrown away had no surface anywhere: the bubble filter
          above drops this reason by name and the failed-send log excludes it too.
          The strip is the only place it is readable, and the only place a restore
          is offered. */}
      <RestoreStrip thread={thread} refresh={refresh} />

      {draft && (
        <div className="a-thread-draft">
          <Group
            label={<>
              {thread.draftSnoozedUntil !== null ? `Pushed to ${formatReturn(thread.draftSnoozedUntil)}`
                : thread.draftStale ? 'AI draft · you already replied'
                  : isFollowUp(draft) ? 'AI follow-up · waiting on you'
                    : 'AI draft · waiting on you'}
              {/* The pair is announced HERE, not only at the second box: that box
                  sits below the fold of a card capped at half the pane, so without
                  this the other leg is a scroll away from being noticed at all. */}
              {companion && <>{' '}· 2 messages: {legPipe(draft)} + {legPipe(companion)}</>}
            </>}
            foot={
              /* Three decisions, and Later sits between the two terminal ones on
                 purpose: it is the middle answer, not a secondary discard. The
                 loud button is the one that puts a message in front of a person. */
              <div className="a-thread-acts">
                <Button variant="quiet" onClick={busy ? undefined : onDiscard}>Discard</Button>
                {thread.draftSnoozedUntil === null && (
                  <Button variant="quiet" onClick={busy ? undefined : onPushLater}>Later</Button>
                )}
                <span className="a-grow" />
                <Button variant="primary" icon="send" busy={busy} onClick={busy ? undefined : onApprove}>
                  {companion ? 'Send both' : 'Approve & send'}
                </Button>
              </div>
            }
          >
            {/* Everything between the header and the action bar scrolls INSIDE the
                card. The card itself is capped at half the pane so the
                conversation it is answering stays on screen. */}
            <div className="a-thread-dscroll">
              {thread.draftSnoozedUntil !== null && (
                <Banner
                  icon="time"
                  title={`Out of your queue until then, ${returnsIn(thread.draftSnoozedUntil)}. It comes `
                    + `back sooner if ${thread.prospect_name.split(' ')[0]} writes.`}
                  action={
                    <Button variant="quiet" disabled={busy} onClick={onBringBack}>Bring back now</Button>
                  }
                />
              )}
              {thread.draftStale && (
                <Banner tone="attention" icon="alert">
                  Your own reply went out after their last message — this draft is probably not needed.
                </Banner>
              )}
              {/* An email draft carries its recipient on its face, same as a sent
                  email does. Without it the card looks like a DM whose body
                  happens to start with "Subject:". */}
              {messageChannel(draft) === 'email' && draft.recipient_email && (
                <div className="a-meta">
                  Email to {draft.recipient_email} (from {NATIVE_EMAIL_SENDER})
                </div>
              )}
              <div ref={editRef} className="a-thread-editbox">
                <Textarea
                  label="The draft"
                  labelHidden
                  className="a-thread-edit"
                  value={edited}
                  onChange={e => setEdited(e.target.value)}
                  disabled={busy}
                />
              </div>
              {draft.context_gap && (
                <Banner
                  tone="attention"
                  icon="alert"
                  title={`This answers something our RISE notes do not cover${draft.context_gap.why ? `: ${draft.context_gap.why}` : '.'}`}
                >
                  <span className="a-stack" data-tight>
                    {draft.context_gap.question && (
                      <span>For Mattan: {draft.context_gap.question}</span>
                    )}
                    <span className="a-wrapline">
                      <Button
                        variant="quiet"
                        size="sm"
                        busy={asking}
                        onClick={asking || askNote ? undefined : () => {
                          setAsking(true); setAskNote('')
                          escalateDraftToClient(draft.id)
                            .then(n => setAskNote(n))
                            .catch(e => setAskNote(e?.message || 'Could not queue that.'))
                            .finally(() => setAsking(false))
                        }}
                        icon={askNote ? 'check' : undefined}
                      >{askNote ? 'Asked' : asking ? 'Queueing…' : 'Ask Mattan'}</Button>
                      {draft.context_gap.chat_url && (
                        <a className="a-link" href={draft.context_gap.chat_url} target="_blank" rel="noreferrer">
                          open the conversation
                        </a>
                      )}
                      <span className="a-meta">Optional. You can send this draft as it is.</span>
                    </span>
                    {askNote && <span className="a-meta">{askNote}</span>}
                  </span>
                </Banner>
              )}
              {draft.draft_evidence && (
                <details className="a-thread-dev">
                  <summary className="a-thread-devs">Where this came from</summary>
                  <div className="a-stack" data-tight>
                    {draft.draft_evidence.learned && draft.draft_evidence.learned.length > 0 && (
                      <div className="a-thread-devg">
                        <span className="a-eyebrow">Learned from Mattan</span>
                        {draft.draft_evidence.learned.map(f => (
                          <div key={f.id} className="a-thread-devr">
                            <span>{f.fact}</span>
                            <span className="a-mono a-dim">his own DM{f.from ? ` to ${f.from}` : ''}, {(f.at || '').slice(0, 10)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {draft.draft_evidence.facts && (
                      <div className="a-thread-devg">
                        <span className="a-eyebrow">RISE notes</span>
                        <div className="a-thread-devr">
                          <span>{draft.draft_evidence.facts.slug}</span>
                          <span className="a-mono a-dim">v{draft.draft_evidence.facts.version ?? '?'}</span>
                        </div>
                      </div>
                    )}
                    {(draft.draft_evidence.store_fact || draft.draft_evidence.anchor || draft.draft_evidence.scan_finding) && (
                      <div className="a-thread-devg">
                        <span className="a-eyebrow">Grounding</span>
                        {draft.draft_evidence.store_fact && <div className="a-thread-devr"><span>{draft.draft_evidence.store_fact}</span><span className="a-mono a-dim">their store</span></div>}
                        {draft.draft_evidence.anchor && <div className="a-thread-devr"><span>{draft.draft_evidence.anchor}</span><span className="a-mono a-dim">anchor client</span></div>}
                        {draft.draft_evidence.scan_finding && <div className="a-thread-devr"><span>{draft.draft_evidence.scan_finding}</span><span className="a-mono a-dim">their scan</span></div>}
                      </div>
                    )}
                    {draft.draft_evidence.exemplars && draft.draft_evidence.exemplars.length > 0 && (
                      <div className="a-thread-devg">
                        <span className="a-eyebrow">Voice copied from</span>
                        {draft.draft_evidence.exemplars.slice(0, 3).map((x, i) => (
                          <div key={i} className="a-thread-devr">
                            <span>{x.reply}</span>
                            <span className="a-mono a-dim">to {x.prospect || 'a lead'}, {(x.at || '').slice(0, 10)}</span>
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
                <Textarea
                  label={`${messageChannel(companion) === 'email' ? 'Email' : 'LinkedIn DM'} · also goes out`
                    // The sender is only named on a native email row: that is the
                    // one whose pipe is the Gmail node. A LinkedIn row stamped
                    // with an address is the mirror, which the badge below names.
                    + (messageChannel(companion) === 'email' && companion.recipient_email
                      ? ` to ${companion.recipient_email} (from ${NATIVE_EMAIL_SENDER})`
                      : '')}
                  className="a-thread-leg"
                  value={editedCompanion}
                  onChange={e => setEditedCompanion(e.target.value)}
                  disabled={busy}
                />
              )}
              {/* Only on a row that is NOT itself the email. On an email draft the
                  body above IS what gets mailed, and "approving ALSO emails..."
                  read as a second, invisible send. */}
              {draft.recipient_email && messageChannel(draft) !== 'email' && (
                <div className="a-stack" data-tight>
                  <span className="a-meta">
                    Approving also sends this email to {draft.recipient_email}{emailSenderLabel(thread.client_id)}
                    {draft.email_mirror_text && (
                      <Button variant="quiet" size="sm" onClick={() => setShowEmail(v => !v)}>
                        {showEmail ? 'Hide email' : 'Show email'}
                      </Button>
                    )}
                  </span>
                  {showEmail && draft.email_mirror_text && (
                    <Textarea
                      label="The email that goes with it"
                      labelHidden
                      className="a-thread-leg"
                      value={editedEmail}
                      onChange={e => setEditedEmail(e.target.value)}
                      disabled={busy}
                    />
                  )}
                </div>
              )}
              {draftErr && <Banner tone="urgent" icon="error">{draftErr}</Banner>}
            </div>
          </Group>
        </div>
      )}

      {composerNote ? (
        <div className="a-thread-composer">
          <Banner icon="blocked">{composerNote}</Banner>
        </div>
      ) : (
        <div className="a-thread-composer">
          <Composer
            value={reply}
            onChange={setReply}
            onSend={onSend}
            placeholder="Write your own reply…"
            mode={reply.trim() ? 'ready' : 'empty'}
          />
        </div>
      )}
      {composeErr && (
        <div className="a-thread-composer">
          <Banner tone="urgent" icon="error">{composeErr}</Banner>
        </div>
      )}
    </Screen>
  )
}
