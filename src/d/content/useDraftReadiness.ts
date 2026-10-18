import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { qaForCopy, sourceForCopy, type CopyReadiness } from '../../lib/contentReadiness'
import type { ContentDraftDetail } from '../../lib/content'

export function useDraftReadiness(d: ContentDraftDetail) {
  const key = `${d.id}:${d.post_body ?? ''}`
  const [read, setRead] = useState<{ key: string; hash: string | null; data: CopyReadiness | null } | null>(null)
  useEffect(() => {
    let live = true, sequence = 0
    const refresh = async () => {
      const n = ++sequence
      try {
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(d.post_body ?? ''))
        const hash = [...new Uint8Array(digest)].map(v => v.toString(16).padStart(2, '0')).join('')
        const { data, error } = await supabase.rpc('content_copy_readiness', { p_draft: d.id, p_body_sha: hash })
        if (live && sequence === n) setRead({ key, hash, data: error ? null : data as CopyReadiness })
      } catch { if (live && sequence === n) setRead({ key, hash: null, data: null }) }
    }
    void refresh()
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void refresh() }, 60_000)
    const focus = () => { void refresh() }
    window.addEventListener('focus', focus)
    return () => { live = false; sequence++; clearInterval(timer); window.removeEventListener('focus', focus) }
  }, [d.id, d.post_body, key])
  const current = read?.key === key ? read : null
  return { loading: !current, qa: qaForCopy(d.qa, current?.hash ?? null), source: sourceForCopy(current?.data ?? null, current?.hash ?? null) }
}
