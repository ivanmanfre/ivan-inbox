import { useState } from 'react'
import { unpublishPost } from '../../lib/content'
import { useDConfirm } from '../ui/confirm'
import { useToast } from '../ui/toast'

/** The existing publisher removal, directly on its posted planner row. */
export function Unpublish({ id, onDone }: { id: string; onDone: () => void }) {
  const confirm = useDConfirm()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const run = async () => {
    if (!await confirm({ title: 'Take this post off LinkedIn?', message: 'Deletes it from your feed for everyone, likes and comments included. The row moves to cancelled here. This cannot be undone.', confirmText: 'Unpublish', danger: true, verb: 'confirm' })) return
    setBusy(true)
    try { await unpublishPost(id); onDone(); toast.show({ message: 'Removed from LinkedIn.' }) }
    catch (e) { toast.show({ message: e instanceof Error ? e.message : 'Could not unpublish it.', tone: 'failed' }) }
    finally { setBusy(false) }
  }
  return <button type="button" className="cn-unpublish" data-verb="unpublish" disabled={busy} onClick={() => { void run() }}>{busy ? 'Removing…' : 'Unpublish'}</button>
}
