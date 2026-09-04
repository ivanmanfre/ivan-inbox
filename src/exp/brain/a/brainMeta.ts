// brainMeta.ts - pure text for the brain-visibility row under an answer: the
// sources chip label, the basenames it expands to, the grounded-on sentence,
// and the once-per-thread session-state sentence. No component here reads the
// network; they take what useChat/turns.ts already fetched.
import type { TurnSource } from '../../../lib/turns'

/** A path's basename, the only part of a source worth printing on a chip. */
export function sourceBasename(path: string): string {
  const clean = path.replace(/\/+$/, '')
  const slash = clean.lastIndexOf('/')
  return slash >= 0 ? clean.slice(slash + 1) : clean
}

/** "read 3 memory files" / "read 1 memory file" / null when there is nothing to say. */
export function sourcesChipLabel(sources: TurnSource[] | undefined): string | null {
  if (!sources || sources.length === 0) return null
  const n = sources.length
  return `read ${n} memory file${n === 1 ? '' : 's'}`
}

/** What the chip expands to: basenames, deduplicated, in the order they were read. */
export function sourceBasenames(sources: TurnSource[] | undefined): string[] {
  if (!sources) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const s of sources) {
    const b = sourceBasename(s.path)
    if (!seen.has(b)) { seen.add(b); out.push(b) }
  }
  return out
}

/** "Grounded on memory from 2026-09-02" or null when the broker named no date. */
export function groundedOnLine(date: string | null): string | null {
  return date ? `Grounded on memory from ${date}` : null
}

/**
 * The once-per-thread sentence: fresh vs continued. `sessionStartedAt` is the
 * THREAD's own flag (null until the container has held a session for it at
 * least once) - this is what decides whether the NEXT turn replays context,
 * so it is the honest source for "fresh vs continued", not a per-turn guess.
 */
export function sessionStateLine(sessionStartedAt: string | null): string {
  return sessionStartedAt
    ? 'Continuing this conversation. Claude has the thread so far.'
    : 'A fresh conversation. Nothing carries over until the first reply lands.'
}
