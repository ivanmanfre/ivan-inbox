/* =========================================================================
   Direction B - the answer's prose.

   Copied from `src/exp/brain/b/skins/b/AskThread.tsx` (renderInline /
   AnswerBody) and rebuilt on the design system. The parse, the recall noun
   extraction and the one-control-per-block cap are byte-for-byte the source's;
   only the elements and the classes changed, plus two direction-B moves:

   - MOVE 10. While a stream is open the answer reveals WORD BY WORD as a fade
     (`Words`), and a cursor rides the tail (`tail`). The data path is
     untouched: this still renders `chat.streamText` exactly as it arrives, one
     span per word, each span mounting once so a word never re-animates.
   - MOVE 12. Citations are small numbered marks INLINE at the end of the last
     prose block (`tail`), never a list at the bottom.

   No unicode glyph is typed in this file: every non-ASCII character the source
   printed is written as an escape so the census reads ASCII and the reader
   still sees the same string.
   ========================================================================= */
import type { ReactNode } from 'react'
import { parseMarkdown, type InlineNode } from '../../../exp/v2c/chat/renderer'
import { extractRecallNouns } from '../../../exp/brain/b/recall'

/** The bullet the source prints. Written as an escape, rendered identically. */
const BULLET = '\u00b7'

/**
 * One plain-text run, split into words. Each word is its own span so the fade
 * runs once, on mount, per word: an already-revealed word keeps its index and
 * therefore its element, so a stream tick never restarts an animation that has
 * already played. Whitespace stays a span too, so the indices stay stable.
 */
export function Words({ text }: { text: string }) {
  const parts = text.split(/(\s+)/)
  return (
    <>
      {parts.map((p, i) => (
        p === '' ? null
          : /^\s+$/.test(p)
            ? <span key={i}>{p}</span>
            : <span className="dirb-ask-w" key={i}>{p}</span>
      ))}
    </>
  )
}

/**
 * Every plain-text run, split on recall nouns, with the FIRST unclaimed noun in
 * each block turned into a real control. Code, bold spans and existing links
 * pass through untouched: recall reads off narrative prose, not off something
 * already marked up.
 *
 * One control per block is a deliberate cap. It keeps the prose from becoming a
 * field of underlines, and it keeps two 44px hit zones from stacking on
 * consecutive lines, where the lower one would swallow the upper one's bottom
 * edge (`elementFromPoint` returns whichever positioned overlay painted last).
 */
function renderInline(
  nodes: InlineNode[],
  nouns: string[],
  onRecall: (noun: string) => void,
  claim: { used: boolean },
  reveal: boolean,
): ReactNode[] {
  const out: ReactNode[] = []
  let key = 0
  const sorted = [...nouns].sort((a, b) => b.length - a.length)
  const re = sorted.length
    ? new RegExp(`(${sorted.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`)
    : null
  const plain = (v: string, k: number): ReactNode =>
    reveal ? <Words text={v} key={k} /> : <span key={k}>{v}</span>
  for (const n of nodes) {
    if (n.t === 'code') { out.push(<code className="dirb-ask-ic" key={key++}>{n.v}</code>); continue }
    if (n.t === 'strong') { out.push(<b key={key++}>{n.v}</b>); continue }
    // Emphasis without italics: the house canon retired italic body outright,
    // so the model's `*emphasis*` lands as a weight step instead of a slant.
    if (n.t === 'em') { out.push(<em className="dirb-ask-em" key={key++}>{n.v}</em>); continue }
    if (n.t === 'link') { out.push(<a className="dirb-ask-link" href={n.href} target="_blank" rel="noreferrer" key={key++}>{n.v}</a>); continue }
    if (!re) { out.push(plain(n.v, key++)); continue }
    const parts = n.v.split(re)
    for (const part of parts) {
      if (!claim.used && nouns.includes(part)) {
        claim.used = true
        out.push(
          <button
            type="button" className="dirb-ask-recall" data-recall data-noun={part} data-tap key={key++}
            aria-label={`Recall what is remembered about ${part}`}
            onClick={() => onRecall(part)}
          >{part}</button>,
        )
      } else if (part) {
        out.push(plain(part, key++))
      }
    }
  }
  return out
}

export function AnswerBody({ text, onRecall, reveal = false, tail }: {
  text: string
  onRecall: (noun: string) => void
  /** Move 10: reveal each word as it arrives. Set only while a stream is open. */
  reveal?: boolean
  /** Move 12 / Move 10: the citation marks, or the streaming cursor, placed
   * inline at the end of the last prose block rather than under the answer. */
  tail?: ReactNode
}) {
  const nouns = extractRecallNouns(text)
  const blocks = parseMarkdown(text)
  let lastProse = -1
  blocks.forEach((b, i) => { if (b.t === 'p') lastProse = i })
  return (
    <div className="dirb-ask-prose">
      {blocks.map((b, i) => {
        const claim = { used: false }
        if (b.t === 'code') {
          return (
            <pre className="dirb-ask-code" data-open={b.open ? 'true' : 'false'} key={i}>
              {b.lang && <span className="dirb-ask-code-l">{b.lang}</span>}
              <code>{b.text}</code>
            </pre>
          )
        }
        if (b.t === 'h') return <div className={`dirb-ask-h ds-t-title h${b.level}`} key={i}>{renderInline(b.nodes, nouns, onRecall, claim, reveal)}</div>
        if (b.t === 'ul') {
          return (
            <ul className="dirb-ask-ul" data-ordered={b.ordered ? 'true' : 'false'} key={i}>
              {b.items.map((it, j) => (
                <li key={j}>
                  <span className="dirb-ask-li-m">{b.ordered ? `${j + 1}.` : BULLET}</span>
                  <span>{renderInline(it, nouns, onRecall, { used: claim.used || j > 0 }, reveal)}</span>
                </li>
              ))}
            </ul>
          )
        }
        return (
          <p className="dirb-ask-p" key={i}>
            {renderInline(b.nodes, nouns, onRecall, claim, reveal)}
            {i === lastProse ? tail : null}
          </p>
        )
      })}
      {tail && lastProse < 0 ? <p className="dirb-ask-p">{tail}</p> : null}
    </div>
  )
}
