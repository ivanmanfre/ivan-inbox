import { useEffect, useState } from 'react'
import { parseHash } from '../../lib/route'
import { InboxScreen } from '../../screens/InboxScreen'
import { ThreadScreen } from '../../screens/ThreadScreen'
import { DraftsScreen } from '../../screens/DraftsScreen'
import { SendsScreen } from '../../screens/SendsScreen'
import { OpsScreen } from '../../screens/OpsScreen'
import { TodayScreen } from '../../screens/TodayScreen'
import { SeatHealthBanner } from '../../components/SeatHealthBanner'
import { InboxSkeleton } from '../../components/Skeleton'
import { useInbox } from '../../hooks/useInbox'
import { useOps } from '../../hooks/useOps'
import { pendingOps } from '../../lib/ops'
import { useDesktop } from '../../hooks/useDesktop'
import type { Filter } from '../../lib/inbox'
import { TabBar, type Tab } from './TabBar'
import { StudioScreen } from './StudioScreen'

// Candidate B — "Studio: one hub tab with drill-ins". Mirrors the real
// App.tsx's Shell (session gating already happened one level up in the real
// App() before ExpGate ever mounts this) with one IA change: the Settings tab
// slot becomes Studio, a single scrolling hub (Agent + Content + Styles +
// Resources) that folds Settings back in as its last row. Every other tab
// (inbox/drafts/sends/ops/today) reuses the real screens completely unchanged
// — same props, same wiring — so this candidate is judged purely on the
// Studio surface, not on a rebuilt inbox.
export default function Shell() {
  const [tab, setTab] = useState<Tab>('inbox')
  const { drafts: opsDrafts } = useOps()
  const [openThread, setOpenThread] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [sendsClient, setSendsClient] = useState<'all' | 'ivan' | 'risedtc'>('ivan')
  const { threads, loading, refresh } = useInbox()
  const desktop = useDesktop()
  // Studio's own internal push state (chat/reminders/queue/etc.) is reported
  // up only as a boolean, so the mobile tab bar can hide during a push — the
  // same full-takeover feel ThreadScreen gets — without Shell knowing (or
  // routing) what's actually pushed. That stays internal to StudioScreen.
  const [studioPushed, setStudioPushed] = useState(false)
  const draftCount = threads.filter(t => t.draft).length + pendingOps(opsDrafts).length

  useEffect(() => {
    const applyHash = () => {
      // route.ts's shared Tab enum doesn't know 'studio' (out of this
      // candidate's scope to edit) — parseHash returns null for '#studio' as
      // an unrecognized hash, so it's handled here directly before falling
      // through to the shared parser.
      if (location.hash === '#studio') {
        setTab('studio')
        return
      }
      const route = parseHash(location.hash)
      if (!route) return
      if (route.thread) {
        setTab('inbox')
        setOpenThread(route.thread)
        return
      }
      if (route.tab) {
        // A '#settings' deep link, if one ever existed, lands on Studio
        // instead of silently no-oping.
        setTab(route.tab === 'settings' ? 'studio' : (route.tab as Tab))
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
      {tab === 'studio' && <StudioScreen onPushChange={setStudioPushed} />}
      {tab === 'today' && <TodayScreen />}
    </>
  )

  // Desktop: rail + list column + conversation pane, side by side. Sends, Ops,
  // Today and now Studio have no per-item conversation, so each spans the full
  // content width instead of the list+detail split.
  if (desktop) {
    return (
      <div className="app dt">
        <TabBar active={tab} draftCount={draftCount} onNav={nav} />
        {tab === 'sends' || tab === 'ops' || tab === 'today' || tab === 'studio' ? (
          <div className="dt-full">
            <SeatHealthBanner />
            {tab === 'sends' && <SendsScreen client={sendsClient} setClient={setSendsClient} />}
            {tab === 'ops' && <OpsScreen />}
            {tab === 'today' && <TodayScreen />}
            {tab === 'studio' && <StudioScreen onPushChange={setStudioPushed} />}
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

  // Mobile: an open thread takes over the entire screen (no tab bar); Studio's
  // own pushed sub-screens (chat, reminders, a bucket queue…) get the same
  // full-takeover treatment.
  if (thread) {
    return (
      <div className="app">
        <ThreadScreen thread={thread} onBack={() => setOpenThread(null)} refresh={refresh} />
      </div>
    )
  }

  // Studio manages its own pushed sub-screens as internal state (chat,
  // reminders, a bucket queue…) — the SAME StudioScreen instance stays mounted
  // the whole time (inside listScreen) so none of that state is lost mid-push;
  // only the bottom tab bar hides for the duration, mirroring ThreadScreen's
  // full takeover without a second mount fighting the first one for it.
  return (
    <div className="app">
      {listScreen}
      {!(tab === 'studio' && studioPushed) && <TabBar active={tab} draftCount={draftCount} onNav={nav} />}
    </div>
  )
}
