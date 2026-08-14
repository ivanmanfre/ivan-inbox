import { useEffect, useState } from 'react'
import { InboxScreen } from '../../screens/InboxScreen'
import { ThreadScreen } from '../../screens/ThreadScreen'
import { SendsScreen } from '../../screens/SendsScreen'
import { SettingsScreen } from '../../screens/SettingsScreen'
import { TodayScreen } from '../../screens/TodayScreen'
import { useOps } from '../../hooks/useOps'
import { useContent } from '../../hooks/useContent'
import { pendingOps } from '../../lib/ops'
import { TabBar } from '../../components/TabBar'
import { SeatHealthBanner } from '../../components/SeatHealthBanner'
import { InboxSkeleton } from '../../components/Skeleton'
import { useInbox } from '../../hooks/useInbox'
import { useDesktop } from '../../hooks/useDesktop'
import { parseHash } from '../../lib/route'
import type { Filter } from '../../lib/inbox'
import { WorkScreen, type WorkSeg } from './WorkScreen'
import { OpsHub } from './OpsHub'

type Tab = 'inbox' | 'drafts' | 'sends' | 'ops' | 'settings' | 'today'

// Candidate C — "no new tab: existing tabs absorb the new surfaces".
//
// Tab set, TabBar, icons, and hash routing are UNCHANGED from the shipped app
// (App.tsx) — the whole thesis is zero navigation relearning. Two tabs gain an
// internal segmented control instead of a 7th slot (the bar is already full,
// AUDIT.md 1d checklist §2):
//   - Drafts -> Work: [DMs | Content | Styles]. DMs is the untouched
//     <DraftsScreen/>; its own embedded Ops-pending preview row is the
//     precedent this whole skeleton generalizes (see WorkScreen.tsx).
//   - Ops -> [Cards | Agent]. Cards is the untouched <OpsScreen/>; Agent is
//     n8nClaw (chat/alerts/reminders) — the one live thing under the
//     dashboard's old "Agent" heading (AUDIT.md).
// See goal-runs/agentops-inbox-content-hub-2026-07-31/AUDIT.md D1-D11 and
// phase1d-inbox-architecture.md §5+§8b for every rule this build follows.
export default function Shell() {
  const [tab, setTab] = useState<Tab>('inbox')
  const { drafts: opsDrafts } = useOps()
  // Badge-only mount: Shell needs the Ivan lane's review count for the tab
  // badge below; WorkScreen's Content segment mounts its own useContent()
  // independently whenever it's on screen. Both are safe side by side —
  // useContent namespaces its realtime channel per-mount with useId(), same
  // rule useOps already relies on (the 754d32d fix).
  const { buckets: ivanBuckets } = useContent('ivan')
  const [openThread, setOpenThread] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [sendsClient, setSendsClient] = useState<'all' | 'ivan' | 'risedtc' | 'arch'>('ivan')
  // Lifted up rather than owned inside WorkScreen: the desktop layout branch
  // below needs to know the active segment to decide dt-full vs the
  // dt-list/dt-detail split.
  const [workSeg, setWorkSeg] = useState<WorkSeg>('dms')
  const { threads, loading, refresh } = useInbox()
  const desktop = useDesktop()
  // Everything waiting on Ivan: DM drafts, Ops pending, AND content
  // needs-review (Ivan lane only — Rise content stays the client board's
  // business, D7). Undercounting this reads as "nothing waiting" when a whole
  // bucket is sitting on the Work tab's Content segment.
  const draftCount = threads.filter(t => t.draft).length
    + pendingOps(opsDrafts).length
    + ivanBuckets.review.length

  // Hash mini-router — identical to App.tsx's Shell. Deep links only ever
  // target a tab or a thread; Content/Styles/Agent segments aren't part of
  // the hash scheme this run (route.ts is shared, out of this candidate's
  // scope, and no deep link into a segment was asked for).
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
          onOpenDrafts={() => { setWorkSeg('dms'); setTab('drafts') }}
          activeThread={desktop ? openThread : null}
        />
      )}
      {tab === 'drafts' && (
        <WorkScreen
          seg={workSeg} setSeg={setWorkSeg}
          threads={threads} onOpenThread={setOpenThread} refresh={refresh}
          onOpenOps={() => setTab('ops')}
        />
      )}
      {tab === 'sends' && (
        <SendsScreen client={sendsClient} setClient={setSendsClient} />
      )}
      {tab === 'ops' && <OpsHub />}
      {tab === 'settings' && <SettingsScreen />}
      {tab === 'today' && <TodayScreen />}
    </>
  )

  // Work's Content/Styles segments have no per-item conversation either — same
  // reasoning as Sends/Ops/Today (App.tsx comment) — so they join the dt-full
  // set; only the DMs segment keeps the dt-list/dt-detail split, exactly as
  // the plain Drafts tab does in the shipped app.
  const isDtFull = tab === 'sends' || tab === 'ops' || tab === 'today'
    || (tab === 'drafts' && workSeg !== 'dms')

  if (desktop) {
    return (
      <div className="app dt">
        <TabBar active={tab} draftCount={draftCount} onNav={nav} />
        {isDtFull ? (
          <div className="dt-full">
            <SeatHealthBanner />
            {tab === 'sends' && <SendsScreen client={sendsClient} setClient={setSendsClient} />}
            {tab === 'ops' && <OpsHub />}
            {tab === 'today' && <TodayScreen />}
            {tab === 'drafts' && (
              <WorkScreen
                seg={workSeg} setSeg={setWorkSeg}
                threads={threads} onOpenThread={setOpenThread} refresh={refresh}
                onOpenOps={() => setTab('ops')}
              />
            )}
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
