import { lazy, Suspense } from 'react'

// Experiment gate. Two generations of candidates live behind it:
//   a|b|c  — the content-hub IA tournament (goal-run
//            agentops-inbox-content-hub-2026-07-31)
//   v2c    — the inbox-v2 revamp tournament's "Workbench" candidate
//            (goal-run inbox-v2-revamp-2026-08-01)
// Nothing renders a candidate unless the app is LOADED with #exp/<id> in the
// URL (ballot links open fresh, so a mount-time read is enough — in-app hash
// navigation never re-enters or exits an experiment). #exp/off clears the
// sticky choice. The default app path is untouched when no flag is set.
//
// v2c takes a trailing path (#exp/v2c/content, #exp/v2c/inbox/chat) so every
// surface inside it is reachable by a FRESH page load, which is the only kind
// of load this gate can see. \b after the id is what lets that through.
export type ExpVariant = 'a' | 'b' | 'c' | 'v2c'

const KEY = 'exp_variant'
const VARIANTS: ExpVariant[] = ['a', 'b', 'c', 'v2c']

export function getExpVariant(): ExpVariant | null {
  const m = location.hash.match(/^#exp\/(v2c|a|b|c|off)\b/)
  if (m) {
    if (m[1] === 'off') { sessionStorage.removeItem(KEY); return null }
    sessionStorage.setItem(KEY, m[1])
    return m[1] as ExpVariant
  }
  const saved = sessionStorage.getItem(KEY) as ExpVariant | null
  return saved && VARIANTS.includes(saved) ? saved : null
}

const ShellA = lazy(() => import('./cand-a/Shell'))
const ShellB = lazy(() => import('./cand-b/Shell'))
const ShellC = lazy(() => import('./cand-c/Shell'))
const ShellV2C = lazy(() => import('./v2c/Shell'))

export function ExpGate({ variant }: { variant: ExpVariant }) {
  return (
    <Suspense fallback={null}>
      {variant === 'a' && <ShellA />}
      {variant === 'b' && <ShellB />}
      {variant === 'c' && <ShellC />}
      {variant === 'v2c' && <ShellV2C />}
    </Suspense>
  )
}
