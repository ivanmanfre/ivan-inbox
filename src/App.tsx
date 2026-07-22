import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import { LoginScreen } from './screens/LoginScreen'
import { InboxScreen } from './screens/InboxScreen'
import { ThreadScreen } from './screens/ThreadScreen'
import { DraftsScreen } from './screens/DraftsScreen'
import { SettingsScreen } from './screens/SettingsScreen'
import { SendsScreen } from './screens/SendsScreen'
import { TabBar } from './components/TabBar'
import { useInbox } from './hooks/useInbox'
import type { Filter } from './lib/inbox'

type Route = 'inbox' | 'drafts' | 'sends' | 'settings' | { thread: string }

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true) })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])
  if (!ready) return null
  if (!session) return <LoginScreen />
  return <Shell />
}

function Shell() {
  const [route, setRoute] = useState<Route>('inbox')
  const [filter, setFilter] = useState<Filter>('all')
  const [sendsClient, setSendsClient] = useState<'all' | 'ivan' | 'risedtc'>('all')
  const { threads, loading, refresh } = useInbox()
  const draftCount = threads.filter(t => t.draft).length

  if (loading && threads.length === 0) {
    return <div className="app"><div className="loading">Loading…</div></div>
  }

  if (typeof route === 'object') {
    const thread = threads.find(t => t.prospect_id === route.thread)
    if (thread) {
      return (
        <div className="app">
          <ThreadScreen thread={thread} onBack={() => setRoute('inbox')} refresh={refresh} />
        </div>
      )
    }
  }

  const active: 'inbox' | 'drafts' | 'sends' | 'settings' = typeof route === 'string' ? route : 'inbox'

  return (
    <div className="app">
      {active === 'inbox' && (
        <InboxScreen
          threads={threads}
          filter={filter}
          setFilter={setFilter}
          onOpenThread={id => setRoute({ thread: id })}
          onOpenDrafts={() => setRoute('drafts')}
        />
      )}
      {active === 'drafts' && (
        <DraftsScreen threads={threads} onOpenThread={id => setRoute({ thread: id })} refresh={refresh} />
      )}
      {active === 'sends' && (
        <SendsScreen client={sendsClient} setClient={setSendsClient} />
      )}
      {active === 'settings' && <SettingsScreen />}
      <TabBar active={active} draftCount={draftCount} onNav={t => setRoute(t)} />
    </div>
  )
}
