import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import { LoginScreen } from './screens/LoginScreen'
import { InboxScreen } from './screens/InboxScreen'
import { ThreadScreen } from './screens/ThreadScreen'
import { DraftsScreen } from './screens/DraftsScreen'
import { SettingsScreen } from './screens/SettingsScreen'
import { SendsScreen } from './screens/SendsScreen'
import { OpsScreen } from './screens/OpsScreen'
import { TabBar } from './components/TabBar'
import { InboxSkeleton } from './components/Skeleton'
import { useInbox } from './hooks/useInbox'
import { useDesktop } from './hooks/useDesktop'
import type { Filter } from './lib/inbox'

type Tab = 'inbox' | 'drafts' | 'sends' | 'ops' | 'settings'

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
          else supabase.auth.refreshSession()
        })
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      sub.subscription.unsubscribe()
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])
  if (!ready) return null
  if (!session) return <LoginScreen />
  return <Shell />
}

function Shell() {
  const [tab, setTab] = useState<Tab>('inbox')
  const [openThread, setOpenThread] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [sendsClient, setSendsClient] = useState<'all' | 'ivan' | 'risedtc'>('all')
  const { threads, loading, refresh } = useInbox()
  const desktop = useDesktop()
  const draftCount = threads.filter(t => t.draft).length

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
        <DraftsScreen threads={threads} onOpenThread={setOpenThread} refresh={refresh} />
      )}
      {tab === 'sends' && (
        <SendsScreen client={sendsClient} setClient={setSendsClient} />
      )}
      {tab === 'ops' && <OpsScreen />}
      {tab === 'settings' && <SettingsScreen />}
    </>
  )

  const nav = (t: Tab) => { setTab(t); if (!desktop) setOpenThread(null) }

  // Desktop: rail + list column + conversation pane, side by side.
  // The Sends and Ops tabs have no conversation, so they span the full content
  // width instead of the list+detail split (which would waste half the screen).
  if (desktop) {
    return (
      <div className="app dt">
        <TabBar active={tab} draftCount={draftCount} onNav={nav} />
        {tab === 'sends' || tab === 'ops' ? (
          <div className="dt-full">
            {tab === 'sends'
              ? <SendsScreen client={sendsClient} setClient={setSendsClient} />
              : <OpsScreen />}
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
