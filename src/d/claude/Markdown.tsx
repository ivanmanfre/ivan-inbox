import { Fragment, type ReactNode } from 'react'
import { parseMarkdown, type InlineNode } from '../../exp/v2c/chat/renderer'
import { extractRecallNouns } from '../../exp/brain/b/recall'

// Today's parser (exp/v2c/chat/renderer), drawn in D's register, with today's
// two prose controls (wb/ask/AskThread.tsx renderInline):
//  - the FIRST remembered noun in each block is a key that asks Claude to
//    recall it (`extractRecallNouns`, one per block, never in code or bold);
//  - a numbered mark follows a memory file's name wherever the prose itself
//    names it (the only honest place for a citation: sources are a list, not
//    a map from claim to file).
// Unterminated markers stay literal mid-stream, which is the parser's own rule.

export type Cites = { re: RegExp | null; index: Map<string, number> }
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Today's buildCites: each basename and its stem, longest first. */
export function buildCites(names: string[]): Cites {
  const index = new Map<string, number>()
  const keys: string[] = []
  names.forEach((name, i) => {
    const stem = name.replace(/\.[a-z0-9]+$/i, '')
    for (const k of stem === name ? [name] : [name, stem]) {
      if (index.has(k)) continue
      index.set(k, i + 1)
      keys.push(k)
    }
  })
  if (!keys.length) return { re: null, index }
  keys.sort((a, b) => b.length - a.length)
  return { re: new RegExp(`(${keys.map(esc).join('|')})`), index }
}

type Opts = { nouns: string[]; onRecall?: (noun: string) => void; cites?: Cites; recallOff?: boolean }

function inline(nodes: InlineNode[], o: Opts, claim: { used: boolean }): ReactNode {
  const out: ReactNode[] = []
  let k = 0
  const nounRe = o.onRecall && o.nouns.length ? new RegExp(`(${[...o.nouns].sort((a, b) => b.length - a.length).map(esc).join('|')})`) : null
  const run = (text: string) => {
    for (const piece of o.cites?.re ? text.split(o.cites.re) : [text]) {
      const n = o.cites?.index.get(piece)
      if (n !== undefined) { out.push(<span key={k++}>{piece}<sup className="dcl-cite" aria-label={`source ${n}, ${piece}`}>{n}</sup></span>); continue }
      if (!piece) continue
      if (!nounRe) { out.push(<Fragment key={k++}>{piece}</Fragment>); continue }
      for (const part of piece.split(nounRe)) {
        if (!claim.used && o.nouns.includes(part)) {
          claim.used = true
          out.push(<button type="button" key={k++} className="dcl-recall" data-verb="recall" disabled={o.recallOff}
            aria-label={`Recall what is remembered about ${part}`} onClick={() => o.onRecall?.(part)}>{part}</button>)
        } else if (part) out.push(<Fragment key={k++}>{part}</Fragment>)
      }
    }
  }
  for (const n of nodes) {
    if (n.t === 'strong') out.push(<b key={k++}>{n.v}</b>)
    else if (n.t === 'em') out.push(<em key={k++}>{n.v}</em>)
    else if (n.t === 'code') out.push(<code key={k++}>{n.v}</code>)
    else if (n.t === 'link') out.push(<a key={k++} href={n.href} target="_blank" rel="noreferrer">{n.v}</a>)
    else run(n.v)
  }
  return out
}

export function Markdown({ text, caret, onRecall, cites, recallOff }: {
  text: string
  caret?: boolean
  /** Absent while streaming: a noun is only a key once the answer has landed. */
  onRecall?: (noun: string) => void
  cites?: Cites
  recallOff?: boolean
}) {
  const blocks = parseMarkdown(text)
  const o: Opts = { nouns: onRecall ? extractRecallNouns(text) : [], onRecall, cites, recallOff }
  const mark = caret ? <span className="dcl-caret" aria-hidden="true" /> : null
  if (blocks.length === 0) return <div className="dcl-md">{mark}</div>
  const lastI = blocks.length - 1
  return (
    <div className="dcl-md">
      {blocks.map((b, i) => {
        const end = i === lastI ? mark : null
        const claim = { used: false }
        if (b.t === 'p') return <p key={i}>{inline(b.nodes, o, claim)}{end}</p>
        if (b.t === 'h') return <p key={i} className="dcl-h">{inline(b.nodes, o, claim)}{end}</p>
        if (b.t === 'code') return <pre key={i}><code>{b.text}</code>{end}</pre>
        const items = b.items.map((it, j) => <li key={j}>{inline(it, o, { used: claim.used || j > 0 })}{j === b.items.length - 1 ? end : null}</li>)
        return b.ordered ? <ol key={i}>{items}</ol> : <ul key={i}>{items}</ul>
      })}
    </div>
  )
}
