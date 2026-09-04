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
 * The once-per-thread sentence: fresh vs continued, and it has to agree with
 * BOTH facts the app holds.
 *
 * `grounding.session` is the LAST turn's own flag: 'resumed' means the
 * container already had this thread's conversation in hand. `sessionStartedAt`
 * is the THREAD's flag, written when a turn lands, and it is what decides
 * whether the NEXT turn replays context. Either one saying "continued" is
 * enough to say it, because both are read from the row rather than guessed.
 * With no turns at all there is nothing to continue, and the sentence says so
 * rather than claiming a state the thread has not reached.
 */
export function sessionStateLine(
  sessionStartedAt: string | null,
  groundingSession?: 'new' | 'resumed' | null,
  hasTurns = true,
): string {
  if (groundingSession === 'resumed' || sessionStartedAt) {
    return 'Continuing this conversation. Claude has the thread so far.'
  }
  if (!hasTurns) return 'New thread. Nothing carries over yet.'
  return 'A fresh conversation. Nothing carries over until the first reply lands.'
}
