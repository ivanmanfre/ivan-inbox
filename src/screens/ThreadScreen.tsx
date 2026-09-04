import { useEffect, useRef, useState } from 'react'
import { Avatar } from '../components/Avatar'
import { ContextSheet } from '../components/ContextSheet'
import { CopyChatLink } from '../components/CopyChatLink'
import { Linkified } from '../components/Linkified'
import { useConfirm } from '../components/ConfirmSheet'
import { formatReturn, returnsIn, usePushLater } from '../components/PushLaterSheet'
import {
  approveDraft, channelFamilies, composeReply, discardDraft, escalateDraftToClient, isDraft, isFollowUp, isMixedChannel,
  saveDraftEmail, saveDraftText, snoozeDraft, unsnoozeDraft,
  markThreadRead, messageChannel, threadChatId, NATIVE_EMAIL_SENDER,
  type InboxMessage, type MsgChannel, type Thread, eventTime, emailSenderLabel } from '../lib/inbox'
import { label } from '../lib/labels'
import { RestoreStrip } from '../exp/v2c/RestoreStrip'

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

// Micro-label shown above an outbound bubble. Truthful about queue/send state.
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
// invite rides the DM paint: it is the same LinkedIn surface, and giving it a
// fourth colour would spend the channel palette on a distinction nobody scans by.
const CHAN_CLASS: Record<MsgChannel, string> = {
  email: 'chan-email', inmail: 'chan-inmail', dm: 'chan-dm', invite: 'chan-dm',
}

function ChanChip({ chan }: { chan: MsgChannel }) {
  return <span className={`chanchip ${CHAN_CLASS[chan]}`}>{CHAN_TEXT[chan]}</span>
}

// Header line: what surfaces this conversation is actually running on. threadKind
// collapses to 'email' the moment ONE email exists, which read as "Email" on a
// thread that is 6 LinkedIn messages and 1 email (George Gazzard, 2026-08-19).
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

export function ThreadScreen({ thread, onBack, refresh }: {
  thread: Thread; onBack: () => void; refresh: () => void
}) {
  const draft = thread.draft
  const [edited, setEdited] = useState(draft?.message_text ?? '')
  // Collapsed by default: the composer sits BELOW the scrollable .msgs pane inside an
  // overflow:hidden shell, so anything that grows it can push Approve/Discard off-screen
  // with no way to scroll to them (broke live 2026-08-07, first email-preview version).
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
  const taRef = useRef<HTMLTextAreaElement>(null)
  const confirm = useConfirm()
  const pushLater = usePushLater()

  // Re-seed the editor when the draft row changes (e.g. after a refresh).
  useEffect(() => { setEdited(draft?.message_text ?? '') }, [draft?.id])
  useEffect(() => { setEditedEmail(draft?.email_mirror_text ?? '') }, [draft?.id])
  useEffect(() => { setEditedCompanion(companion?.message_text ?? '') }, [companion?.id])

  // Grow the edit box to fit the draft (capped by max-height in CSS) so long
  // drafts are readable and editable without a tiny scroll window.
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
      // 🔴 A FALSE IS NOT A DISCARD. Phase 4a added `approved_at IS NULL` to the
      // guard, which closed a fail-open: discarding an already-approved row wrote
      // two columns the dispatcher does not read, the row left the inbox, and the
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

  // "Later" — the decision that was missing between the two terminal ones
  // (Ivan, 2026-08-20). Any edit he has already made in the box is saved with
  // the push: he often fixes the copy first and only then decides the timing is
  // wrong, and losing that work would teach him to discard instead.
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

  // U4: approving a REVIEWED draft asked for confirmation while typing a fresh
  // message and hitting ↑ sent it with none, which is backwards — the freehand
  // path is the one nothing has read. Same sheet, same wording as the approve
  // path, so the two consequential actions on this screen behave the same way.
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

  // Bubbles: everything except discarded rows and unapproved drafts (drafts live in the card).
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
    <>
      <div className="t-nav">
        <span className="back" onClick={onBack}>‹</span>
        <div className="who tap" onClick={() => setShowCtx(true)}>
          <div className="n">{thread.prospect_name} <span className="ctx-i">ⓘ</span></div>
          <div className="m">
            {thread.prospect_company ? <>{thread.prospect_company} · </> : null}
            <b>{clientName(thread.client_id)}</b> · {channelSummary(bubbles)} · {label(thread.stage)}
          </div>
        </div>
        {/* The hand-off. The decision that a conversation needs Mattan is made HERE,
            reading it, so the link is one tap from the message that prompted it. */}
        <CopyChatLink
          chatProviderId={thread.chat_provider_id}
          url={thread.linkedin_url}
          name={thread.prospect_name}
        />
        <Avatar name={thread.prospect_name} channel={thread.channel} size={36} />
      </div>
      {showCtx && <ContextSheet thread={thread} onClose={() => setShowCtx(false)} />}

      <div className="msgs" ref={msgsRef}>
        {bubbles.map(m => {
          // Label the day the message was SENT. created_at is when we stored it, so a
          // reply backfilled the next morning was filed under TODAY despite being written
          // the day before (Ronnie Teja, 2026-07-30).
          const label = dayLabel(eventTime(m))
          const showDay = label !== lastDay
          lastDay = label
          const chan = messageChannel(m)
          if (m.direction === 'inbound') {
            return (
              <div key={m.id} style={{ display: 'contents' }}>
                {showDay && <div className="day">{label}</div>}
                {/* Only on a mixed thread. On a pure-LinkedIn one there is nothing
                    to disambiguate and a label over every inbound bubble is noise. */}
                {mixed && (
                  <div className="blbl blbl-l"><ChanChip chan={chan} />Their reply</div>
                )}
                <div className={`b in chan-b-${chan}`}>
                  {chan === 'email' && m.prospect_email && (
                    <div className="b-emailmeta">From {m.prospect_email}</div>
                  )}
                  <Linkified text={m.message_text} />
                </div>
              </div>
            )
          }
          const lbl = outLabel(m, thread.stage)
          return (
            <div key={m.id} style={{ display: 'contents' }}>
              {showDay && <div className="day">{label}</div>}
              <div className="blbl blbl-r" style={lbl.failed ? { color: '#FF453A' } : undefined}>
                <ChanChip chan={chan} />{lbl.text}
              </div>
              {/* A reply Ivan or Mattan typed in the LinkedIn app carries a
                  different weight from one the engine sent, so it is MARKED and
                  not merely footnoted (2026-08-03: "manual replies from linkedin
                  are also highlighted on the chat view"). It is also the only
                  evidence the mirror leaves of a hand-sent message. */}
              {/* The dispatcher stores a multi-bubble reply as ONE row whose bubbles are
                  joined by "\n---\n", but LinkedIn delivers one bubble per segment. Render
                  it the way the recipient actually saw it; otherwise the separator shows up
                  as a literal "---" line in the thread (Chas Waters, 2026-08-05). */}
              {/* Split + trim MUST mirror the dispatcher (Outreach - Send Messages):
                  it splits on a delimiter-only LINE and trims each bubble, so a
                  draft written as "\n\n---\n\n" still sends clean. Splitting on
                  the literal '\n---\n' left the extra newline on the next bubble
                  and rendered a phantom blank line above it (Sharon, 2026-08-17). */}
              {(m.message_text ?? '').split(/^[ \t]*-{3,}[ \t\r]*$/m).map(p => p.trim()).filter(Boolean).map((part, i) => (
                <div key={i} className={`b out chan-b-${chan}${m.ai_model === 'manual_mirror' ? ' manual' : ''}`}>
                  {/* An email carries its recipient on its face. The DM above it went to
                      a LinkedIn chat, this one went to an address, and that is the whole
                      difference the operator is trying to see. */}
                  {chan === 'email' && i === 0 && m.prospect_email && (
                    <div className="b-emailmeta">To {m.prospect_email}</div>
                  )}
                  <Linkified text={part} />
                </div>
              ))}
            </div>
          )
        })}
      </div>

      {/* A draft that was thrown away had no surface anywhere: isDraft excludes
          blocked rows, the bubble filter above drops this reason by name, and
          the failed-send log excludes it too. The strip is the only place it is
          readable, and the only place a restore is offered. */}
      <RestoreStrip thread={thread} refresh={refresh} />

      {draft && (
        <div className="draftcard">
          <div className="dc-h">
            <div className="spark">✦</div>
            <div className="t">
              {thread.draftSnoozedUntil !== null ? `Pushed to ${formatReturn(thread.draftSnoozedUntil)}`
                : thread.draftStale ? 'AI draft · you already replied'
                  : isFollowUp(draft) ? 'AI follow-up · waiting on you'
                    : 'AI draft · waiting on you'}
              {/* The pair is announced HERE, not only at the second box: that box
                  sits below the fold of a card capped at half the pane, so without
                  this the other leg is a scroll away from being noticed at all. */}
              {companion && (
                <span className="dc-legs">
                  {' '}· 2 messages: {legPipe(draft)} + {legPipe(companion)}
                </span>
              )}
            </div>
          </div>
          {/* Everything between the header and the action bar scrolls INSIDE the
              card. The card itself is capped at half the pane so the conversation
              it is answering stays on screen (styles.css `.draftcard`). */}
          <div className="dc-scroll">
          {thread.draftSnoozedUntil !== null && (
            <div className="pushbar" style={{ margin: '8px 14px 0' }}>
              <span>
                Out of your queue until then, {returnsIn(thread.draftSnoozedUntil)}. It comes
                back sooner if {thread.prospect_name.split(' ')[0]} writes.
              </span>
              <button className="pushbtn" disabled={busy} onClick={onBringBack}>Bring back now</button>
            </div>
          )}
          {thread.draftStale && (
            <div className="stale" style={{ margin: '8px 14px 0' }}>
              Your own reply went out after their last message — this draft is probably not needed.
            </div>
          )}
          {/* An email draft carries its recipient on its face, same as a sent email
              bubble does. Without it the card looks like a DM whose body happens to
              start with "Subject:". */}
          {messageChannel(draft) === 'email' && draft.recipient_email && (
            <div className="dc-to">
              Email to {draft.recipient_email} (from {NATIVE_EMAIL_SENDER})
            </div>
          )}
          <textarea
            ref={taRef}
            className="dc-b"
            value={edited}
            onChange={e => setEdited(e.target.value)}
            disabled={busy}
          />
          {draft.context_gap && (
            <div className="gapwarn" style={{ margin: '0 14px 10px' }}>
              <div className="gw-h">
                This answers something our RISE notes do not cover
                {draft.context_gap.why ? `: ${draft.context_gap.why}` : '.'}
              </div>
              {draft.context_gap.question && (
                <div className="gw-q">For Mattan: {draft.context_gap.question}</div>
              )}
              <div className="gw-a">
                <span
                  className="gw-btn"
                  onClick={asking || askNote ? undefined : () => {
                    setAsking(true); setAskNote('')
                    escalateDraftToClient(draft.id)
                      .then(n => setAskNote(n))
                      .catch(e => setAskNote(e?.message || 'Could not queue that.'))
                      .finally(() => setAsking(false))
                  }}
                >{askNote ? 'Asked ✓' : asking ? 'Queueing…' : 'Ask Mattan'}</span>
                {draft.context_gap.chat_url && (
                  <a className="gw-link" href={draft.context_gap.chat_url} target="_blank" rel="noreferrer">
                    open the conversation
                  </a>
                )}
                <span className="gw-note">Optional. You can send this draft as it is.</span>
              </div>
              {askNote && <div className="gw-note" style={{ marginTop: 6 }}>{askNote}</div>}
            </div>
          )}
          {draft.draft_evidence && (
            <details className="dev" style={{ margin: '0 14px 10px' }}>
              <summary className="dev-s">Where this came from</summary>
              <div className="dev-b">
                {draft.draft_evidence.learned && draft.draft_evidence.learned.length > 0 && (
                  <div className="dev-g">
                    <span className="dev-k">Learned from Mattan</span>
                    {draft.draft_evidence.learned.map(f => (
                      <div key={f.id} className="dev-r">
                        <span className="dev-f">{f.fact}</span>
                        <span className="dev-o">his own DM{f.from ? ` to ${f.from}` : ''}, {(f.at || '').slice(0, 10)}</span>
                      </div>
                    ))}
                  </div>
                )}
                {draft.draft_evidence.facts && (
                  <div className="dev-g">
                    <span className="dev-k">RISE notes</span>
                    <div className="dev-r">
                      <span className="dev-f">{draft.draft_evidence.facts.slug}</span>
                      <span className="dev-o">v{draft.draft_evidence.facts.version ?? '?'}</span>
                    </div>
                  </div>
                )}
                {(draft.draft_evidence.store_fact || draft.draft_evidence.anchor || draft.draft_evidence.scan_finding) && (
                  <div className="dev-g">
                    <span className="dev-k">Grounding</span>
                    {draft.draft_evidence.store_fact && <div className="dev-r"><span className="dev-f">{draft.draft_evidence.store_fact}</span><span className="dev-o">their store</span></div>}
                    {draft.draft_evidence.anchor && <div className="dev-r"><span className="dev-f">{draft.draft_evidence.anchor}</span><span className="dev-o">anchor client</span></div>}
                    {draft.draft_evidence.scan_finding && <div className="dev-r"><span className="dev-f">{draft.draft_evidence.scan_finding}</span><span className="dev-o">their scan</span></div>}
                  </div>
                )}
                {draft.draft_evidence.exemplars && draft.draft_evidence.exemplars.length > 0 && (
                  <div className="dev-g">
                    <span className="dev-k">Voice copied from</span>
                    {draft.draft_evidence.exemplars.slice(0, 3).map((x, i) => (
                      <div key={i} className="dev-r">
                        <span className="dev-f">{x.reply}</span>
                        <span className="dev-o">to {x.prospect || 'a lead'}, {(x.at || '').slice(0, 10)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </details>
          )}
          {/* The other leg, in full, editable. Not a preview: this is a real pending
              row and the buttons below send it. */}
          {companion && (
            <div className="legbox" style={{ margin: '0 14px 10px' }}>
              <div className="leg-h">
                {messageChannel(companion) === 'email' ? 'Email' : 'LinkedIn DM'} · also goes out
                {/* The sender is only named on a native email row: that is the one
                    whose pipe is the Gmail node. A LinkedIn row stamped with an
                    address is the Resend mirror, which the badge below names. */}
                {messageChannel(companion) === 'email' && companion.recipient_email
                  ? ` to ${companion.recipient_email} (from ${NATIVE_EMAIL_SENDER})`
                  : ''}
              </div>
              <textarea
                className="emailpreview emailedit"
                value={editedCompanion}
                onChange={e => setEditedCompanion(e.target.value)}
                disabled={busy}
              />
            </div>
          )}
          {/* Only on a row that is NOT itself the email. On a channel='email' draft
              the body above IS what gets mailed, and "approving ALSO emails..."
              read as a second, invisible send (Ivan, 2026-09-04). */}
          {draft.recipient_email && messageChannel(draft) !== 'email' && (
            <div className="alsoemail" style={{ margin: '0 14px 10px' }}>
              <div>
                Approving also sends this email to {draft.recipient_email}{emailSenderLabel(thread.client_id)}
                {draft.email_mirror_text && (
                  <span className="emailtoggle" onClick={() => setShowEmail(v => !v)}>
                    {showEmail ? 'Hide email' : 'Show email'}
                  </span>
                )}
              </div>
              {showEmail && draft.email_mirror_text && (
                <textarea
                  className="emailpreview emailedit"
                  value={editedEmail}
                  onChange={e => setEditedEmail(e.target.value)}
                  disabled={busy}
                />
              )}
            </div>
          )}
          </div>
          {/* Three decisions, and Later sits between the two terminal ones on
              purpose: it is the middle answer, not a secondary discard. It keeps
              the neutral weight — the loud button on this bar is the one that
              puts a message in front of a person. */}
          <div className={`dc-a${thread.draftSnoozedUntil === null ? ' three' : ''}`}>
            <div className="btn s" onClick={busy ? undefined : onDiscard}>Discard</div>
            {thread.draftSnoozedUntil === null && (
              <div className="btn s" onClick={busy ? undefined : onPushLater}>Later</div>
            )}
            <div className="btn p" onClick={busy ? undefined : onApprove}>
              {companion ? 'Send both' : 'Approve & send'}
            </div>
          </div>
          {draftErr && <div className="err" style={{ padding: '0 14px 14px' }}>{draftErr}</div>}
        </div>
      )}

      {composerNote ? (
        <div className="composer">
          <div className="cfield">{composerNote}</div>
        </div>
      ) : (
        <div className="composer">
          <input
            className="cfield"
            placeholder="Write your own reply…"
            value={reply}
            onChange={e => setReply(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') onSend() }}
            disabled={busy}
          />
          <div
            className="csend"
            onClick={onSend}
            style={reply.trim() ? { background: 'var(--accent)', color: '#fff' } : undefined}
          >↑</div>
        </div>
      )}
      {composeErr && <div className="err" style={{ padding: '0 14px 12px' }}>{composeErr}</div>}
    </>
  )
}
