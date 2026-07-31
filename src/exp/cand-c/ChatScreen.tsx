import { useEffect, useRef, useState } from 'react'
import { Linkified } from '../../components/Linkified'
import { useAgent } from '../../hooks/useAgent'
import { needsDaySeparator } from '../../lib/agent'

function dayLabel(iso: string): string {
  const d = new Date(iso)
  if (d.toDateString() === new Date().toDateString()) return 'TODAY'
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase()
}

// Full-screen n8nClaw chat, pushed from the "Chat ›" row on the Agent segment.
// Send goes through the RPC path only (useAgent().send -> lib/agent.ts
// sendChat) — the dashboard's unauthenticated webhook fallback that spoofs an
// inbound WhatsApp message on ANY rpc error is deliberately not ported (D3,
// AUDIT.md danger #1): a failed send surfaces an inline error here instead of
// a stray retry ghost-messaging the real assistant loop from Ivan's phone.
export function ChatScreen({ onBack }: { onBack: () => void }) {
  const { messages, loading, send } = useAgent()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const msgsRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = msgsRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages.length])

  async function onSend() {
    const t = text.trim()
    if (!t || busy) return
    setBusy(true); setError('')
    try { await send(t); setText('') }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not send') }
    finally { setBusy(false) }
  }

  let lastIso: string | null = null

  return (
    <>
      <div className="t-nav">
        <span className="back" onClick={onBack}>‹</span>
        <div className="who">
          <div className="n">Agent</div>
          <div className="m">n8nClaw</div>
        </div>
      </div>

      <div className="msgs" ref={msgsRef}>
        {loading && messages.length === 0 ? (
          <div className="empty">Loading…</div>
        ) : (
          messages.map(m => {
            const showDay = needsDaySeparator(m.created_at, lastIso)
            lastIso = m.created_at
            return (
              <div key={m.id} style={{ display: 'contents' }}>
                {showDay && <div className="day">{dayLabel(m.created_at)}</div>}
                <div className={`b ${m.role === 'user' ? 'out' : 'in'}`}>
                  <Linkified text={m.content} />
                </div>
              </div>
            )
          })
        )}
      </div>

      <div className="composer">
        <input
          className="cfield"
          placeholder="Message the assistant…"
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') onSend() }}
          disabled={busy}
        />
        <div
          className="csend"
          onClick={onSend}
          style={text.trim() ? { background: 'var(--accent)', color: '#fff' } : undefined}
        >↑</div>
      </div>
      {error && <div className="err" style={{ padding: '0 14px 12px' }}>{error}</div>}
    </>
  )
}
