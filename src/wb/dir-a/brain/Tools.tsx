/* ==========================================================================
   src/wb/dir-a/brain/Tools.tsx: S29-7, rebuilt on the design system.

   03-DIRECTION move 11: under the answer, a collapsible group lists what the
   turn touched. The pure half (`groupRuns`, `summarizeTool`, `formatInput`) is
   imported from where it already lives; only the view is rebuilt, so the tool
   labels and previews are the same strings the old strip printed and the
   unicode glyph each summary carried is replaced by its named icon.
   ========================================================================== */
import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Icon, fadeT, spring, type IconName } from '../../../ds'
import { formatInput, groupRuns, summarizeTool } from '../../../exp/v2c/chat/toolSummaries'
import { turnOutcome, type ToolCall, type Turn } from '../../../exp/v2c/chat/events'
import './brain.css'

/** The tool a run belongs to, as a named icon. The old strip typed a glyph per
 * tool; the system's set carries the same distinctions by name. */
const TOOL_ICON: Record<string, IconName> = {
  Read: 'doc', Edit: 'edit', Write: 'edit', MultiEdit: 'edit', NotebookEdit: 'edit',
  Bash: 'forward', Glob: 'search', Grep: 'search', WebFetch: 'external', WebSearch: 'search',
  Task: 'layers', TodoWrite: 'tasks',
}

/** "Read 4 · Grep 2". what it touched, counted, in the labels the summaries
 * already use. Nothing here is a new noun. */
function touchedLine(runs: { tool: string; ids: string[] }[]): string {
  const byLabel = new Map<string, number>()
  for (const r of runs) {
    const label = summarizeTool(r.tool, null).label
    byLabel.set(label, (byLabel.get(label) ?? 0) + r.ids.length)
  }
  return [...byLabel.entries()].map(([label, n]) => `${label} ${n}`).join(' · ')
}

/** One collapsed group per turn, one row per run inside it. No output panel:
 * the stream forwards `tool_use` and never `tool_result`, so there is nothing
 * truthful to show inside one. */
export function ToolStrip({ calls }: { calls: ToolCall[] }) {
  const [open, setOpen] = useState(false)
  const [row, setRow] = useState<string | null>(null)
  if (calls.length === 0) return null
  const byId = new Map(calls.map(c => [c.id, c]))
  const runs = groupRuns(calls)
  return (
    <div className="a-brain-tools">
      <button
        type="button" className="a-brain-toolhead" data-tools aria-expanded={open}
        onClick={() => setOpen(v => !v)}
      >
        <Icon name={open ? 'discloseUp' : 'disclose'} size={16} />
        <span className="a-nowrap">{touchedLine(runs)}</span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            className="a-brain-tools"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0, transition: spring }}
            exit={{ opacity: 0, transition: fadeT }}
          >
            {runs.map((run, i) => {
              const first = byId.get(run.ids[0])!
              const s = summarizeTool(run.tool, first.input)
              const key = `${i}:${run.ids[0]}`
              const isOpen = row === key
              return (
                <div key={key}>
                  <button
                    type="button" className="a-brain-toolrow" aria-expanded={isOpen}
                    onClick={() => setRow(isOpen ? null : key)}
                  >
                    <Icon name={TOOL_ICON[run.tool] ?? 'dot'} size={16} />
                    <b>{s.label}{run.ids.length > 1 ? ` ${run.ids.length}` : ''}</b>
                    <span>{s.preview}</span>
                  </button>
                  <AnimatePresence initial={false}>
                    {isOpen && run.ids.map(id => (
                      <motion.pre
                        key={id}
                        className="a-brain-toolin"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1, transition: fadeT }}
                        exit={{ opacity: 0, transition: fadeT }}
                      >
                        <code>{formatInput(byId.get(id)!.input)}</code>
                      </motion.pre>
                    ))}
                  </AnimatePresence>
                </div>
              )
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/** Who answered, how it ended, and what it took. A null cost is the honest
 * state against the real broker, which reports none. */
export function TurnMeta({ turn, outcome }: { turn: Turn; outcome: ReturnType<typeof turnOutcome> }) {
  const parts: string[] = []
  if (turn.durationMs != null) parts.push(`${(turn.durationMs / 1000).toFixed(1)}s`)
  if (turn.costUsd != null) parts.push(`$${turn.costUsd.toFixed(4)}`)
  return (
    <div className="a-brain-tmeta">
      <Icon name="ask" size={16} />
      <span className="a-brain-tmeta-n">Claude</span>
      <span className="a-brain-tdot" data-outcome={outcome} />
      {parts.length > 0 && <span>{parts.join(' · ')}</span>}
    </div>
  )
}
