import type { TurnSource } from '../../../lib/turns'

// ---------------------------------------------------------------------------
// What the brain read, in words a reader owns.
//
// A turn's `sources` array is a MIXED bag: the memory files the run actually
// opened, the daily summary it was grounded on, and the internal block ids the
// envelope was assembled from. Only the first of those is a "memory file" he
// would recognise, and the last is a set of build-time identifiers that mean
// nothing outside the pipeline. Counting all three and printing "read 10
// memory files" is a claim the data does not hold; expanding it and printing
// the block ids is an internal name on screen. So both the count and the list
// are drawn from the memory kinds ALONE, the summary is named in its own
// clause, and everything else never reaches the DOM.
// ---------------------------------------------------------------------------

/** The kinds a reader would call a memory file. Everything else is plumbing. */
const MEMORY_KINDS = new Set(['memory', 'brain'])

/**
 * A path is printable only if it is a path. A value carrying whitespace or a
 * newline is a shell blob or a placeholder that reached the column by accident,
 * and a card is not the place to find that out.
 */
export function printablePath(path: unknown): path is string {
  return typeof path === 'string' && path.trim().length > 0 && !/\s/.test(path)
}

export function basename(path: string): string {
  const parts = path.split('/')
  return parts[parts.length - 1] || path
}

/** The sources that are memory files, printable, and not repeats. */
export function memorySources(sources: TurnSource[] | undefined): TurnSource[] {
  const seen = new Set<string>()
  const out: TurnSource[] = []
  for (const s of sources ?? []) {
    if (!MEMORY_KINDS.has(s?.kind)) continue
    if (!printablePath(s?.path)) continue
    const name = basename(s.path)
    if (seen.has(name)) continue
    seen.add(name)
    out.push(s)
  }
  return out
}

export function sourceBasenames(sources: TurnSource[] | undefined): string[] {
  return memorySources(sources).map(s => basename(s.path))
}

/** The one date the answer was grounded on, or null. Never counted as a file. */
export function summaryDate(sources: TurnSource[] | undefined): string | null {
  for (const s of sources ?? []) {
    if (s?.kind !== 'summary') continue
    if (!printablePath(s?.path)) continue
    return basename(s.path)
  }
  return null
}

/** Its own clause, never folded into the count. */
export function groundedClause(sources: TurnSource[] | undefined): string | null {
  const on = summaryDate(sources)
  return on ? `grounded on ${on}` : null
}

/** The chip's collapsed label, or null when there is nothing true to say. */
export function sourcesChipLabel(sources: TurnSource[] | undefined): string | null {
  const n = memorySources(sources).length
  if (n === 0) return null
  return `read ${n} memory ${n === 1 ? 'file' : 'files'}`
}
