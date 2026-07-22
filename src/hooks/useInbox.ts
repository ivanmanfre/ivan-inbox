import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fetchMessages, groupThreads, type Thread } from '../lib/inbox'

export function useInbox() {
  const [threads, setThreads] = useState<Thread[]>([])
  const [loading, setLoading] = useState(true)
  const refresh = useCallback(() => {
    fetchMessages().then(rows => { setThreads(groupThreads(rows)); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])
  useEffect(() => {
    refresh()
    const ch = supabase.channel('inbox')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'outreach_messages' }, refresh)
      .subscribe()
    const onFocus = () => refresh()
    window.addEventListener('focus', onFocus)
    return () => { supabase.removeChannel(ch); window.removeEventListener('focus', onFocus) }
  }, [refresh])
  return { threads, loading, refresh }
}
