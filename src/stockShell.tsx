/* ==========================================================================
   src/stockShell.tsx: the pre-revamp shell, behind `#exp/stock`.

   N3-4: this file exists so its nine screens are NOT in the entry chunk. It is
   the escape hatch nothing links to; every real route (brain-b, and the two
   other candidates) reaches none of it, and the phone's DMs boot was paying for
   all of it. `App.tsx` lazy-imports the default export, so the code is fetched
   only when the hash actually says `#exp/stock`.

   The component below is `Shell()` moved verbatim out of App.tsx, wrapped in
   the stylesheet module it always rendered inside. Nothing about what it paints
   changed, which is what the regression floor's 0-px stock diff proves.
   ========================================================================== */
import { lazy, Suspense, useEffect, useState } from 'react'
import { parseHash } from './lib/route'
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
import type { Filter } from './lib/inbox'

const StockStyles = lazy(() => import('./stockStyles'))

type Tab = 'inbox' | 'drafts' | 'sends' | 'ops' | 'settings' | 'today'

export default function StockShell() {
  return (
    <Suspense fallback={null}>
      <StockStyles><Shell /></StockStyles>
    </Suspense>
  )
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
