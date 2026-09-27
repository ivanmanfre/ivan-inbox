import { useEffect, useState } from 'react'
import { useFrame } from '../shell/frame'
import { Btn } from '../ui/Key'
import { useClaudeMaybe } from './ClaudeProvider'
import { secsSince } from './model'
import './island.css'

// While Claude works and the drawer is closed: one pill, "Claude · Working 12s"
// (tap opens the drawer). When the answer lands while he is elsewhere: a card
// that says so and stays until he opens it or says Later. Today's Island rule
// (wb/ask/Island.tsx), drawn in D. It reads the chat; it never sends.
//
// Hooks rule: all hooks first, then the branches.

export function Island() {
  const c = useClaudeMaybe()
  const f = useFrame()
  const busy = !!c && (c.chat.busy || c.chat.runningElsewhere)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!busy) return
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [busy])
  if (!c || f.claudeOpen) return null
  const open = () => { c.clearLanded(); f.setClaudeOpen(true) }
  if (c.landed) {
    return (
      <div className={`dcl-island dcl-island-card${c.landed.failed ? ' dcl-bad' : ''}`} role="status" data-island="landed">
        <button type="button" className="dcl-island-b" onClick={open}>
          <b>{c.landed.title}</b>
          {c.landed.line && <span>{c.landed.line}</span>}
        </button>
        <span className="dcl-island-k">
          <Btn verb="later" onClick={c.clearLanded}>Later</Btn>
          <Btn primary verb="open" onClick={open}>Open</Btn>
        </span>
      </div>
    )
  }
  if (!busy) return null
  return (
    <button type="button" className="dcl-island dcl-island-pill" data-island="working" onClick={open}
      aria-label="Claude is working. Open Claude">
      <i aria-hidden="true" /><b>Claude</b><span>Working {secsSince(c.since, now)}s</span>
    </button>
  )
}

/** The "working" word on the panel's Claude item while a turn runs. */
export function ClaudeWorking() {
  const c = useClaudeMaybe()
  if (!c || !(c.chat.busy || c.chat.runningElsewhere)) return null
  return <em className="dcl-working">working</em>
}
