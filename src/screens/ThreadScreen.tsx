import { useEffect, useRef, useState } from 'react'
import { Avatar } from '../components/Avatar'
import { ContextSheet } from '../components/ContextSheet'
import { Linkified } from '../components/Linkified'
import { useConfirm } from '../components/ConfirmSheet'
import {
  approveDraft, composeReply, discardDraft, isDraft, markThreadRead, threadChatId, threadKind,
  type InboxMessage, type Thread,
} from '../lib/inbox'

function clientName(id: string): string {
  if (id === 'risedtc') return 'Rise'
  if (id === 'ivan') return 'Ivan'
  return id.charAt(0).toUpperCase() + id.slice(1)
}

function stageLabel(s: string): string {
  if (!s) return ''
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function dayLabel(iso: string): string {
  const d = new Date(iso)
  if (d.toDateString() === new Date().toDateString()) return 'TODAY'
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase()
}

// Micro-label shown above an outbound bubble. Truthful about queue/send state
// AND about what kind of message it was (invite vs DM vs InMail vs email).
function outLabel(m: InboxMessage, stage: string): { text: string; failed: boolean } {
  if (m.send_blocked_at && m.send_blocked_reason !== 'discarded_in_inbox') {
    return { text: `Send failed: ${m.send_blocked_reason}`, failed: true }
  }
  if (m.approved_at && !m.sent_at) return { text: 'Queued', failed: false }
  if (m.message_type === 'connection_note') {
    return stage === 'connection_sent'
      ? { text: 'Connection invite · not accepted yet', failed: false }
      : { text: 'Sent · connection invite', failed: false }
  }
  // manual_mirror = the human typed it in the LinkedIn app; the sync mirrored it in.
  const manual = m.ai_model === 'manual_mirror' ? ' · typed on LinkedIn' : ''
  if (m.message_type === 'inmail' || m.channel === 'linkedin_inmail') return { text: `Sent · InMail${manual}`, failed: false }
  if (m.channel === 'email') return { text: `Sent · email${manual}`, failed: false }
  if (m.message_type === 'dm' || m.message_type === 'manual_reply') return { text: `Sent · DM${manual}`, failed: false }
  return { text: `Sent${manual}`, failed: false }
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export function ThreadScreen({ thread, onBack, refresh }: {
  thread: Thread; onBack: () => void; refresh: () => void
}) {
  const draft = thread.draft
  const [edited, setEdited] = useState(draft?.message_text ?? '')
  const [draftErr, setDraftErr] = useState('')
  const [reply, setReply] = useState('')
  const [composeErr, setComposeErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [showCtx, setShowCtx] = useState(false)
  const msgsRef = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const confirm = useConfirm()

  // Re-seed the editor when the draft row changes (e.g. after a refresh).
  useEffect(() => { setEdited(draft?.message_text ?? '') }, [draft?.id])

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
      message: 'The sender picks it up within about 2 minutes.',
      confirmText: 'Approve & send',
    })
    if (!ok) return
    setBusy(true); setDraftErr('')
    try { await approveDraft(draft.id, edited, threadChatId(thread)); refresh() }
    catch (e) { setDraftErr(errText(e)) }
    finally { setBusy(false) }
  }

  async function onDiscard() {
    if (!draft) return
    const ok = await confirm({
      title: 'Discard this draft?',
      message: 'It will not be sent.',
      confirmText: 'Discard',
      danger: true,
    })
    if (!ok) return
    setBusy(true); setDraftErr('')
    try { await discardDraft(draft.id); refresh() }
    catch (e) { setDraftErr(errText(e)) }
    finally { setBusy(false) }
  }

  async function onSend() {
    const t = reply.trim()
    if (!t || busy) return
    setBusy(true); setComposeErr('')
    try { await composeReply(thread, t); setReply(''); refresh() }
    catch (e) { setComposeErr(errText(e)) }
    finally { setBusy(false) }
  }

  // Bubbles: everything except discarded rows and unapproved drafts (drafts live in the card).
  const bubbles = thread.messages.filter(
    m => m.send_blocked_reason !== 'discarded_in_inbox' && !isDraft(m),
  )

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
            <b>{clientName(thread.client_id)}</b> · {threadKind(thread) === 'inmail' ? 'InMail' : threadKind(thread) === 'email' ? 'Email' : 'LinkedIn'} · {stageLabel(thread.stage)}
          </div>
        </div>
        <Avatar name={thread.prospect_name} channel={thread.channel} size={36} />
      </div>
      {showCtx && <ContextSheet thread={thread} onClose={() => setShowCtx(false)} />}

      <div className="msgs" ref={msgsRef}>
        {bubbles.map(m => {
          const label = dayLabel(m.created_at)
          const showDay = label !== lastDay
          lastDay = label
          if (m.direction === 'inbound') {
            return (
              <div key={m.id} style={{ display: 'contents' }}>
                {showDay && <div className="day">{label}</div>}
                <div className="b in"><Linkified text={m.message_text} /></div>
              </div>
            )
          }
          const lbl = outLabel(m, thread.stage)
          return (
            <div key={m.id} style={{ display: 'contents' }}>
              {showDay && <div className="day">{label}</div>}
              <div className="blbl r" style={lbl.failed ? { color: '#FF453A' } : undefined}>{lbl.text}</div>
              <div className="b out"><Linkified text={m.message_text} /></div>
            </div>
          )
        })}
      </div>

      {draft && (
        <div className="draftcard">
          <div className="dc-h">
            <div className="spark">✦</div>
            <div className="t">{thread.draftStale ? 'AI draft · you already replied' : 'AI draft · waiting on you'}</div>
          </div>
          {thread.draftStale && (
            <div className="stale" style={{ margin: '8px 14px 0' }}>
              Your own reply went out after their last message — this draft is probably not needed.
            </div>
          )}
          <textarea
            ref={taRef}
            className="dc-b"
            value={edited}
            onChange={e => setEdited(e.target.value)}
            disabled={busy}
          />
          <div className="dc-a">
            <div className="btn s" onClick={busy ? undefined : onDiscard}>Discard</div>
            <div className="btn p" onClick={busy ? undefined : onApprove}>Approve &amp; send</div>
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
