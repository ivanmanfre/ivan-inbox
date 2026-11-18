// Parse the desk model's tagged answer. Pure and forgiving about whitespace,
// strict about content: anything that is not valid JSON is dropped, never
// guessed at.

export type Act = Record<string, unknown> & { kind: string }
export type Chip = { label: string; send: string }
export type Parsed = { reply: string; actions: Act[]; reads: Act[]; chips: Chip[] }

function block(text: string, tag: string): string | null {
  const m = text.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i'))
  return m ? m[1].trim() : null
}

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

/** Plain-prose guard: no em/en dashes reach Ivan, whatever the model did. */
export function plain(s: string): string {
  return s
    .replace(/\s*[—–]\s*/g, (m, off, str) => {
      // "word — word" -> "word, word"; a dash between digits (ranges) -> "-"
      const prev = str[off - 1] ?? '', next = str[off + m.length] ?? ''
      return /\d/.test(prev) && /\d/.test(next) ? '-' : ', '
    })
    .replace(/,\s*,/g, ',')
    .trim()
}

/** One text per chip (Sol r5 B1): label = send, both the trimmed, capped send text. */
export function oneText(chips: { label?: unknown; send: unknown }[]): Chip[] {
  return chips.map((c) => plain(String(c.send ?? '')).slice(0, 400)).filter(Boolean).map((t) => ({ label: t, send: t }))
}

export function parse(text: string): Parsed {
  let reply = block(text, 'reply')
  if (!reply) {
    // No (or an empty, or an unclosed) reply tag: take everything outside the other blocks.
    reply = text.replace(/<(actions|reads|chips)>[\s\S]*?<\/\1>/gi, '').replace(/<\/?reply>/gi, '').trim()
  }
  // Keys starting with "_" are server-owned (overrides, snapshots, flags): never taken from the model.
  const actions = jsonArray(block(text, 'actions'))
    .filter((a) => typeof a.kind === 'string')
    .map((a) => Object.fromEntries(Object.entries(a).filter(([k]) => !k.startsWith('_')))) as Act[]
  const reads = jsonArray(block(text, 'reads'))
    .filter((a) => typeof a.kind === 'string' && /^read_/.test(a.kind as string)) as Act[]
  // Sol r5 B1: a chip has ONE text. What Ivan sees is exactly what is sent as his message; the model's
  // label is dropped, so a chip can never show one thing and send another.
  const chips = oneText(jsonArray(block(text, 'chips'))
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
    // a list: the heading lines, then one block per bullet (continuation lines stay with their bullet)
    const blocks: string[] = []
    for (const l of lines) {
      if (BULLET.test(l) || !blocks.length) blocks.push(l)
      else blocks[blocks.length - 1] += '\n' + l
    }
    return blocks.filter((b) => b.trim()).map((b) => splitProse(b, max, trigger)).join('\n\n')
  }).join('')
}
