import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { ActionRow, DraftCard } from '../desk/Desk'
import { cancelAction, commitAction, undoAction } from '../desk/api'
import { asMessage, MESSAGE_COLS, olderThan, type DeskMessage } from '../desk/model'

/** Fetch the original owner-visible artifact. Its action journal stays in Content Desk. */
export function ContentArtifact({ id, choose, request, setText }: {
  id: string; choose: boolean; request: string; setText: (text: string) => void
}) {
  const [message, setMessage] = useState<DeskMessage | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  const accept = useCallback((m: DeskMessage) => {
    if (m.id !== id) return
    setMessage(prev => prev && prev.id === id && olderThan(m, prev) ? prev : m)
    setUnavailable(false)
  }, [id])
  const refresh = useCallback(async () => {
    const { data, error } = await supabase.from('desk_messages').select(MESSAGE_COLS).eq('id', id).maybeSingle()
    if (error || !data) { setUnavailable(true); return }
    accept(asMessage(data as DeskMessage))
  }, [accept, id])
  useEffect(() => {
    void refresh()
    const whenVisible = () => { if (!document.hidden) void refresh() }
    document.addEventListener('visibilitychange', whenVisible)
    return () => document.removeEventListener('visibilitychange', whenVisible)
  }, [refresh])
  const pending = message?.meta.actions?.some(a => ['held', 'committing', 'undoing', 'unconfirmed'].includes(a.state))
  useEffect(() => {
    if (!pending) return
    // ActionRow also refreshes around its countdown. This covers another device
    // committing or cancelling while the current tab remains open.
    const ch = supabase.channel('main-content-action:' + id)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'desk_messages', filter: 'id=eq.' + id }, () => void refresh())
      .subscribe(status => { if (status === 'SUBSCRIBED') void refresh() })
    return () => { void supabase.removeChannel(ch) }
  }, [id, pending, refresh])
  const act = async (kind: 'undo' | 'commit' | 'cancel', actionId: string) => {
    const result = await (kind === 'undo' ? undoAction(actionId) : kind === 'commit' ? commitAction(actionId) : cancelAction(actionId))
    if (result.message) accept(result.message)
    else void refresh()
    return result
  }
  if (unavailable) return <button type="button" className="dcl-link" onClick={() => void refresh()}>Content details unavailable. Retry</button>
  if (message?.id !== id) return null
  const cards = message.meta.drafts ?? []
  const cardRows = cards.map(card => choose
      ? <button key={card.id ?? card.handle} type="button" className="dcl-seg" onClick={() =>
        setText('Content: ' + request.replace(/^content:\s*/i, '').replace(/\b(it|this one|that one)\b/i, () => 'the post that starts “' + card.first_line + '”'))}>{card.first_line}</button>
      : <DraftCard key={card.id ?? card.handle} d={card} />)
  return <div className="dk dcl-content-artifact">
    {!choose && cards.length > 1 ? <details><summary>Open a post ({cards.length})</summary>{cardRows}</details> : cardRows}
    {!choose && message.meta.actions?.map(a => <ActionRow key={a.id} a={a} at={message.created_at} desk={{ act, refresh }} />)}
    {!choose && message.meta.chips?.map(chip => <button type="button" className="dcl-seg" key={chip.send}
      onClick={() => setText('Content: ' + chip.send)}>{chip.send}</button>)}
  </div>
}
