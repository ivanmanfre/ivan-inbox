import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fetchOpsDrafts, type OpsDraft } from '../lib/ops'

export function useOps() {
  const [drafts, setDrafts] = useState<OpsDraft[]>([])
  const [loading, setLoading] = useState(true)
  const refresh = useCallback(() => {
    fetchOpsDrafts().then(rows => {
      setDrafts(rows)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])
  useEffect(() => {
    refresh()
    const ch = supabase.channel('ops_drafts')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ops_drafts' }, refresh)
      .subscribe()
    const onFocus = () => refresh()
    window.addEventListener('focus', onFocus)
    return () => { supabase.removeChannel(ch); window.removeEventListener('focus', onFocus) }
  }, [refresh])
  return { drafts, loading, refresh }
}
