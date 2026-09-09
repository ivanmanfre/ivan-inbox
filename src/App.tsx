import { Suspense, lazy, useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import { reconcilePush } from './lib/push'
// S32 rebuilt on the design system (goal run inbox-app-revamp-2026-09-05, W1).
// BOTH shells sign in through it. Lazy on purpose: `src/ds` then stays out of
// the first paint of `#exp/stock`, which the pixel gate measures with a session
// already in hand, so a login screen never enters that diff.
const Login = lazy(() => import('./wb/login'))
// `src/styles.css` moved out of src/main.tsx this wave (DECISIONS D4), and the
// stock SHELL moved out beside it in N3-4. Between them they carried nine
// pre-revamp screens (Inbox, Thread, Drafts, Sends, Ops, Settings, Today, the
// old TabBar and the old Skeleton) into the entry chunk of every route,
// including the phone's DMs boot, which cannot reach them at all: `#exp/stock`
// is an escape hatch nothing links to. One module now, fetched only on that
// hash.
// One sales document, as a whole page (`#doc?slug=…&doc=…`). Lazy for the same
// reason as the two above: a route only the call packs link to must not sit in
// the first paint of the app everything else loads.
const SalesDoc = lazy(() => import('./wb/sales/Doc'))
const StockShell = lazy(() => import('./stockShell'))

/**
 * A LINK HE ALREADY HAS STILL LANDS ON THE DOCUMENT. The first build opened a
 * pack as a window inside the app and addressed it
 * `#exp/v2/sales?slug=<s>&doc=<d>`; that address is in his history, in Slack
 * and in whatever he bookmarked. It is normalised to `#doc?slug=…&doc=…` here,
 * at MODULE SCOPE, because the workbench Shell rewrites the hash to its own
 * canonical form on mount and drops every key it does not own — a forward
 * written inside the Sales surface races that rewrite and loses.
 */
;(() => {
  if (typeof location === 'undefined') return
  const m = location.hash.match(/^#exp\/(?:v2c?|brain-[abc])\/sales\?(.+)$/)
  if (!m) return
  const q = new URLSearchParams(m[1])
  const slug = q.get('slug')
  if (!slug) return
  const doc = q.get('doc') || 'card'
  history.replaceState(null, '', `#doc?slug=${encodeURIComponent(slug)}&doc=${doc}`)
})()
/**
 * W2-1 (P0). `#thread/<prospect_id>` is `src/lib/route.ts`'s grammar for the
 * PRE-revamp stock shell (`#exp/stock`), which nothing links to any more -
 * every writer of this exact form (an old bookmark, a pasted link, a manually
 * typed address) is aiming at "open this conversation" on whatever shell is
 * actually live. Left alone it never reaches `parseHash` at all: `App()`
 * below only mounts the legacy `Shell()` under `#exp/stock`, so a bare
 * `#thread/<id>` falls through to the brain-b default with the id silently
 * dropped, and the SAME MODULE-SCOPE ordering problem as the sales-doc
 * rewrite above bites a second time, `route.ts`'s `WB_PREFIX` is read once,
 * at that module's own load, from whatever `location.hash` already says, so
 * rewriting from inside Shell would be one render too late. Normalising here,
 * before any workbench module has been imported, lands the id on
 * `resolveBootPlace`/Shell's boot-peer handling (W2-1's other half) instead
 * of being eaten.
 */
;(() => {
  if (typeof location === 'undefined') return
  const m = location.hash.match(/^#thread\/(.+)$/)
  if (!m) return
  const id = decodeURIComponent(m[1])
  if (!id) return
  history.replaceState(null, '', `#exp/brain-b/dms?thread=${encodeURIComponent(id)}`)
})()
import { getExpVariant, ExpGate } from './exp'

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true) })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    // On resume (PWA backgrounded), revalidate: restore the session or refresh a
    // near-expired token instead of dumping the user back to the login screen.
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        supabase.auth.getSession().then(({ data }) => {
          if (data.session) setSession(data.session)
          else supabase.auth.refreshSession().then(({ data: refreshed, error }) => {
            // A failed/empty refresh means the session is actually dead — clear it
            // so the login gate shows instead of leaving stale truthy state around
            // while supabase-js silently falls back to the anon key.
            if (error || !refreshed.session) setSession(null)
            else setSession(refreshed.session)
          })
        })
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      sub.subscription.unsubscribe()
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  // REPAIR THE PUSH SUBSCRIPTION ONCE WE HAVE A SESSION. See the long note on
  // reconcilePush(): the server sent 80 pushes in five days and logged "sent"
  // for every one while Ivan's phone stayed silent, because the endpoint in the
  // database had drifted from the one the device actually answers to and
  // nothing ever re-checked. This is the re-check.
  //
  // Gated on `session` because the upsert goes through RLS and needs his JWT;
  // running it on mount would race the session restore and fail silently, which
  // is the same class of bug as the one it exists to fix.
  useEffect(() => {
    if (!session) return
    void reconcilePush()
  }, [session])
  if (!ready) return null
  if (!session) return <Suspense fallback={null}><Login /></Suspense>
  // A SALES DOCUMENT IS A PAGE, NOT A PANEL. `#doc?slug=…&doc=…` paints the
  // document and nothing else — no rail, no phone chrome, no shell — because
  // the chips on the week's calls open it with target="_blank" and the point of
  // the tab is to sit beside three other tabs on a call. Ahead of the
  // experiment gate on purpose: the gate is sticky per session, and a document
  // tab must not inherit whichever candidate the last hash chose.
  if (/^#doc(\?|$)/.test(location.hash)) {
    return <Suspense fallback={null}><SalesDoc /></Suspense>
  }
  // Deploy decision 2026-08-02 ("apply, not additive"): the workbench — the
  // faithful-revamp build the run verified — IS the app now. A load-time
  // #exp/ hash still reaches any candidate; #exp/stock is the escape hatch to
  // the pre-revamp shell.
  const exp = getExpVariant()
  if (exp === 'stock') return <Suspense fallback={null}><StockShell /></Suspense>
  if (exp) return <ExpGate variant={exp} />
  // Ivan picked finalist B, 2026-09-04 (goal run inbox-brain-app). #exp/v2 and
  // #exp/brain-a stay reachable by hash.
  return <ExpGate variant="brain-b" />
}
