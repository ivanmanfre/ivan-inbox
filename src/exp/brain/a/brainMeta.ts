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

/**
 * The only kinds that are a FILE Claude read. The assembler also pushes its own
 * block ids (`kind: 'block'`, e.g. B14-header) and bookkeeping entries
 * (`kind: 'file'`, path `auto`), and the container can push a raw shell command
 * as one string. None of those is a memory file, none of them is a name he
 * would recognise, and none of them may reach the DOM.
 */
const FILE_KINDS = new Set(['memory', 'brain'])

/** A source is printable when it is a file kind and its path is a single token. */
function isFileSource(s: TurnSource): boolean {
  return FILE_KINDS.has(s.kind) && s.path.trim().length > 0 && !/\s/.test(s.path)
}

/** What the chip expands to: basenames of the files that were read, deduplicated, in order. */
export function sourceBasenames(sources: TurnSource[] | undefined): string[] {
  if (!sources) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const s of sources) {
    if (!isFileSource(s)) continue
    const b = sourceBasename(s.path)
    if (!b || seen.has(b)) continue
    seen.add(b)
    out.push(b)
  }
  return out
}

/** "read 3 memory files" / "read 1 memory file" / null when no file was read. */
export function sourcesChipLabel(sources: TurnSource[] | undefined): string | null {
  const n = sourceBasenames(sources).length
  if (n === 0) return null
  return `read ${n} memory file${n === 1 ? '' : 's'}`
}

/**
 * The memory summary is not a file he read; it is the date the whole index was
 * built on. It gets its own clause under the chip rather than being counted as
 * a file or printed as a bare number in a list of filenames.
 */
export function sourceSummaryClause(sources: TurnSource[] | undefined): string | null {
  const hit = (sources ?? []).find(s => s.kind === 'summary' && s.path.trim().length > 0 && !/\s/.test(s.path))
  return hit ? `grounded on ${hit.path.trim()}` : null
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
