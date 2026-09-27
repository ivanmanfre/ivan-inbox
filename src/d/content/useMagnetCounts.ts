import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import type { Trio } from './SubNav'

// The Magnets review badge (today: useGlanceCounts `magnetsReview`, lm_drafts_v2
// at review or lm_review), split per seat because D never sums seats. Ivan's
// rows carry client_id NULL; 'rise' is the legacy spelling of Rise. Read-only.
export function magnetTrio(rows: { client_id: string | null }[]): Trio {
  const t: Trio = { ivan: 0, risedtc: 0, arch: 0 }
  for (const r of rows) {
    const k = r.client_id == null ? 'ivan' : r.client_id === 'rise' ? 'risedtc' : r.client_id
    if (k === 'ivan' || k === 'risedtc' || k === 'arch') t[k] = (t[k] ?? 0) + 1
  }
  return t
}

export function useMagnetCounts(): Trio {
  const [t, setT] = useState<Trio>({ ivan: undefined, risedtc: undefined, arch: undefined })
  useEffect(() => {
    let live = true
    const read = () => {
      void supabase.from('lm_drafts_v2').select('client_id').in('status', ['review', 'lm_review']).limit(1000)
        .then(({ data, error }) => {
          if (!live) return
          setT(error ? { ivan: null, risedtc: null, arch: null } : magnetTrio((data ?? []) as { client_id: string | null }[]))
        })
    }
    read()
    const ch = supabase.channel('d-content-magnets').on('postgres_changes', { event: '*', schema: 'public', table: 'lm_drafts_v2' }, read).subscribe()
    return () => { live = false; void supabase.removeChannel(ch) }
  }, [])
  return t
}
