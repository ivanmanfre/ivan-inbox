import { useEffect, useRef, useState } from 'react'
import { needsDaySeparator, startsTurn, type AgentMessage } from '../../lib/agent'

function dayLabel(iso: string): string {
  const d = new Date(iso)
  if (d.toDateString() === new Date().toDateString()) return 'TODAY'
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase()
}

function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

// Full-screen n8nClaw chat, pushed from the Studio hub. Same bubble/day-label
// idiom as ThreadScreen (.msgs/.b.in/.b.out/.day), a composer identical to the
// thread's own. Send goes through the RPC-only path in lib/agent.ts (D3) — no
// webhook fallback — so a failed send surfaces here as an inline error rather
// than silently ghost-messaging the real WhatsApp thread. Chat sends are
// conversational, not consequential — D11's confirm gate covers acks and
// status writes, not the composer (a per-message dialog would make the chat
// unusable and match no messaging surface in the app).
export function ChatScreen({ messages, onSend, onBack }: {
  messages: AgentMessage[]; onSend: (text: string) => Promise<void>; onBack: () => void
}) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const msgsRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = msgsRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages.length])

  async function send() {
    const t = text.trim()
    if (!t || busy) return
    setBusy(true); setError('')
    try { await onSend(t); setText('') }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not send') }
    finally { setBusy(false) }
  }

  return (
    <>
      <div className="t-nav">
        <span className="back" onClick={onBack}>‹</span>
        <div className="who"><div className="n">n8nClaw</div></div>
      </div>
      <div className="msgs" ref={msgsRef}>
        {messages.length === 0 && <div className="empty">No messages yet.</div>}
        {messages.map((m, i) => {
          const showDay = needsDaySeparator(m.created_at, messages[i - 1]?.created_at ?? null)
          const isUser = m.role === 'user'
          return (
            <div key={m.id} style={{ display: 'contents' }}>
              {showDay && <div className="day">{dayLabel(m.created_at)}</div>}
              {startsTurn(messages, i) && (
                <div className="blbl" style={{ alignSelf: isUser ? 'flex-end' : 'flex-start' }}>
                  {isUser ? 'You' : 'n8nClaw'} · {timeOf(m.created_at)}
                </div>
              )}
              <div className={`b ${isUser ? 'out' : 'in'}`}>{m.content}</div>
            </div>
          )
        })}
      </div>
      {error && <div className="err" style={{ padding: '0 14px 8px' }}>{error}</div>}
      <div className="composer">
        <input
          className="cfield"
          placeholder="Message n8nClaw…"
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') send() }}
          disabled={busy}
        />
        <div
          className="csend"
          onClick={send}
          style={text.trim() ? { background: 'var(--accent)', color: '#fff' } : undefined}
        >↑</div>
      </div>
    </>
  )
}
