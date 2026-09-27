import { Fragment, type ReactNode } from 'react'
import { parseMarkdown, type InlineNode } from '../../exp/v2c/chat/renderer'

// Today's parser (exp/v2c/chat/renderer: paragraphs, headings, lists, code,
// bold/em/code/links), drawn in D's register. Unterminated markers stay literal
// mid-stream, which is the parser's own rule.

function inline(nodes: InlineNode[]): ReactNode {
  return nodes.map((n, i) => {
    switch (n.t) {
      case 'strong': return <b key={i}>{n.v}</b>
      case 'em': return <em key={i}>{n.v}</em>
      case 'code': return <code key={i}>{n.v}</code>
      case 'link': return <a key={i} href={n.href} target="_blank" rel="noreferrer">{n.v}</a>
      default: return <Fragment key={i}>{n.v}</Fragment>
    }
  })
}

export function Markdown({ text, caret }: { text: string; caret?: boolean }) {
  const blocks = parseMarkdown(text)
  const mark = caret ? <span className="dcl-caret" aria-hidden="true" /> : null
  if (blocks.length === 0) return <div className="dcl-md">{mark}</div>
  const lastI = blocks.length - 1
  return (
    <div className="dcl-md">
      {blocks.map((b, i) => {
        const end = i === lastI ? mark : null
        if (b.t === 'p') return <p key={i}>{inline(b.nodes)}{end}</p>
        if (b.t === 'h') return <p key={i} className="dcl-h">{inline(b.nodes)}{end}</p>
        if (b.t === 'code') return <pre key={i}><code>{b.text}</code>{end}</pre>
        const items = b.items.map((it, j) => <li key={j}>{inline(it)}{j === b.items.length - 1 ? end : null}</li>)
        return b.ordered ? <ol key={i}>{items}</ol> : <ul key={i}>{items}</ul>
      })}
    </div>
  )
}
