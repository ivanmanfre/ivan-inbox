import { useState } from 'react'
import { formatInput, summarizeTool } from '../../exp/v2c/chat/toolSummaries'
import type { ToolCall } from '../../exp/v2c/chat/events'
import { stepOffset } from './model'

// "4 steps · live": what the turn touched, one plain line per step. A row read
// back from the database carries the broker's own words (`tool_events.summary`);
// a streamed call is worded by today's `summarizeTool`. The last step of a live
// turn says "running"; the others say how far into the turn they landed, when
// that is known (a hydrated row has no times, so it prints none).

const SHOW = 6

export function stepWords(c: ToolCall): string {
  const detail = c.input && typeof c.input === 'object' ? (c.input as { detail?: unknown }).detail : undefined
  if (typeof detail === 'string' && detail.trim()) return detail.trim()
  const s = summarizeTool(c.tool, c.input)
  return s.preview && s.preview !== '—' ? `${s.label} ${s.preview}` : s.label
}

export function Steps({ calls, live, t0, stepAt }: {
  calls: ToolCall[]
  live: boolean
  t0: number | null
  stepAt?: (id: string) => number | undefined
}) {
  const [all, setAll] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  if (calls.length === 0) return null
  const hidden = all ? 0 : Math.max(0, calls.length - SHOW)
  const shown = calls.slice(hidden)
  return (
    <div className="dcl-steps" data-steps>
      <div className="dcl-steps-h">
        <span>{calls.length} {calls.length === 1 ? 'step' : 'steps'}</span>
        <span>{live ? 'live' : 'done'}</span>
      </div>
      {hidden > 0 && (
        <button type="button" className="dcl-steps-more" onClick={() => setAll(true)}>
          {hidden} earlier {hidden === 1 ? 'step' : 'steps'}
        </button>
      )}
      {shown.map((c, i) => {
        const last = live && hidden + i === calls.length - 1
        const at = stepOffset(stepAt?.(c.id), t0)
        return (
          <div key={c.id}>
            <button type="button" className={`dcl-step${last ? ' dcl-run' : ''}`} aria-expanded={openId === c.id}
              title="Show what this step was given" onClick={() => setOpenId(openId === c.id ? null : c.id)}>
              <span className="dcl-step-t">{stepWords(c)}</span>
              <span className="dcl-step-m">{last ? 'running' : at ?? ''}</span>
            </button>
            {openId === c.id && <pre className="dcl-step-in"><code>{c.tool}{'\n'}{formatInput(c.input)}</code></pre>}
          </div>
        )
      })}
    </div>
  )
}
