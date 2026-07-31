import { lazy, Suspense } from 'react'

// Experiment gate for the content-hub IA tournament (goal-run
// agentops-inbox-content-hub-2026-07-31). Three candidate shells ship deployed
// but inert: nothing renders them unless the app is LOADED with #exp/a|b|c in
// the URL (ballot links open fresh, so a mount-time read is enough — in-app
// hash navigation never re-enters or exits an experiment). #exp/off clears the
// sticky choice. The default app path is untouched when no flag is set.
export type ExpVariant = 'a' | 'b' | 'c'

const KEY = 'exp_variant'

export function getExpVariant(): ExpVariant | null {
  const m = location.hash.match(/^#exp\/(a|b|c|off)\b/)
  if (m) {
    if (m[1] === 'off') { sessionStorage.removeItem(KEY); return null }
    sessionStorage.setItem(KEY, m[1])
    return m[1] as ExpVariant
  }
  const saved = sessionStorage.getItem(KEY)
  return saved === 'a' || saved === 'b' || saved === 'c' ? saved : null
}

const ShellA = lazy(() => import('./cand-a/Shell'))
const ShellB = lazy(() => import('./cand-b/Shell'))
const ShellC = lazy(() => import('./cand-c/Shell'))

export function ExpGate({ variant }: { variant: ExpVariant }) {
  return (
    <Suspense fallback={null}>
      {variant === 'a' && <ShellA />}
      {variant === 'b' && <ShellB />}
      {variant === 'c' && <ShellC />}
    </Suspense>
  )
}
