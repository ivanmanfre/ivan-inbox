import { Suspense, lazy, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { bootGate } from './lib/bootGate'
import { currentUserId } from './lib/swr'
// P1 SPEED (2026-09-25). supabase-js (~240 KB parsed) and the design system
// with motion used to sit in the entry chunk, so React could not mount until
// all of it had been fetched, parsed and run, even though the first frame
// paints from the stored session and the saved copy. Both are now loaded
// beside the route: supabase by the session effect below, the providers
// (motion, Confirm, PushLater) by `Providers`, and the route's own chunk is
// started at module scope (the IIFE after the exp import) so the three load in parallel.
const loadSupabase = () => import('./lib/supabase').then(m => m.supabase)
const Providers = lazy(() => import('./providers'))
function withProviders(node: ReactNode) {
  return <Suspense fallback={null}><Providers>{node}</Providers></Suspense>
}
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

/**
 * Start the chunks a signed-in cold open is about to need while React boots:
 * the workbench shell and, on the phone, the Claude candidate it mounts first.
 * Same module specifiers as the lazy() sites in src/exp, so the browser fetches
 * each once. Read-only checks here: getExpVariant() writes sessionStorage and
 * rewrites the hash, so it stays where it was, inside App.
 */
;(() => {
  if (typeof window === 'undefined' || currentUserId() === null) return
  if (/^#doc(\?|$)/.test(location.hash) || /^#exp\/stock\b/.test(location.hash)) return
  try { if (!/^#exp\//.test(location.hash) && sessionStorage.getItem('exp_variant') === 'stock') return } catch { /* private mode */ }
  void loadSupabase()
  void import('./providers')
  void import('./exp/v2c/Shell')
  if (window.innerWidth < 1000) void import('./exp/brain/b')
})()
// DEV ONLY, see the bypass check in App() below. The `import.meta.env.DEV`
// ternary (not just the render-site `if`) is required: `lazy(() =>
// import(...))` is an ordinary top-level call, so Rollup treats its
// `import()` as reachable and emits a real `FixtureHarness-*.js` chunk in a
// default `npm run build` REGARDLESS of the conditional around where
// `<EvidenceFixtureHarness/>` gets rendered below -- confirmed by building:
// the first version of this fix (an unconditional `const ... = lazy(...)`)
// still leaked the chunk into `dist/`. Folding the `lazy()` call itself
// behind the same literal `import.meta.env.DEV` (`false` in a
// `NODE_ENV=production` build) lets Rollup dead-code-eliminate the whole
// ternary branch, taking the `import()` reference with it -- verified again
// after this change: `dist/` carries no `FixtureHarness` chunk.
// P1 speed: the bypass check itself is loaded here too. A static import of
// src/lib/contentEvidence kept it (and content.ts, and supabase-js through it)
// in the production entry chunk, because a module with side effects survives
// dead-code elimination of its only call. In DEV the gate resolves the check
// and renders either the harness or the app it would otherwise have shown.
const EvidenceFixtureHarness = import.meta.env.DEV
  ? lazy(() => Promise.all([
      import('./lib/contentEvidence'),
      import('./wb/content/evidence/FixtureHarness'),
    ]).then(([ce, m]) => ({
      default: ({ app }: { app: ReactNode }) =>
        ce.evidenceFixtureBypassActive(import.meta.env.DEV, window.location.search) ? <m.FixtureHarness /> : <>{app}</>,
    })))
  : null
const LocalEditorialPreview = import.meta.env.DEV
  ? lazy(() => import('./wb/content/research/LocalPreviewHarness').then(m => ({ default: m.LocalPreviewHarness })))
  : null

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    // The client arrives asynchronously now (see loadSupabase above); a cleanup
    // that runs first (StrictMode's rehearsal unmount) must still unsubscribe
    // whatever the late resolve sets up.
    let cancelled = false
    let unsubscribe = () => {}
    void loadSupabase().then(supabase => {
      if (cancelled) return
      supabase.auth.getSession().then(({ data }) => { if (!cancelled) { setSession(data.session); setReady(true) } })
      const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => { if (!cancelled) setSession(s) })
      unsubscribe = () => sub.subscription.unsubscribe()
    })
    // On resume (PWA backgrounded), revalidate: restore the session or refresh a
    // near-expired token instead of dumping the user back to the login screen.
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        void loadSupabase().then(supabase => supabase.auth.getSession().then(({ data }) => {
          if (data.session) setSession(data.session)
          else supabase.auth.refreshSession().then(({ data: refreshed, error }) => {
            // A failed/empty refresh means the session is actually dead — clear it
            // so the login gate shows instead of leaving stale truthy state around
            // while supabase-js silently falls back to the anon key.
            if (error || !refreshed.session) setSession(null)
            else setSession(refreshed.session)
          })
        }))
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      unsubscribe()
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
  // The side-by-side preview (served at /next/, VITE_PREVIEW=1) never touches push: reconcilePush
  // would subscribe THIS scope and drop the live app's row for the same device, moving his
  // notifications to the preview.
  useEffect(() => {
    if (!session || import.meta.env.VITE_PREVIEW === '1') return
    void import('./lib/push').then(m => m.reconcilePush())
  }, [session])
  useEffect(() => {
    if (import.meta.env.VITE_PREVIEW === '1') document.title = 'Inbox (new)'
  }, [])
  if (import.meta.env.DEV && import.meta.env.VITE_EDITORIAL_PREVIEW === '1' && typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('localEditorialPreview') === '1' && LocalEditorialPreview) {
    return withProviders(<Suspense fallback={null}><LocalEditorialPreview /></Suspense>)
  }
  // Paint from the stored session while getSession() resolves (src/lib/bootGate.ts).
  // A magic link landing (`#access_token=`) waits for the client instead: the
  // shell rewrites the hash on mount, and supabase-js now loads beside it, so
  // painting first could drop the token before the client reads it.
  const storedUser = currentUserId() !== null && !/access_token=/.test(location.hash)
  const gate = bootGate({ ready, hasSession: !!session, storedUser })
  const app = routeFor(gate)
  // W5 CHECKER REACHABILITY (content-evidence-03 Phase 2 fix pass,
  // orchestrator ruling c): the independent checker opens a
  // `?evidenceFixture=<state>` URL with a fresh, signed-out browser profile
  // and clicks nothing, so the login gate has to be skippable for that
  // one case. DEV-only and tree-shaken: the literal `import.meta.env.DEV`
  // token here and on EvidenceFixtureHarness folds the whole branch out of a
  // `NODE_ENV=production` build. The harness module itself decides (with
  // `evidenceFixtureBypassActive`, unit-tested in contentEvidence.test.ts)
  // whether the state is real; if not, it renders the app below unchanged.
  if (import.meta.env.DEV && typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).has('evidenceFixture')
    && EvidenceFixtureHarness) {
    return withProviders(<Suspense fallback={null}><EvidenceFixtureHarness app={app} /></Suspense>)
  }
  return app === null ? null : withProviders(app)
}

/** What the gate paints. A plain function, no hooks: App's hooks all run above its call. */
function routeFor(gate: 'blank' | 'login' | 'app'): ReactNode | null {
  if (gate === 'blank') return null
  if (gate === 'login') return <Suspense fallback={null}><Login /></Suspense>
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
