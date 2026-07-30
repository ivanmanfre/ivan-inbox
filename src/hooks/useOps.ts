import { useCallback, useEffect, useId, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fetchOpsDrafts, type OpsDraft } from '../lib/ops'

export function useOps() {
  const [drafts, setDrafts] = useState<OpsDraft[]>([])
  const [loading, setLoading] = useState(true)
  // Every mount gets its own topic. supabase.channel() hands back the EXISTING
  // channel for a topic it already holds, so a second useOps() on screen would
  // bind postgres_changes to an already-subscribed channel — which throws inside
  // the effect and takes the whole tree down to a black screen. The shared
  // channel is also fatal on the way out: one consumer unmounting would
  // removeChannel() realtime out from under the other.
  const topic = `ops_drafts:${useId()}`
  const refresh = useCallback(() => {
    fetchOpsDrafts().then(rows => {
      setDrafts(rows)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])
  useEffect(() => {
    refresh()
    const ch = supabase.channel(topic)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ops_drafts' }, refresh)
      .subscribe()
    const onFocus = () => refresh()
    window.addEventListener('focus', onFocus)
    return () => { supabase.removeChannel(ch); window.removeEventListener('focus', onFocus) }
  }, [refresh, topic])
  return { drafts, loading, refresh }
}
