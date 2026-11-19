// Post cards for an answer (2026-11-19). The desk names a post by its first words in quotes (DESK_RULES), so
// each quoted span is matched against the first lines of the drafts the brief handed out. A span that names
// exactly one draft becomes a card the app can open (#exp/d/content?draft=<id>); anything else gets no card.
// Display only: a card never acts, and its text is the draft's own first line, never the model's words.
import type { Draft } from './brief.ts'

export type DraftCard = { handle: string; id: string; first_line: string; status: string; scheduled_at: string | null }

const MAX_CARDS = 6

export function normQuote(s: string): string {
  return s.normalize('NFKC').toLowerCase()
    .replace(/[‘’ʼ]/g, "'")
    .replace(/(\.\.\.|…)\s*$/u, '')
    .replace(/[^\p{L}\p{N}' ]+/gu, ' ')
    .replace(/\s+/g, ' ').trim()
}

/** The quoted spans of a text, in order: straight or curly double quotes, one line each. */
export function quotedSpans(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(/"([^"\n]{4,240})"|“([^”\n]{4,240})”/g)) out.push(m[1] ?? m[2])
  return out
}

/** The drafts an answer names, as cards: one per draft, in the order the answer names them. */
export function draftCards(reply: string, drafts: Map<string, Draft>): DraftCard[] {
  const pool = [...drafts.entries()].map(([handle, d]) => ({ handle, d, n: normQuote(d.first_line ?? '') })).filter((x) => x.n)
  const out: DraftCard[] = []
  const seen = new Set<string>()
  for (const span of quotedSpans(reply)) {
    const q = normQuote(span)
    // a few words at least: a short quote ("today") would name half the list
    if (q.length < 12 && q.split(' ').length < 3) continue
    let hits = pool.filter((x) => x.n.startsWith(q))
    if (!hits.length && q.split(' ').length >= 5) hits = pool.filter((x) => x.n.includes(q))
    if (hits.length !== 1) continue
    const { handle, d } = hits[0]
    if (seen.has(d.id)) continue
    seen.add(d.id)
    out.push({ handle, id: d.id, first_line: d.first_line, status: d.status, scheduled_at: d.status === 'published' ? (d.published_at ?? d.scheduled_at) : d.scheduled_at })
    if (out.length >= MAX_CARDS) break
  }
  return out
}
