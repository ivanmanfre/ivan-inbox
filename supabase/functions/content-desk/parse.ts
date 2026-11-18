// Parse the desk model's tagged answer. Pure and forgiving about whitespace,
// strict about content: anything that is not valid JSON is dropped, never
// guessed at.

export type Act = Record<string, unknown> & { kind: string }
export type Chip = { label: string; send: string }
export type Parsed = { reply: string; actions: Act[]; reads: Act[]; chips: Chip[] }

function jsonArray(raw: string | null): Record<string, unknown>[] {
  if (!raw) return []
  try {
    const v = JSON.parse(raw)
    const arr = Array.isArray(v) ? v : [v]
    return arr.filter((x) => x && typeof x === 'object' && !Array.isArray(x))
  } catch {
    return []
  }
}

// A COMPLETE quoted span on one line ("..." or curly quotes) is protected: his or a post's words stay
// exactly as written. An unmatched opening quote protects nothing (Sol r8 #8).
const QUOTED = /("[^"\n]*"|\u201c[^\u201d\n]*\u201d)/

function outsideQuotes(text: string, fn: (s: string) => string): string {
  return text.split(QUOTED).map((part, i) => (i % 2 === 1 ? part : fn(part))).join('')
}

function dashFix(s: string): string {
  return s
    .replace(/\s*[—–]\s*/g, (m, off, str) => {
      // "word — word" -> "word, word"; a dash between digits (ranges) -> "-"
      const prev = str[off - 1] ?? '', next = str[off + m.length] ?? ''
      return /\d/.test(prev) && /\d/.test(next) ? '-' : ', '
    })
    .replace(/,\s*,/g, ',')
}

/** Plain-prose guard: no em/en dashes reach Ivan, never edited inside a complete quoted span. */
export function plain(s: string, keepEdges = false): string {
  const out = outsideQuotes(s, dashFix)
  // a streamed piece keeps its edge spaces (trimming each delta would glue words together)
  return keepEdges ? out : out.trim()
}

function stripHandlesIn(part: string, hs: Set<string>): string {
  return part.replace(/\(?\b([Ll]\d{1,2})\b\)?(,[ \t]*|[ \t]+)?/g, (m, h: string, tail?: string) => {
    if (!hs.has(h.toUpperCase())) return m
    return m.startsWith('(') && m.includes(')') ? (tail ?? '') : ''
  }).replace(/[ \t]{2,}/g, ' ').replace(/ +([,.!?])/g, '$1')
}

/** Call-line handles (L1..L12, any case) out of the reply text, outside complete quoted spans only. */
export function stripLineHandles(text: string, handles: Iterable<string>): string {
  const hs = new Set([...handles].map((h) => h.toUpperCase()))
  return hs.size ? outsideQuotes(text, (p) => stripHandlesIn(p, hs)) : text
}

/**
 * The ONE sanitizer for every text Ivan sees from the model (Sol r8 #8): deltas, the streaming row and
 * the final body. Outside complete quoted spans: no em/en dashes, no call-line handles. Inside: untouched.
 */
export function sanitize(text: string, handles: Iterable<string>, keepEdges = false): string {
  const hs = new Set([...handles].map((h) => h.toUpperCase()))
  const out = outsideQuotes(text, (p) => (hs.size ? stripHandlesIn(dashFix(p), hs) : dashFix(p)))
  return keepEdges ? out : out.trim()
}

// tool tags the model may open: a block left unclosed is dropped from its open tag to the end (Sol r8 #6)
const TOOL_OPEN = /<\/?(?:actions|reads|chips|tool[\w-]*|function[\w-]*|invoke|antml[\w:-]*)\b/i

/** The displayable text of a model answer, by the one scanner: the top-level reply, else the loose text. */
export function dropToolBlocks(text: string): string {
  const sc = scan(text)
  return (sc.reply ?? '').trim() ? (sc.reply ?? '') : sc.loose
}

/**
 * The sanitizer for a stream of deltas (Sol r7 #8, r8 #6, #8). Released text is always sanitize() of
 * a prefix that ends:
 * - at whitespace at least 6 characters before the newest text (a handle split across deltas is
 *   never shown),
 * - before an opening quote that is not closed yet (its span may still become protected),
 * - before a "<" that is not closed by ">" yet, and for good at an open tool tag (nothing after it
 *   is ever released).
 * If a later sanitize would rewrite text already shown, nothing more is released; the final body
 * (sanitized in full) replaces the streamed text.
 */
export class HandleStream {
  private acc = ''
  private sent = ''
  private frozen = -1
  private readonly hs: string[]
  constructor(handles: Iterable<string>) { this.hs = [...handles] }
  push(t: string): string {
    this.acc += t
    return this.release(this.safeEnd(false))
  }
  flush(): string { return this.release(this.safeEnd(true)) }
  private safeEnd(final: boolean): number {
    const tool = this.acc.search(TOOL_OPEN)
    if (tool >= 0 && (this.frozen < 0 || tool < this.frozen)) this.frozen = tool
    let end = this.frozen >= 0 ? this.frozen : this.acc.length
    if (final) return end
    const lt = this.acc.lastIndexOf('<', end - 1)
    if (lt >= 0 && this.acc.indexOf('>', lt) < 0) end = lt
    // an opening quote not yet closed on the current line (spans never cross a line): hold back from it
    const lineStart = this.acc.lastIndexOf('\n', end - 1) + 1
    const line = this.acc.slice(lineStart, end)
    if ((line.split('"').length - 1) % 2 === 1) end = lineStart + line.lastIndexOf('"')
    const lo = line.lastIndexOf('\u201c')
    if (lo >= 0 && line.indexOf('\u201d', lo) < 0) end = Math.min(end, lineStart + lo)
    let cut = -1
    for (let i = Math.min(end, this.acc.length - 7); i >= 0; i--) if (/\s/.test(this.acc[i])) { cut = i; break }
    cut = Math.min(end, cut)
    // a cut inside a complete quoted span moves back to its opening quote (the span is released whole)
    for (const m of this.acc.slice(0, end).matchAll(new RegExp(QUOTED.source, 'g'))) {
      if (m.index! < cut && cut < m.index! + m[0].length) { cut = m.index!; break }
    }
    return cut
  }
  private release(end: number): string {
    if (end <= 0) return ''
    const clean = sanitize(this.acc.slice(0, end), this.hs, true)
    if (!clean.startsWith(this.sent)) return ''
    const out = clean.slice(this.sent.length)
    this.sent = clean
    return out
  }
}

/** One text per chip (Sol r5 B1): label = send, both the trimmed, capped send text. */
export function oneText(chips: { label?: unknown; send: unknown }[]): Chip[] {
  return chips.map((c) => plain(String(c.send ?? '')).slice(0, 400)).filter(Boolean).map((t) => ({ label: t, send: t }))
}

const TOOL_BLOCK = new Set(['actions', 'reads', 'chips'])
const OTHER_TOOL = /^(?:tool[\w-]*|function[\w-]*|invoke|antml[\w:-]*)$/i

export type Scan = {
  /** the first top-level <reply> block's text (to its closer, a tool opener, or the end), null if none */
  reply: string | null
  /** top-level text outside every block (the fallback reply) */
  loose: string
  actions: string | null; reads: string | null; chips: string | null
  /** the name of the first top-level opener (e.g. 'actions' when the model acts first) */
  first: string | null
  /** an unclosed tool opener cut the rest */
  cut: boolean
}

/**
 * The ONE depth-aware scanner for the stream and the buffered paths (Sol r9 #2). Only top-level
 * blocks count. Inside a tool block (actions, reads, chips) only its own closer counts: a tag in
 * its JSON never opens anything. A <reply> ends at its closer or at the first tool opener. After an
 * unclosed tool opener (any tool tag), everything to the end is discarded.
 */
/**
 * Where the block opened at `from` closes (Sol r10 #5), or -1. A typed tool block (actions, reads,
 * chips) holds JSON: its closer counts only outside JSON strings (quotes and backslash escapes are
 * honoured), so "</actions>" or "<reply>" inside a string never ends or opens anything. Any other tool
 * tag counts nesting depth of its own name.
 */
function closerOf(text: string, from: number, name: string, json: boolean): { at: number; end: number } | null {
  // offsets on the ORIGINAL buffer: a case-insensitive sticky match at each position, never a lowercased
  // copy (a length-changing case map would shift them). A closer counts only as a syntactically valid
  // closing tag for exactly this name: "</name>" with optional whitespace before ">" (Sol r12 #8).
  const safe = name.replace(/[^\w:-]/g, '')
  const close = new RegExp(`</${safe}\\s*>`, 'iy')
  if (json) {
    let inStr = false
    for (let i = from; i < text.length; i++) {
      const ch = text[i]
      if (inStr) { if (ch === '\\') i++; else if (ch === '"') inStr = false; continue }
      if (ch === '"') { inStr = true; continue }
      if (ch === '<') { close.lastIndex = i; const m = close.exec(text); if (m) return { at: i, end: i + m[0].length } }
    }
    return null
  }
  // other tool tags: nesting depth of this exact name; an opener is "<name" + whitespace, "/" or ">"
  const open = new RegExp(`<${safe}(?=[\\s/>])[^<>]*>`, 'iy')
  let depth = 1
  for (let i = from; i < text.length; i++) {
    if (text[i] !== '<') continue
    close.lastIndex = i
    const c = close.exec(text)
    if (c) { if (--depth === 0) return { at: i, end: i + c[0].length }; i += c[0].length - 1; continue }
    open.lastIndex = i
    const o = open.exec(text)
    if (o && !o[0].endsWith('/>')) { depth++; i += o[0].length - 1 }
  }
  return null
}

export function scan(text: string): Scan {
  const out: Scan = { reply: null, loose: '', actions: null, reads: null, chips: null, first: null, cut: false }
  const TAG = /<(\/?)([A-Za-z][\w:-]*)[^<>]*>/g
  let pos = 0
  let inReply = false, replyStart = 0, replyDone = false
  for (;;) {
    TAG.lastIndex = pos
    const m = TAG.exec(text)
    if (!m) break
    const [whole, slash, rawName] = m
    const name = rawName.toLowerCase()
    const isTool = TOOL_BLOCK.has(name) || OTHER_TOOL.test(name)
    if (inReply) {
      // the reply closes only on a valid closing tag, the same exact syntax as the tool tags: "</reply>"
      // with optional whitespace before ">" ("</reply/typo>" is text) (Sol r13 #7)
      if (slash && name === 'reply' && /^<\/reply\s*>$/i.test(whole)) { out.reply = text.slice(replyStart, m.index); inReply = false; replyDone = true; pos = m.index + whole.length; continue }
      if (!slash && isTool) { out.reply = text.slice(replyStart, m.index); inReply = false; replyDone = true }
      else { pos = m.index + whole.length; continue }
    } else if (!slash || !isTool) {
      out.loose += text.slice(pos, m.index)
    }
    if (slash) { pos = m.index + whole.length; continue }
    if (name === 'reply') {
      if (!out.first) out.first = 'reply'
      if (!replyDone && out.reply == null) { inReply = true; replyStart = m.index + whole.length }
      pos = m.index + whole.length
      continue
    }
    if (isTool) {
      if (!out.first) out.first = name
      const closer = closerOf(text, m.index + whole.length, name, TOOL_BLOCK.has(name))
      if (!closer) { out.cut = true; return out }   // unclosed tool opener: nothing after it counts
      const body = text.slice(m.index + whole.length, closer.at)
      if (name === 'actions' && out.actions == null) out.actions = body
      if (name === 'reads' && out.reads == null) out.reads = body
      if (name === 'chips' && out.chips == null) out.chips = body
      pos = closer.end   // past the WHOLE matched closing tag
      continue
    }
    // any other tag is text
    out.loose += whole
    pos = m.index + whole.length
  }
  if (inReply) out.reply = text.slice(replyStart)
  else out.loose += text.slice(pos)
  return out
}

export function parse(text: string): Parsed {
  const sc = scan(text)
  const reply = ((sc.reply ?? '').trim() || sc.loose).trim()
  // Keys starting with "_" are server-owned (overrides, snapshots, flags): never taken from the model.
  const actions = jsonArray(sc.actions?.trim() ?? null)
    .filter((a) => typeof a.kind === 'string')
    .map((a) => Object.fromEntries(Object.entries(a).filter(([k]) => !k.startsWith('_')))) as Act[]
  const reads = jsonArray(sc.reads?.trim() ?? null)
    .filter((a) => typeof a.kind === 'string' && /^read_/.test(a.kind as string)) as Act[]
  // Sol r5 B1: a chip has ONE text. What Ivan sees is exactly what is sent as his message; the model's
  // label is dropped, so a chip can never show one thing and send another.
  const chips = oneText(jsonArray(sc.chips?.trim() ?? null)
    .filter((c) => typeof c.send === 'string' && c.send.trim())
    .slice(0, 3) as { send: string }[])
  return { reply: plain(reply), actions, reads, chips }
}

/**
 * Keep desk prose in short blocks (eval G4: no blank-line block of 40+ words). Run on the FINAL body.
 * - A list paragraph is exploded: its heading and each bullet (with its continuation lines) become
 *   their own blocks, a blank line between each (eval E4).
 * - Any block of 35+ words is split at sentence ends into blocks of at most ~30 words.
 * A sentence end is [.!?] (optionally closed by a quote or bracket), then whitespace, then an
 * uppercase letter, a digit or a quote, and the word before the period is not a common abbreviation
 * (Dr, Mr, Mrs, Ms, St, vs, e.g, i.e, etc, No). Nothing else is a cut point, so a number (1.5x) or a
 * URL never splits, and the text between cuts is kept byte for byte: the only change is the
 * whitespace at a chosen cut becoming a blank line (Sol r4 #9, r5 B9).
 */
const SENTENCE_END = /[.!?]+["'\u201d\u2019)\]]*(\s+)(?=[\p{Lu}\p{N}"'\u201c\u2018])/gu
const ABBREV = new Set(['dr', 'mr', 'mrs', 'ms', 'st', 'vs', 'e.g', 'i.e', 'etc', 'no'])
const BULLET = /^\s*([-•→*]|\d+[.)])\s/

function splitProse(para: string, max: number, trigger: number): string {
  const words = (s: string) => (s.match(/\S+/g) ?? []).length
  if (words(para) < trigger) return para
  const cuts: [number, number][] = []
  for (const m of para.matchAll(SENTENCE_END)) {
    if (m[0].startsWith('.') && !m[0].startsWith('..')) {
      const prev = (para.slice(0, m.index!).match(/(\S+)$/)?.[1] ?? '').replace(/^["'(\[\u201c\u2018]+/, '').toLowerCase()
      if (ABBREV.has(prev)) continue
    }
    const end = m.index! + m[0].length
    cuts.push([end - m[1].length, end])
  }
  let out = '', from = 0, n = 0
  for (const [ws, next] of cuts) {
    const w = words(para.slice(from, ws))
    if (n > 0 && n + w > max) { out = out.trimEnd() + '\n\n'; n = 0 }
    out += para.slice(from, next)
    n += w
    from = next
  }
  const w = words(para.slice(from))
  if (n > 0 && n + w > max) out = out.trimEnd() + '\n\n'
  return out + para.slice(from)
}

export function shortParagraphs(text: string, max = 30, trigger = 35): string {
  return text.split(/(\n\s*\n)/).map((para, i) => {
    if (i % 2 === 1) return para   // the original blank-line separators stay as they were
    const lines = para.split('\n')
    if (!lines.some((l) => BULLET.test(l))) return splitProse(para, max, trigger)
    // a numbered list stays ONE block, so the renderer never restarts its count (Sol r11 #3)
    if (lines.filter((l) => l.trim()).every((l) => /^\s*\d+[.)]\s/.test(l))) return para
    // a list: the heading lines, then one block per bullet (continuation lines stay with their bullet)
    const blocks: string[] = []
    for (const l of lines) {
      if (BULLET.test(l) || !blocks.length) blocks.push(l)
      else blocks[blocks.length - 1] += '\n' + l
    }
    return blocks.filter((b) => b.trim()).map((b) => splitProse(b, max, trigger)).join('\n\n')
  }).join('')
}
