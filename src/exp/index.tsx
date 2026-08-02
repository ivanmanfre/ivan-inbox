import { lazy, Suspense } from 'react'

// Experiment gate. Two generations of candidates live behind it:
//   a|b|c  — the content-hub IA tournament (goal-run
//            agentops-inbox-content-hub-2026-07-31)
//   v2c    — the inbox-v2 revamp tournament's "Workbench" candidate
//            (goal-run inbox-v2-revamp-2026-08-01)
//   v2     — the WINNER-APPLY build of that tournament: v2c's structure plus the
//            panel's named grafts, its four must-fixes, and the real Claude
//            transport. This is the one the ballot is about.
// Nothing renders a candidate unless the app is LOADED with #exp/<id> in the
// URL (ballot links open fresh, so a mount-time read is enough — in-app hash
// navigation never re-enters or exits an experiment). #exp/off clears the
// sticky choice. The default app path is untouched when no flag is set.
//
// v2/v2c take a trailing path (#exp/v2/content, #exp/v2/inbox/chat) so every
// surface inside them is reachable by a FRESH page load, which is the only kind
// of load this gate can see. \b after the id is what lets that through.
//
// #exp/v2c is deliberately KEPT and points at the same shell: the ballot links
// the three tournament candidates from their own deploys (v2a and v2b live on
// their own branches and are not in this tree), and an existing v2c link must
// not 404 on this build. The canonical id emitted by the router is `v2`.
// 'stock' (added at deploy, 2026-08-02): the workbench is the default app now,
// so the PRE-revamp shell is the one that needs a flag. App.tsx renders it
// directly; ExpGate never sees it.
export type ExpVariant = 'a' | 'b' | 'c' | 'v2' | 'v2c' | 'stock'

const KEY = 'exp_variant'
const VARIANTS: ExpVariant[] = ['a', 'b', 'c', 'v2', 'v2c', 'stock']

export function getExpVariant(): ExpVariant | null {
  // v2c before v2 — the alternation is ordered, so the shorter id must not eat
  // the longer one's prefix.
  const m = location.hash.match(/^#exp\/(v2c|v2|a|b|c|stock|off)\b/)
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
const ShellV2 = lazy(() => import('./v2c/Shell'))

export function ExpGate({ variant }: { variant: ExpVariant }) {
  return (
    <Suspense fallback={null}>
      {variant === 'a' && <ShellA />}
      {variant === 'b' && <ShellB />}
      {variant === 'c' && <ShellC />}
      {(variant === 'v2' || variant === 'v2c') && <ShellV2 />}
    </Suspense>
  )
}
