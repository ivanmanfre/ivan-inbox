// brainVisibility.ts — pure copy helpers for item 3 (brain visibility): the
// sources chip, the grounded-on line and the session-state sentence. Kept as
// plain string functions so the exact wording is asserted once here rather than
// duplicated between the phone and the desktop pane.
import type { TurnSource } from '../../../lib/turns'
import type { Grounding } from '../../v2c/useChat'

/** The file basenames a `sources chip` expands to. Never invents a path. */
export function sourceBasenames(sources: TurnSource[]): string[] {
  return sources.map(s => s.path.split('/').pop() || s.path)
}

/** The chip's own collapsed label. */
export function sourcesChipLabel(sources: TurnSource[]): string {
  const n = sources.length
  if (n === 0) return ''
  return `Read ${n} memory file${n === 1 ? '' : 's'}`
}

/** The once-per-thread sentence: what session this is, in plain words. */
export function sessionStateLabel(grounding: Grounding | null): string | null {
  if (!grounding) return null
  return grounding.session === 'resumed'
    ? 'Continued session. The container remembers this thread.'
    : 'Fresh session. Nothing carried over but the transcript above.'
}

/** The grounded-on line, when the broker said what date it grounded on. */
export function groundedOnLabel(grounding: Grounding | null): string | null {
  if (!grounding?.groundedOn) return null
  return `Grounded on ${grounding.groundedOn}`
}
