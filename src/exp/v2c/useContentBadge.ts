import { useCallback, useEffect, useId, useState } from 'react'
import { supabase } from '../../lib/supabase'

// The rail's Content count, as a HEAD-only count query.
//
// cand-a solved the same problem by mounting a second full useContent() beside
// the one its Content screen already mounts — safe (topics are useId-namespaced)
// but it pulls up to 1,000 rows on every screen just to render one number. The
// workbench mounts more surfaces at once than the current app does, so paying a
// full page for a badge is exactly the cost this candidate has to be careful
// about. `head: true` returns a count and zero rows.
//
// Ivan's rows carry client_id NULL, not 'ivan' (content.ts:56-60) — .eq(...,'ivan')
// renders a calm, wrong zero.
export function useContentBadge() {
  const [count, setCount] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const topic = `carousel_badge:${useId()}`

  const refresh = useCallback(() => {
    supabase.from('carousel_drafts')
      .select('id', { count: 'exact', head: true })
      .is('client_id', null)
      .eq('status', 'review')
      .then(({ count: n, error: e }) => {
        if (e) { setError(e.message); return }
        setError(null)
        setCount(n ?? 0)
      })
  }, [])

  useEffect(() => {
    refresh()
    const ch = supabase.channel(topic)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'carousel_drafts' }, refresh)
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [refresh, topic])

  return { count, error }
}
