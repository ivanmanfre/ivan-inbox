/* ==========================================================================
   src/wb/sales/Markdown.tsx — the three written documents, on the type system.

   The call sheet, the audience audit and the asset ideas are markdown files
   written on the Mac. They are read on a phone, in the two minutes before a
   call, so the register is the app's own reading register and not a generic
   markdown theme: `a-page-t` / `a-title-t` / `a-eyebrow` for the three heading
   levels, `a-body-t` for prose, the ds table for a table, `a-quote` for a
   pull quote. Nothing here invents a size, a colour or a radius.

   `splitBlocks` (md.ts, D7) lifts the tables and the quotes; everything else
   is handed to the chat parser exactly as it arrived, so a fix there reaches
   this surface for free and this surface never forks it.

   Links open in a new tab with `rel="noopener noreferrer"`: every URL in these
   documents points off the app, and a document rendered from the database is
   never allowed to reach back through `window.opener`.
   ========================================================================== */
import { Fragment, type ReactNode } from 'react'
import { Table } from '../../ds'
import { parseInline, parseMarkdown, type Block, type InlineNode } from '../../exp/v2c/chat/renderer'
import { splitBlocks } from './md'
import './pack.css'

/** `renderer.ts` parses inline nodes but ships no renderer for them; this is it. */
function renderInline(nodes: InlineNode[]): ReactNode {
  return nodes.map((n, i) => {
    if (n.t === 'strong') return <strong key={i}>{n.v}</strong>
    if (n.t === 'em') return <em key={i}>{n.v}</em>
    if (n.t === 'code') return <code key={i} className="a-mono a-pk-code">{n.v}</code>
    if (n.t === 'link') {
      return (
        <a key={i} className="a-link" href={n.href} target="_blank" rel="noopener noreferrer">{n.v}</a>
      )
    }
    return <Fragment key={i}>{n.v}</Fragment>
  })
}

function renderBlock(b: Block, key: string): ReactNode {
  if (b.t === 'h') {
    if (b.level <= 1) return <h3 key={key} className="a-page-t a-pk-h">{renderInline(b.nodes)}</h3>
    if (b.level === 2) return <h4 key={key} className="a-title-t a-pk-h">{renderInline(b.nodes)}</h4>
    return <h5 key={key} className="a-eyebrow a-pk-h">{renderInline(b.nodes)}</h5>
  }
  if (b.t === 'code') return <pre key={key} className="a-pre a-mono a-pk-pre">{b.text}</pre>
  if (b.t === 'ul') {
    const items = b.items.map((it, i) => <li key={i} className="a-body-t">{renderInline(it)}</li>)
    return b.ordered
      ? <ol key={key} className="a-pk-list">{items}</ol>
      : <ul key={key} className="a-pk-list">{items}</ul>
  }
  return <p key={key} className="a-body-t a-pk-p">{renderInline(b.nodes)}</p>
}

/** A lifted pipe table, on the ds table (its wrapper already scrolls at 390). */
function MdTable({ head, rows, label }: { head: string[]; rows: string[][]; label: string }) {
  const columns = head.map((h, i) => ({
    id: `c${i}`,
    header: h,
    // Through the inline tokeniser, not raw: these documents put their numbers
    // in bold INSIDE the table ("**23,948**"), and a cell that printed the
    // asterisks was the one thing on the audit page that read as unfinished.
    cell: (row: string[]) => <span className="a-pre">{renderInline(parseInline(row[i] ?? ''))}</span>,
  }))
  return (
    <Table
      className="a-pk-table"
      columns={columns}
      rows={rows}
      rowKey={row => row.join('|')}
      label={label}
    />
  )
}

export function Markdown({ src, label = 'Document' }: { src: string; label?: string }) {
  const chunks = splitBlocks(src)
  return (
    <div className="a-pk-md">
      {chunks.map((c, i) => {
        if (c.t === 'table') return <MdTable key={i} head={c.head} rows={c.rows} label={`${label} table`} />
        if (c.t === 'quote') return <blockquote key={i} className="a-quote a-pk-quote">{c.text}</blockquote>
        return <Fragment key={i}>{parseMarkdown(c.text).map((b, j) => renderBlock(b, `${i}-${j}`))}</Fragment>
      })}
    </div>
  )
}
