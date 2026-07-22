import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fetchMessages, groupThreads, type Thread } from '../lib/inbox'
import { playChime } from '../lib/chime'

export function useInbox() {
  const [threads, setThreads] = useState<Thread[]>([])
  const [loading, setLoading] = useState(true)
  // Newest inbound timestamp we've already seen — a refresh that surfaces an
  // inbound row newer than this plays the chime. Null until first load so the
  // initial fetch never dings.
  const newestInbound = useRef<string | null>(null)
  const refresh = useCallback(() => {
    fetchMessages().then(rows => {
      const latest = rows
        .filter(m => m.direction === 'inbound')
        .map(m => m.created_at).sort().at(-1) ?? null
      if (latest && newestInbound.current && latest > newestInbound.current) playChime()
      if (latest) newestInbound.current = latest
      setThreads(groupThreads(rows))
      setLoading(false)
    }).catch(() => setLoading(false))
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
