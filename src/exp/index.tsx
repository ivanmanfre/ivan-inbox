import { lazy, Suspense } from 'react'

// Experiment gate. Two generations of candidates live behind it:
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
// brain-b (goal-run inbox-brain-app-2026-09-04): the workbench shell with the
// phone/Ask finalist Ivan picked, mounted through src/exp/brain.
// Phase 3 W6 (inbox-app-revamp-2026-09-05) swept the losers: the content-hub
// candidates a|b|c and the brain candidates a|c are off the disk, so the three
// routes that reached them are gone with them. `stock`, `v2`/`v2c` and
// `brain-b` are the surviving ids.
export type ExpVariant = 'v2' | 'v2c' | 'stock' | 'brain-b'

const KEY = 'exp_variant'
const VARIANTS: ExpVariant[] = ['v2', 'v2c', 'stock', 'brain-b']

// Mirrors `src/exp/v2c/Shell.tsx`'s own `MQ_DESKTOP` breakpoint. Duplicated
// rather than imported: that file is lazy-loaded on purpose (kept out of the
// bundle `#exp/stock`'s pixel-diff gate measures), and this function runs
// ahead of that import, at the ExpGate/App level, before any canvas is known.
function isPhoneWidth(): boolean {
  return typeof window !== 'undefined' && window.innerWidth < 1000
}

export function getExpVariant(): ExpVariant | null {
  // v2c before v2 — the alternation is ordered, so the shorter id must not eat
  // the longer one's prefix.
  const m = location.hash.match(/^#exp\/(brain-b|v2c|v2|stock|off)\b/)
  if (m) {
    if (m[1] === 'off') { sessionStorage.removeItem(KEY); return null }
    // W1-1: v2/v2c's phone chrome is retired and does not lay out at 390px
    // (phase3-skeptic-A §1, it mounts a `Shell.tsx` branch nothing paints
    // any more). A cold boot on that prefix self-heals into brain-b here,
    // on the phone only: the desktop comparison the tournament ballot still
    // wants (App.tsx's own comment, "#exp/v2 ... stay reachable by hash")
    // is untouched, since v2's DESKTOP render never went through that dead
    // branch. The trailing path (`/dms`, `/today`, `?thread=…`) survives,
    // because brain-b reads the identical `route.ts` grammar.
    if ((m[1] === 'v2' || m[1] === 'v2c') && isPhoneWidth()) {
      const healed = location.hash.replace(/^#exp\/v2c?\b/, '#exp/brain-b')
      history.replaceState(null, '', healed)
      sessionStorage.setItem(KEY, 'brain-b')
      return 'brain-b'
    }
    sessionStorage.setItem(KEY, m[1])
    return m[1] as ExpVariant
  }
  const saved = sessionStorage.getItem(KEY) as ExpVariant | null
  // The sticky choice needs the same self-heal: once any v2/v2c URL is
  // entered this session (W1's finding #2 / skeptic §1.2), sessionStorage
  // stays 'v2' for the rest of the tab, and a later hash-less reload (a
  // Safari tab reload with no `#exp/…` left in the address bar) would
  // still resolve to the broken shell on the phone.
  if ((saved === 'v2' || saved === 'v2c') && isPhoneWidth()) {
    sessionStorage.setItem(KEY, 'brain-b')
    return 'brain-b'
  }
  return saved && VARIANTS.includes(saved) ? saved : null
}

const ShellV2 = lazy(() => import('./v2c/Shell'))

export function ExpGate({ variant }: { variant: ExpVariant }) {
  return (
    <Suspense fallback={null}>
      {(variant === 'v2' || variant === 'v2c') && <ShellV2 />}
      {variant === 'brain-b' && <ShellV2 brain="b" />}
    </Suspense>
  )
}
