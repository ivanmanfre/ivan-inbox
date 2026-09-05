/* =========================================================================
   Direction B, MOVE 11 (ref: Text Shimmer + Tool Group, serafimcloud).

   Copied from `ToolStrip` in `src/exp/v2c/ChatMessage.tsx` and rebuilt: the
   strip's LOOK is part of this screen, so it is owned here rather than
   imported. Same data (`turn.tools`), same grouping (`groupRuns`), same
   per-run summary (`summarizeTool`), same expanded input panel
   (`formatInput`). No output panel, for the same reason the source gives:
   /chat/stream forwards tool_use and never tool_result, so there is nothing
   truthful to put in one.

   What changed: the runs collapse behind ONE line that says what the answer
   touched, and that line is built from the tool labels the strip already
   printed, with a count. No sentence is invented here.

   The glyph column is now a lucide mark through `Icon`, because a unicode
   glyph typed into TSX is exactly what the design system took away.
   ========================================================================= */
import { useState } from 'react'
import { Icon, type IconName } from '../../../ds'
import { formatInput, groupRuns, summarizeTool } from '../../../exp/v2c/chat/toolSummaries'
import type { ToolCall } from '../../../exp/v2c/chat/events'

const SEP = ' \u00b7 '
const TIMES = '\u00d7'

const TOOL_ICON: Record<string, IconName> = {
  Read: 'doc',
  Edit: 'edit', Write: 'edit', MultiEdit: 'edit', NotebookEdit: 'edit',
  Bash: 'cmd',
  Glob: 'search', Grep: 'search', WebSearch: 'search',
  WebFetch: 'external',
  Task: 'layers',
  TodoWrite: 'tasks',
}

export function ToolGroup({ calls, defaultOpen = false }: { calls: ToolCall[]; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  const [openRun, setOpenRun] = useState<string | null>(null)
  if (calls.length === 0) return null
  const byId = new Map(calls.map(c => [c.id, c]))
  const runs = groupRuns(calls)
  // The collapsed line: the labels this strip already showed, with their
  // counts. Nothing new is said about what the tools did.
  const summary = runs
    .map(r => {
      const label = summarizeTool(r.tool, byId.get(r.ids[0])?.input).label
      return r.ids.length > 1 ? `${label} ${TIMES}${r.ids.length}` : label
    })
    .join(SEP)

  return (
    <div className="dirb-ask-tools" data-tools>
      <button
        type="button" className="dirb-ask-tool-head dirb-tap" data-tap
        aria-expanded={open} onClick={() => setOpen(v => !v)}
      >
        <Icon name="layers" size={16} />
        <span className="dirb-ask-tool-sum ds-t-meta dirb-truncate">{summary}</span>
        <Icon name={open ? 'discloseUp' : 'disclose'} size={16} />
      </button>

      {open && (
        <div className="dirb-ask-tool-runs">
          {runs.map((run, i) => {
            const first = byId.get(run.ids[0])!
            const s = summarizeTool(run.tool, first.input)
            const many = run.ids.length > 1
            const key = `${i}:${run.ids[0]}`
            const isOpen = openRun === key
            return (
              <div key={key}>
                <button
                  type="button" className="dirb-ask-tool-row dirb-tap" data-tap
                  aria-expanded={isOpen} onClick={() => setOpenRun(isOpen ? null : key)}
                >
                  <Icon name={TOOL_ICON[run.tool] ?? 'dot'} size={16} />
                  <span className="ds-t-meta">
                    {s.label}
                    {many && <span className="ds-t-mono">{` ${TIMES}${run.ids.length}`}</span>}
                  </span>
                  <span className="dirb-ask-tool-p ds-t-meta dirb-truncate">{s.preview}</span>
                  <Icon name={isOpen ? 'discloseUp' : 'disclose'} size={16} />
                </button>
                {isOpen && run.ids.map(id => (
                  <pre className="dirb-ask-tool-in" key={id}>
                    <code>{formatInput(byId.get(id)!.input)}</code>
                  </pre>
                ))}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
