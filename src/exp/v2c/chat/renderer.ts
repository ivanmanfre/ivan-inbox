// A markdown SUBSET, parsed to data — never to an HTML string.
//
// Phase 1 §2.6 cut the reference UI's five-package markdown stack (marked,
// dompurify, highlight.js, katex, mermaid). The reason dompurify is in that
// stack at all is that marked emits HTML which then needs dangerouslySetInnerHTML;
// parsing straight to typed nodes that React renders as elements removes the
// injection surface instead of sanitising it, and keeps the dependency count at
// react + supabase-js.
//
// What is covered, because it is what Claude actually writes about a TypeScript
// app: paragraphs, headings, bullet/numbered lists, fenced code, inline code,
// bold, italic, and bare URLs. Everything else degrades to plain text rather
// than to a parse error — an unclosed fence at the end of a STREAM is the normal
// case, not a malformed document.
//
// One deliberate departure from the phase 1 spec: it proposed a scoped monospace
// exception for code blocks. The build contract locks "no monospace anywhere" as
// non-negotiable, so code blocks render in the system stack with tabular numerals
// and preserved whitespace instead. Alignment inside a chat snippet is worth less
// than the locked type system.

export type InlineNode =
  | { t: 'text'; v: string }
  | { t: 'code'; v: string }
  | { t: 'strong'; v: string }
  | { t: 'em'; v: string }
  | { t: 'link'; v: string; href: string }

export type Block =
  | { t: 'p'; nodes: InlineNode[] }
  | { t: 'h'; level: number; nodes: InlineNode[] }
  | { t: 'ul'; ordered: boolean; items: InlineNode[][] }
  | { t: 'code'; lang: string | null; text: string; open: boolean }

const URL_RE = /https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"]/g

// Inline scan, single pass, longest-marker-first so `**bold**` never reads as two
// `*em*`. Unterminated markers stay literal — mid-stream text ends inside one
// constantly and flickering formatting is worse than late formatting.
export function parseInline(src: string): InlineNode[] {
  const out: InlineNode[] = []
  let buf = ''
  const flush = () => {
    if (!buf) return
    // Autolink inside the plain runs only, so a URL inside `code` stays literal.
    let last = 0
    for (const m of buf.matchAll(URL_RE)) {
      const at = m.index ?? 0
      if (at > last) out.push({ t: 'text', v: buf.slice(last, at) })
      out.push({ t: 'link', v: m[0], href: m[0] })
      last = at + m[0].length
    }
    if (last < buf.length) out.push({ t: 'text', v: buf.slice(last) })
    buf = ''
  }
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (c === '`') {
      const end = src.indexOf('`', i + 1)
      if (end > i + 1) {
        flush()
        out.push({ t: 'code', v: src.slice(i + 1, end) })
        i = end + 1
        continue
      }
    } else if (c === '*' || c === '_') {
      const double = src[i + 1] === c
      const marker = double ? c + c : c
      const end = src.indexOf(marker, i + marker.length)
      if (end > i + marker.length) {
        const inner = src.slice(i + marker.length, end)
        if (inner.trim()) {
          flush()
          out.push({ t: double ? 'strong' : 'em', v: inner })
          i = end + marker.length
          continue
        }
      }
    }
    buf += c
    i++
  }
  flush()
  return out
}

export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n')
  const out: Block[] = []
  let para: string[] = []
  let list: { ordered: boolean; items: string[] } | null = null

  const closePara = () => {
    if (para.length === 0) return
    out.push({ t: 'p', nodes: parseInline(para.join(' ').trim()) })
    para = []
  }
  const closeList = () => {
    if (!list) return
    out.push({ t: 'ul', ordered: list.ordered, items: list.items.map(parseInline) })
    list = null
  }
  const closeAll = () => { closePara(); closeList() }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const fence = line.match(/^\s*```\s*([\w+-]*)\s*$/)
    if (fence) {
      closeAll()
      const lang = fence[1] || null
      const body: string[] = []
      let closed = false
      i++
      for (; i < lines.length; i++) {
        if (/^\s*```/.test(lines[i])) { closed = true; break }
        body.push(lines[i])
      }
      // `open` is what tells the view a fence is still streaming, so it can show
      // the block filling in instead of nothing at all.
      out.push({ t: 'code', lang, text: body.join('\n'), open: !closed })
      continue
    }
    if (!line.trim()) { closeAll(); continue }
    const h = line.match(/^(#{1,4})\s+(.*)$/)
    if (h) {
      closeAll()
      out.push({ t: 'h', level: h[1].length, nodes: parseInline(h[2].trim()) })
      continue
    }
    const bullet = line.match(/^\s*[-*+]\s+(.*)$/)
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/)
    if (bullet || numbered) {
      closePara()
      const ordered = !bullet
      const text = (bullet ?? numbered)![1]
      if (list && list.ordered !== ordered) closeList()
      if (!list) list = { ordered, items: [] }
      list.items.push(text)
      continue
    }
    // A plain line directly under a bullet continues that bullet, which is how
    // wrapped list items arrive.
    if (list) { list.items[list.items.length - 1] += ` ${line.trim()}`; continue }
    para.push(line.trim())
  }
  closeAll()
  return out
}

// Rough prose length, used by the pane to decide whether a turn needs a
// "jump to newest" affordance. Cheap, and never a reason to re-parse.
export function blockWords(blocks: Block[]): number {
  let n = 0
  for (const b of blocks) {
    if (b.t === 'code') n += b.text.split(/\s+/).filter(Boolean).length
    else if (b.t === 'ul') n += b.items.flat().reduce((s, x) => s + x.v.split(/\s+/).length, 0)
    else n += b.nodes.reduce((s, x) => s + x.v.split(/\s+/).length, 0)
  }
  return n
}
