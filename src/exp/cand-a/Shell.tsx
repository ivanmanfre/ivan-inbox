import { useEffect, useState } from 'react'
import { parseHash } from '../../lib/route'
import { InboxScreen } from '../../screens/InboxScreen'
import { ThreadScreen } from '../../screens/ThreadScreen'
import { DraftsScreen } from '../../screens/DraftsScreen'
import { SendsScreen } from '../../screens/SendsScreen'
import { TodayScreen } from '../../screens/TodayScreen'
import { useOps } from '../../hooks/useOps'
import { pendingOps } from '../../lib/ops'
import { TabBar } from './TabBar'
import { OpsHost } from './OpsHost'
import { ContentScreen } from './ContentScreen'
import { SettingsPush } from './SettingsPush'
import { SeatHealthBanner } from '../../components/SeatHealthBanner'
import { InboxSkeleton } from '../../components/Skeleton'
import { useInbox } from '../../hooks/useInbox'
import { useDesktop } from '../../hooks/useDesktop'
import { useContent } from '../../hooks/useContent'
import type { Filter } from '../../lib/inbox'
import './styles.css'

type Tab = 'inbox' | 'drafts' | 'sends' | 'ops' | 'content' | 'today'

// Candidate A — "Content as a first-class tab" (goal-run
// agentops-inbox-content-hub-2026-07-31, AUDIT.md decisions D1-D11).
//
// Session/auth is already resolved by the real App() before this ever mounts
// (see src/App.tsx and src/exp/index.tsx's ExpGate) — this Shell only handles
// what App.tsx's Shell() handles post-session: hash routing, the tab switch,
// and the desktop/mobile fork. It reuses InboxScreen/ThreadScreen/DraftsScreen/
// SendsScreen/TodayScreen/OpsScreen exactly as App.tsx wires them (same props,
// same useInbox/useOps/useDesktop hooks), and drops Settings out of the tab
// bar in favor of a sixth Content tab — Settings is reached instead from a
// gear button inside ContentScreen's own header (see SettingsPush.tsx).
export default function Shell() {
  const [tab, setTab] = useState<Tab>('inbox')
  const { drafts: opsDrafts } = useOps()
  const [openThread, setOpenThread] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [sendsClient, setSendsClient] = useState<'all' | 'ivan' | 'risedtc' | 'arch'>('ivan')
  const { threads, loading, refresh } = useInbox()
  const desktop = useDesktop()
  const [settingsHashOpen, setSettingsHashOpen] = useState(false)
  // Same unified badge as the real app: DM drafts + Ops pending, one number.
  const draftCount = threads.filter(t => t.draft).length + pendingOps(opsDrafts).length
  // Lean mount, Ivan lane only — a second useContent() beside ContentQueue's own
  // is safe because every mount gets its own realtime topic (useId-namespaced,
  // 754d32d), so this never collides with the one ContentScreen mounts when the
  // Content tab is actually open. Its only job here is the tab badge's count.
  const ivanContent = useContent('ivan')
  const contentBadge = ivanContent.buckets.review.length

  useEffect(() => {
    const applyHash = () => {
      const raw = location.hash
      // route.ts's TABS enum knows 'settings' (a tab this Shell dropped) but
      // not 'content' (this Shell's own addition) — both are shared-file blind
      // spots parseHash can't resolve, and extending that enum is out of this
      // candidate's hard scope (only src/exp/cand-a/ may change). Rather than
      // let either hash die silently on reload/share, both are salvaged here:
      // '#content' restores the Content tab, and a stray '#settings' (an old
      // deep link from before Settings left the tab bar) opens the settings
      // push instead of going nowhere.
      if (raw === '#content') { setTab('content'); return }
      if (raw === '#settings') { setSettingsHashOpen(true); return }
      const route = parseHash(raw)
      if (!route) return
      if (route.thread) {
        setTab('inbox')
        setOpenThread(route.thread)
        return
      }
      const t = route.tab as string | undefined
      if (t === 'inbox' || t === 'drafts' || t === 'sends' || t === 'ops' || t === 'today') {
        setTab(t)
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
        <TabBar active="inbox" draftCount={0} contentCount={0} onNav={() => {}} />
        {settingsHashOpen && (
          <SettingsPush onBack={() => { setSettingsHashOpen(false); history.replaceState(null, '', `#${tab}`) }} />
        )}
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
      {tab === 'ops' && <OpsHost />}
      {tab === 'content' && <ContentScreen />}
      {tab === 'today' && <TodayScreen />}
    </>
  )

  // Desktop: rail + list column + conversation pane, side by side. Sends, Ops,
  // Today and (new) Content have no conversation, so they span the full
  // content width instead of the list+detail split — same reasoning as
  // App.tsx's dt-full branch.
  if (desktop) {
    return (
      <div className="app dt">
        <TabBar active={tab} draftCount={draftCount} contentCount={contentBadge} onNav={nav} />
        {tab === 'sends' || tab === 'ops' || tab === 'today' || tab === 'content' ? (
          <div className="dt-full">
            <SeatHealthBanner />
            {tab === 'sends' && <SendsScreen client={sendsClient} setClient={setSendsClient} />}
            {tab === 'ops' && <OpsHost />}
            {tab === 'today' && <TodayScreen />}
            {tab === 'content' && <ContentScreen />}
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
        {settingsHashOpen && (
          <SettingsPush onBack={() => { setSettingsHashOpen(false); history.replaceState(null, '', `#${tab}`) }} />
        )}
      </div>
    )
  }

  // Mobile: thread takes over the screen; otherwise the active tab + tab bar.
  if (thread) {
    return (
      <div className="app">
        <ThreadScreen thread={thread} onBack={() => setOpenThread(null)} refresh={refresh} />
        {settingsHashOpen && (
          <SettingsPush onBack={() => { setSettingsHashOpen(false); history.replaceState(null, '', `#${tab}`) }} />
        )}
      </div>
    )
  }

  return (
    <div className="app">
      {listScreen}
      <TabBar active={tab} draftCount={draftCount} contentCount={contentBadge} onNav={nav} />
      {settingsHashOpen && (
        <SettingsPush onBack={() => { setSettingsHashOpen(false); history.replaceState(null, '', `#${tab}`) }} />
      )}
    </div>
  )
}
