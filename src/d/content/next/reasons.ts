// WHY A POST IS HELD, in plain words. The database gives raw reasons (`fails`); the row shows one sentence.
// The order is the order he can act on: the loop he has to look at, then his own edits, then the machine's lag.

const RULES: readonly (readonly [RegExp, string])[] = [
  [/animated gif/i, 'The loop needs your look. The automatic check only sees its first frame.'],
  [/source pack|brain verifier checked different text/i, 'You changed the text after the automatic check.'],
  [/automatic pick is held or stale/i, 'Its date was changed by hand after the autopilot placed it.'],
  [/queue differs/i, 'The queued copy is catching up with the draft.'],
  [/asset/i, 'The attachment changed after the automatic check.'],
]
export const DEFAULT_REASON = 'The automatic check stopped it.'

/** One plain reason for the raw reasons of a held post. */
export function plainReason(fails: readonly string[] | null | undefined): string {
  const list = (fails ?? []).filter(f => typeof f === 'string')
  for (const [re, text] of RULES) if (list.some(f => re.test(f))) return text
  return DEFAULT_REASON
}
