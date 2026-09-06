/* ==========================================================================
   src/wb/sales/md.ts — the two block kinds the chat parser does not have.

   D7. `parseMarkdown` in `src/exp/v2c/chat/renderer.ts` was written for what
   Claude streams into a chat pane: paragraphs, headings, lists, fenced code.
   The three sales documents are hand-written briefs, and they lead with pipe
   tables and pull quotes — the two shapes that parser drops to plain text.

   Rather than widen the chat parser (Ask is not in this run's scope, and a
   streaming parser has a different failure mode than a static one), this file
   LIFTS those two shapes out of the source and hands the remainder back in
   order. The result is a flat list the renderer walks once: a table, a quote,
   or a run of text that goes to `parseMarkdown` unchanged.

   Escaped pipes (`\|`) inside a cell are honoured, because a table cell in
   these documents routinely quotes a regex or an either/or.
   ========================================================================== */

export type MdChunk =
  | { t: 'table'; head: string[]; rows: string[][] }
  | { t: 'quote'; text: string }
  | { t: 'md'; text: string }

/** An unescaped `|` anywhere in the line: the cheapest table-row candidate. */
function hasPipe(line: string): boolean {
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '\\') { i++; continue }
    if (line[i] === '|') return true
  }
  return false
}

/** `|---|:--:|` and friends. At least one dash, nothing but the table alphabet. */
function isSeparator(line: string): boolean {
  const s = line.trim()
  if (s === '' || !s.includes('-') || !s.includes('|')) return false
  return /^[|\s:-]+$/.test(s)
}

/** Split one row into cells, dropping the optional outer pipes, `\|` kept as `|`. */
export function splitCells(line: string): string[] {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1)
  const out: string[] = []
  let buf = ''
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '\\' && s[i + 1] === '|') { buf += '|'; i++; continue }
    if (c === '|') { out.push(buf.trim()); buf = ''; continue }
    buf += c
  }
  out.push(buf.trim())
  return out
}

/**
 * Lift pipe tables and `>` blockquotes out of `src`; everything else is passed
 * through as `md` text, in document order, for `parseMarkdown` to handle.
 */
export function splitBlocks(src: string): MdChunk[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n')
  const out: MdChunk[] = []
  let plain: string[] = []
  const flush = () => {
    const text = plain.join('\n')
    if (text.trim() !== '') out.push({ t: 'md', text })
    plain = []
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // A fence is opaque: a `|` or a `>` inside it is code, not a table.
    if (/^\s*```/.test(line)) {
      plain.push(line)
      for (i++; i < lines.length; i++) {
        plain.push(lines[i])
        if (/^\s*```/.test(lines[i])) break
      }
      continue
    }

    if (hasPipe(line) && line.trim() !== '' && isSeparator(lines[i + 1] ?? '')) {
      flush()
      const head = splitCells(line)
      const rows: string[][] = []
      for (i += 2; i < lines.length; i++) {
        const r = lines[i]
        if (r.trim() === '' || !hasPipe(r)) { i--; break }
        rows.push(splitCells(r))
      }
      out.push({ t: 'table', head, rows })
      continue
    }

    if (/^\s*>/.test(line)) {
      flush()
      const body: string[] = []
      for (; i < lines.length && /^\s*>/.test(lines[i]); i++) {
        body.push(lines[i].replace(/^\s*>\s?/, ''))
      }
      i--
      out.push({ t: 'quote', text: body.join('\n').trim() })
      continue
    }

    plain.push(line)
  }
  flush()
  return out
}
