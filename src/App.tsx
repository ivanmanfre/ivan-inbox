import { Suspense, lazy, useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import { reconcilePush } from './lib/push'
import { parseHash } from './lib/route'
// S32 rebuilt on the design system (goal run inbox-app-revamp-2026-09-05, W1).
// BOTH shells sign in through it. Lazy on purpose: `src/ds` then stays out of
// the first paint of `#exp/stock`, which the pixel gate measures with a session
// already in hand, so a login screen never enters that diff.
const Login = lazy(() => import('./wb/login'))
// `src/styles.css` moved out of src/main.tsx this wave (DECISIONS D4). This is
// the module that carries it, and it is loaded only on the stock branch below.
const StockStyles = lazy(() => import('./stockStyles'))
import { InboxScreen } from './screens/InboxScreen'
import { ThreadScreen } from './screens/ThreadScreen'
import { DraftsScreen } from './screens/DraftsScreen'
import { useOps } from './hooks/useOps'
import { pendingDmLaneOps } from './lib/ops'
import { SettingsScreen } from './screens/SettingsScreen'
import { SendsScreen } from './screens/SendsScreen'
import { OpsScreen } from './screens/OpsScreen'
import { TodayScreen } from './screens/TodayScreen'
import { TabBar } from './components/TabBar'
import { SeatHealthBanner } from './components/SeatHealthBanner'
import { InboxSkeleton } from './components/Skeleton'
import { useInbox } from './hooks/useInbox'
import { useDesktop } from './hooks/useDesktop'
import { getExpVariant, ExpGate } from './exp'
import type { Filter } from './lib/inbox'

type Tab = 'inbox' | 'drafts' | 'sends' | 'ops' | 'settings' | 'today'

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
  // Deploy decision 2026-08-02 ("apply, not additive"): the workbench — the
  // faithful-revamp build the run verified — IS the app now. A load-time
  // #exp/ hash still reaches any candidate; #exp/stock is the escape hatch to
  // the pre-revamp shell.
  const exp = getExpVariant()
  if (exp === 'stock') return <Suspense fallback={null}><StockStyles><Shell /></StockStyles></Suspense>
  if (exp) return <ExpGate variant={exp} />
  // Ivan picked finalist B, 2026-09-04 (goal run inbox-brain-app). #exp/v2 and
  // #exp/brain-a stay reachable by hash.
  return <ExpGate variant="brain-b" />
}

function Shell() {
  const [tab, setTab] = useState<Tab>('inbox')
  const { drafts: opsDrafts } = useOps()
  const [openThread, setOpenThread] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [sendsClient, setSendsClient] = useState<'all' | 'ivan' | 'risedtc' | 'arch'>('ivan')
  const { threads, loading, refresh } = useInbox()
  const desktop = useDesktop()
  // The badge counts everything waiting on Ivan, DM drafts and Ops alike. If it
  // only counted DMs it would read 0 with an Ops card sitting unanswered.
  // Comment kinds are excluded (ask 12) because DraftsScreen no longer lists
  // them — a badge that counts rows the screen behind it refuses to show is the
  // phantom-badge defect. Comment cards live (and are approved) on the Ops tab.
  // A draft Ivan pushed to later is not waiting on him, so it does not ring the
  // badge until its date comes round (db/037). Same flag every other surface reads.
  const draftCount = threads.filter(t => t.draft && t.draftSnoozedUntil === null).length
    + pendingDmLaneOps(opsDrafts).length

  // Hash mini-router. Shell only ever mounts once App has resolved a session
  // (getSession() settled and session is truthy), so writeback below is
  // implicitly gated on that already — the parseHash() guard covers the
  // edge case of an #access_token fragment still sitting in the URL.
  useEffect(() => {
    const applyHash = () => {
      const route = parseHash(location.hash)
      if (!route) return
      if (route.thread) {
        setTab('inbox')
        setOpenThread(route.thread)
        return
      }
      if (route.tab) {
        setTab(route.tab)
      }
    }
    applyHash()
    window.addEventListener('hashchange', applyHash)
    return () => window.removeEventListener('hashchange', applyHash)
  }, [])

  const nav = (t: Tab) => {
    setTab(t)
    if (!desktop) setOpenThread(null)
    if (!location.hash.startsWith('#access_token')) history.replaceState(null, '', `#${t}`)
  }

  if (loading && threads.length === 0) {
    return (
      <div className="app">
        <div className="nav">
          <div className="row-top"><h2>Inbox</h2><div className="avatar-me">IM</div></div>
          <div className="search">🔍&nbsp; Search people or messages</div>
        </div>
        <InboxSkeleton />
        <TabBar active="inbox" draftCount={0} onNav={() => {}} />
      </div>
    )
  }

  const thread = openThread ? threads.find(t => t.prospect_id === openThread) ?? null : null

  const listScreen = (
    <>
      <SeatHealthBanner />
      {tab === 'inbox' && (
        <InboxScreen
          threads={threads}
          filter={filter}
          setFilter={setFilter}
          refresh={refresh}
          onOpenThread={setOpenThread}
          onOpenDrafts={() => setTab('drafts')}
          activeThread={desktop ? openThread : null}
        />
      )}
      {tab === 'drafts' && (
        <DraftsScreen threads={threads} onOpenThread={setOpenThread} refresh={refresh}
          onOpenOps={() => setTab('ops')} />
      )}
      {tab === 'sends' && (
        <SendsScreen client={sendsClient} setClient={setSendsClient} />
      )}
      {tab === 'ops' && <OpsScreen />}
      {tab === 'settings' && <SettingsScreen />}
      {tab === 'today' && <TodayScreen />}
    </>
  )

  // Desktop: rail + list column + conversation pane, side by side.
  // The Sends, Ops and Today tabs have no conversation, so they span the full
  // content width instead of the list+detail split (which would waste half
  // the screen).
  if (desktop) {
    return (
      <div className="app dt">
        <TabBar active={tab} draftCount={draftCount} onNav={nav} />
        {tab === 'sends' || tab === 'ops' || tab === 'today' ? (
          <div className="dt-full">
            <SeatHealthBanner />
            {tab === 'sends' && <SendsScreen client={sendsClient} setClient={setSendsClient} />}
            {tab === 'ops' && <OpsScreen />}
            {tab === 'today' && <TodayScreen />}
          </div>
        ) : (
          <>
            <div className="dt-list">{listScreen}</div>
            <div className="dt-detail">
              {thread ? (
                <ThreadScreen thread={thread} onBack={() => setOpenThread(null)} refresh={refresh} />
              ) : (
                <div className="dt-empty">
                  <div className="dt-empty-ic">✦</div>
                  <div>Select a conversation</div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    )
  }

  // Mobile: thread takes over the screen; otherwise the active tab + tab bar.
  if (thread) {
    return (
      <div className="app">
        <ThreadScreen thread={thread} onBack={() => setOpenThread(null)} refresh={refresh} />
      </div>
    )
  }

  return (
    <div className="app">
      {listScreen}
      <TabBar active={tab} draftCount={draftCount} onNav={nav} />
    </div>
  )
}
