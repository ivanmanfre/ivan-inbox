import { useEffect, useMemo, useState } from 'react'
import type { Thread } from '../../lib/inbox'
import { fetchEmailDetails } from '../../lib/emailDetails'
import { hydrateEmailDetails, type EmailDetailRow } from '../../lib/emailPresentation'

export function useEmailDetails(t: Thread) {
  const [retry, setRetry] = useState(0)
  const [read, setRead] = useState<{ key: string; idKey: string; rows?: EmailDetailRow[]; error?: string } | null>(null)
  const hasEmail = t.messages.some(m => m.channel === 'email' || m.email_mirror_text || m.recipient_email)
  // `idKey` moves only when a message is added, removed or sent. `key` also moves when an autosave changes a
  // draft's text, which refetches the rows but must not grey out the editors the user is typing in.
  const idKey = hasEmail ? `${t.prospect_id}:${t.messages.map(m => `${m.id}:${m.sent_at ?? ''}`).join('|')}` : ''
  const key = hasEmail ? `${t.prospect_id}:${t.messages.map(m => `${m.id}:${m.sent_at ?? ''}:${m.message_text.length}`).join('|')}` : ''
  useEffect(() => {
    if (!key) return
    let current = true
    void fetchEmailDetails(t.prospect_id, t.messages.map(m => m.id)).then(rows => {
      if (current) setRead({ key, idKey, rows })
    }).catch(() => {
      if (current) setRead({ key, idKey, error: 'Email headers could not be loaded. Refresh email details to try again.' })
    })
    return () => { current = false }
  }, [key, retry, t.messages]) // eslint-disable-line react-hooks/exhaustive-deps
  const settled = read?.key === key
  // While a text-only refetch runs, keep the last rows but let the fresh local copy win on the fields an autosave writes.
  const staleRows = useMemo(() => !settled && read?.idKey === idKey && read.rows ? read.rows.map(withoutSavedFields) : null, [settled, read, idKey])
  const rows = settled ? read.rows : staleRows
  const thread = useMemo(() => rows ? hydrateEmailDetails(t, rows) : t, [t, rows])
  return { thread, loading: !!key && read?.idKey !== idKey, settling: !!key && read?.idKey === idKey && !settled, error: settled ? read.error : null, retry: () => { setRead(null); setRetry(n => n + 1) } }
}

/** The fields a draft autosave rewrites: the local copy is newer than these rows until the refetch lands. */
function withoutSavedFields(r: EmailDetailRow): EmailDetailRow {
  const { email_composition, email_mirror_composition, email_subject, email_cc, ...rest } = r // eslint-disable-line @typescript-eslint/no-unused-vars
  return rest
}
