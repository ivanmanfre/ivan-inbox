import { useState } from 'react'
import { parseMarkdown, type Block, type InlineNode } from './chat/renderer'
import { formatInput, groupRuns, summarizeTool } from './chat/toolSummaries'
import type { ToolCall, Turn } from './chat/events'

// Inline nodes → React elements. No HTML string, no dangerouslySetInnerHTML, so
// no sanitiser is needed: nothing on this path is ever parsed as markup.
function Inline({ nodes }: { nodes: InlineNode[] }) {
  return (
    <>
      {nodes.map((n, i) => {
        if (n.t === 'code') return <code className="wb-ic" key={i}>{n.v}</code>
        if (n.t === 'strong') return <b key={i}>{n.v}</b>
        if (n.t === 'em') return <i key={i}>{n.v}</i>
        if (n.t === 'link') {
          return (
            <a className="msg-link" href={n.href} target="_blank" rel="noreferrer" key={i}>{n.v}</a>
          )
        }
        return <span key={i}>{n.v}</span>
      })}
    </>
  )
}

function Blocks({ blocks }: { blocks: Block[] }) {
  return (
    <>
      {blocks.map((b, i) => {
        if (b.t === 'code') {
          return (
            // System font, tabular numerals, preserved whitespace. The phase 1
            // spec proposed a scoped monospace exception here; the build contract
            // locks "no monospace anywhere" and the contract wins.
            <pre className={`wb-code${b.open ? ' open' : ''}`} key={i}>
              {b.lang && <span className="wb-code-l">{b.lang}</span>}
              <code>{b.text}</code>
            </pre>
          )
        }
        if (b.t === 'h') return <div className={`wb-mh h${b.level}`} key={i}><Inline nodes={b.nodes} /></div>
        if (b.t === 'ul') {
          return (
            <ul className={`wb-ul${b.ordered ? ' ord' : ''}`} key={i}>
              {b.items.map((it, j) => (
                <li key={j}><span className="wb-li-m">{b.ordered ? `${j + 1}.` : '·'}</span><span><Inline nodes={it} /></span></li>
              ))}
            </ul>
          )
        }
        return <p className="wb-p" key={i}><Inline nodes={b.nodes} /></p>
      })}
    </>
  )
}

// One collapsed row per call, consecutive same-tool calls collapsed into one
// strip. No output panel: /chat/stream forwards tool_use, never tool_result, so
// there is nothing truthful to show inside.
export function ToolStrip({ calls }: { calls: ToolCall[] }) {
  const [open, setOpen] = useState<string | null>(null)
  if (calls.length === 0) return null
  const byId = new Map(calls.map(c => [c.id, c]))
  return (
    <div className="wb-tools">
      {groupRuns(calls).map((run, i) => {
        const first = byId.get(run.ids[0])!
        const s = summarizeTool(run.tool, first.input)
        const many = run.ids.length > 1
        const key = `${i}:${run.ids[0]}`
        const isOpen = open === key
        return (
          <div className="wb-tool" key={key}>
            <div className="wb-tool-r" onClick={() => setOpen(isOpen ? null : key)}>
              <span className="wb-tool-ic">{s.icon}</span>
              <span className="wb-tool-n">{s.label}{many && <span className="wb-tool-x">×{run.ids.length}</span>}</span>
              <span className="wb-tool-p">{s.preview}</span>
              <span className="wb-tool-c">{isOpen ? '⌄' : '›'}</span>
            </div>
            {isOpen && run.ids.map(id => (
              <pre className="wb-tool-in" key={id}>
                <code>{formatInput(byId.get(id)!.input)}</code>
              </pre>
            ))}
          </div>
        )
      })}
    </div>
  )
}

export function ChatTurn({ turn, onRetry }: { turn: Turn; onRetry?: () => void }) {
  if (turn.role === 'user') {
    return (
      <div className="wb-turn user">
        {/* The context chip is what keeps a transcript legible a day later: it
            records what Ivan was looking at when he asked. */}
        {turn.about && <div className="wb-about">about {turn.about}</div>}
        <div className="wb-bubble out">{turn.text}</div>
      </div>
    )
  }
  return (
    <div className="wb-turn asst">
      <ToolStrip calls={turn.tools} />
      {turn.text && <div className="wb-body"><Blocks blocks={parseMarkdown(turn.text)} /></div>}
      {turn.aborted && <div className="wb-stopped">Stopped.</div>}
      {turn.error && (
        <div className="wb-turn-err">
          <span className="wb-turn-err-t">{turn.error.message}</span>
          {turn.error.retryable && onRetry && (
            <button className="wb-retry" onClick={onRetry}>Retry</button>
          )}
        </div>
      )}
    </div>
  )
}

// The in-flight turn: tool strip, paced text, and a caret while the stream is
// still open.
export function ChatStreaming({ text, tools, slow }: {
  text: string; tools: ToolCall[]; slow: boolean
}) {
  const nothingYet = !text && tools.length === 0
  return (
    <div className="wb-turn asst">
      <ToolStrip calls={tools} />
      {text && (
        <div className="wb-body">
          <Blocks blocks={parseMarkdown(text)} />
        </div>
      )}
      {nothingYet && (
        <div className="wb-thinking">
          <span className="wb-th-dot" /><span className="wb-th-dot" /><span className="wb-th-dot" />
          <span className="wb-th-t">{slow ? 'Still starting up — the container was cold' : 'Working'}</span>
        </div>
      )}
    </div>
  )
}
