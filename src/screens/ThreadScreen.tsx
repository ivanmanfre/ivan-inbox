import { useEffect, useRef, useState } from 'react'
import { Avatar } from '../components/Avatar'
import { Linkified } from '../components/Linkified'
import { useConfirm } from '../components/ConfirmSheet'
import {
  approveDraft, composeReply, discardDraft, isDraft, markThreadRead,
  type InboxMessage, type Thread,
} from '../lib/inbox'

function clientName(id: string): string {
  if (id === 'risedtc') return 'Rise'
  if (id === 'ivan') return 'Ivan'
  return id.charAt(0).toUpperCase() + id.slice(1)
}

function channelLabel(c: InboxMessage['channel']): string {
  if (c === 'email') return 'Email'
  if (c === 'linkedin_inmail') return 'InMail'
  return 'LinkedIn'
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

// Micro-label shown above an outbound bubble. Truthful about queue/send state.
function outLabel(m: InboxMessage): { text: string; failed: boolean } {
  if (m.send_blocked_at && m.send_blocked_reason !== 'discarded_in_inbox') {
    return { text: `Send failed: ${m.send_blocked_reason}`, failed: true }
  }
  if (m.approved_at && !m.sent_at) return { text: 'Queued', failed: false }
  if (m.message_type === 'connection_note') return { text: 'Sent · connection note', failed: false }
  return { text: 'Sent', failed: false }
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
    try { await approveDraft(draft.id, edited); refresh() }
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
        <div className="who">
          <div className="n">{thread.prospect_name}</div>
          <div className="m">
            {thread.prospect_company ? <>{thread.prospect_company} · </> : null}
            <b>{clientName(thread.client_id)}</b> · {channelLabel(thread.channel)} · {stageLabel(thread.stage)}
          </div>
        </div>
        <Avatar name={thread.prospect_name} channel={thread.channel} size={36} />
      </div>

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
          const lbl = outLabel(m)
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
            <div className="t">AI draft · waiting on you</div>
          </div>
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
