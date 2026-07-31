import { useEffect, useRef, useState } from 'react'
import { needsDaySeparator } from '../../lib/agent'
import type { useAgent } from '../../hooks/useAgent'

type Agent = ReturnType<typeof useAgent>

function dayLabel(iso: string): string {
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return ''
  if (d.toDateString() === new Date().toDateString()) return 'TODAY'
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase()
}

// Pushed full-screen (same idiom as ThreadScreen's back chevron + bubble
// list). Reuses the exact .t-nav/.back/.msgs/.day/.b/.composer/.cfield/.csend
// classes ThreadScreen already established — assistant on the left ('.b.in'),
// Ivan's own messages on the right ('.b.out'), same as inbound/outbound there.
export function AgentChatScreen({ agent, onBack }: { agent: Agent; onBack: () => void }) {
  const { messages, send } = agent
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const msgsRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = msgsRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages.length])

  // sendChat throws on failure (no webhook fallback — D3/agent.ts) and this is
  // the surface that shows it: an inline error, never a silent retry.
  async function onSend() {
    const t = text.trim()
    if (!t || busy) return
    setBusy(true); setError('')
    try { await send(t); setText('') }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not send') }
    finally { setBusy(false) }
  }

  let prevIso: string | null = null

  return (
    <div className="ct-overlay">
      <div className="t-nav">
        <span className="back" onClick={onBack}>‹</span>
        <div className="who"><div className="n">Agent chat</div></div>
        <span style={{ width: 22 }} />
      </div>
      <div className="msgs" ref={msgsRef}>
        {messages.length === 0 ? (
          <div className="empty">No messages yet. Say hi.</div>
        ) : (
          messages.map(m => {
            const showDay = needsDaySeparator(m.created_at, prevIso)
            prevIso = m.created_at
            const mine = m.role !== 'assistant'
            return (
              <div key={m.id} style={{ display: 'contents' }}>
                {showDay && <div className="day">{dayLabel(m.created_at)}</div>}
                <div className={`b ${mine ? 'out' : 'in'}`}>{m.content}</div>
              </div>
            )
          })
        )}
      </div>
      {error && <div className="err" style={{ padding: '0 14px 8px' }}>{error}</div>}
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
    </div>
  )
}
