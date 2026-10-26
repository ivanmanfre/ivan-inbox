import { useEffect, useMemo, useState } from 'react'
import type { Thread } from '../../lib/inbox'
import { fetchEmailDetails } from '../../lib/emailDetails'
import { hydrateEmailDetails, type EmailDetailRow } from '../../lib/emailPresentation'

export function useEmailDetails(t: Thread) {
  const [retry, setRetry] = useState(0)
  const [read, setRead] = useState<{ key: string; rows?: EmailDetailRow[]; error?: string } | null>(null)
  const hasEmail = t.messages.some(m => m.channel === 'email' || m.email_mirror_text || m.recipient_email)
  const key = hasEmail ? `${t.prospect_id}:${t.messages.map(m => `${m.id}:${m.sent_at ?? ''}:${m.message_text.length}`).join('|')}` : ''
  useEffect(() => {
    if (!key) return
    let current = true
    void fetchEmailDetails(t.prospect_id, t.messages.map(m => m.id)).then(rows => {
      if (current) setRead({ key, rows })
    }).catch(() => {
      if (current) setRead({ key, error: 'Email headers could not be loaded. Refresh email details to try again.' })
    })
    return () => { current = false }
  }, [key, retry, t.messages]) // eslint-disable-line react-hooks/exhaustive-deps
  const rows = read?.key === key ? read.rows : null
  const thread = useMemo(() => rows ? hydrateEmailDetails(t, rows) : t, [t, rows])
  return { thread, loading: !!key && read?.key !== key, error: read?.key === key ? read.error : null, retry: () => { setRead(null); setRetry(n => n + 1) } }
}
