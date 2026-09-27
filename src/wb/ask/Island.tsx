/* ==========================================================================
   src/wb/ask/Island.tsx - the Claude status pill (blueprint, Claude "While it
   works", NEW items).

   Two states and nothing at rest:
     · WORKING: while a turn runs and he is on another place, one pill over the
       dock, "Claude · Working 12s". Tap = go to Claude.
     · ANSWERED: the turn he asked for finished while he was elsewhere. The
       pill opens into a card (the "incoming call"): the first line of the
       answer, or the failure, with Open and Later. It stays until he answers
       it; a card that vanished on a timer would be an answer he never saw.

   No dot, no blur: a solid plate and words (B "Instrument"). It reads
   `chat` only; it never sends and never opens a request.
   ========================================================================== */
import { useEffect, useRef, useState } from 'react'
import { Button } from '../../ds'
import type { ChatHandle } from '../../exp/v2c/useChat'
import './island.css'

type Landed = { title: string; line: string; failed: boolean }

function firstLine(text: string): string {
  const line = text.split('\n').map(l => l.replace(/^[#>*\-\s]+/, '').trim()).find(Boolean) ?? ''
  return line.length > 140 ? `${line.slice(0, 139)}…` : line
}

export function Island({ chat, away, hidden, onOpen }: {
  chat: ChatHandle
  /** He is not on the Claude place, so an answer landing is news. */
  away: boolean
  /** Something else has the screen (feed sheet, thread takeover). */
  hidden: boolean
  onOpen: () => void
}) {
  const [since, setSince] = useState<number | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [landed, setLanded] = useState<Landed | null>(null)
  const wasBusy = useRef(chat.busy)

  useEffect(() => {
    const before = wasBusy.current
    wasBusy.current = chat.busy
    if (chat.busy && !before) { setSince(Date.now()); setLanded(null) }
    if (!chat.busy && before) {
      setSince(null)
      if (!away) return
      const last = [...chat.turns].reverse().find(t => t.role === 'assistant')
      if (!last) return
      if (last.error) setLanded({ title: 'Claude could not finish', line: firstLine(last.error.message), failed: true })
      else if (last.aborted) setLanded(null)
      else setLanded({ title: 'Claude answered', line: firstLine(last.text), failed: false })
    }
  }, [chat.busy, chat.turns, away])

  // Being on the Claude place is reading it.
  useEffect(() => { if (!away) setLanded(null) }, [away])

  useEffect(() => {
    if (since === null) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [since])

  if (hidden || !away) return null
  const open = () => { setLanded(null); onOpen() }

  if (landed) {
    return (
      <div className="cl-island cl-island-card" role="status" data-island="landed" data-failed={landed.failed ? '' : undefined}>
        <button type="button" className="wb-cl cl-island-body" onClick={open}>
          <span className="cl-island-t">{landed.title}</span>
          {landed.line && <span className="cl-island-l">{landed.line}</span>}
        </button>
        <span className="cl-island-acts">
          <Button variant="quiet" size="sm" onClick={() => setLanded(null)}>Later</Button>
          <Button size="sm" iconEnd="next" onClick={open}>Open</Button>
        </span>
      </div>
    )
  }
  if (!chat.busy) return null
  const secs = since === null ? 0 : Math.max(0, Math.round((now - since) / 1000))
  return (
    <button type="button" className="wb-cl cl-island cl-island-pill" data-island="working" onClick={open}
      aria-label={`Claude is working, ${secs} seconds. Open Claude`}>
      <span className="cl-island-ring" aria-hidden="true" />
      <span>Claude</span>
      <span className="cl-island-s">Working {secs}s</span>
    </button>
  )
}
