import { supabase } from './supabase'
import { isPendingSend, type InboxMessage } from './inbox'

// Read only the queue decision and the reaction flag. Full scan evidence can be large.
// An unavailable read leaves the inbound visible for review.
export async function withReactionQueues(rows: InboxMessage[]): Promise<InboxMessage[]> {
  const candidates = rows.filter(m => m.client_id === 'swishdm' && m.prospect_stage === 'swishdm_connected')
  const prospects = new Set(candidates.filter(m => m.message_type === 'dm' && isPendingSend(m)).map(m => m.prospect_id))
  const reacted = new Set(candidates.filter(m => m.direction === 'inbound').map(m => m.prospect_id))
  const ids = candidates.filter(m => prospects.has(m.prospect_id) && reacted.has(m.prospect_id) && (m.direction === 'inbound' || isPendingSend(m))).map(m => m.id)
  if (!ids.length) return rows

  const updates = new Map<string, Pick<InboxMessage, 'is_reaction' | 'reactionQueueAt'>>()
  for (let i = 0; i < ids.length; i += 60) {
    const { data, error } = await supabase.from('outreach_messages')
      .select('id,is_reaction,sequence_step,lane:draft_evidence->>lane,queue_state:draft_evidence->dm_queue->>state,queue_reason:draft_evidence->dm_queue->>reason,due_at:draft_evidence->dm_queue->>due_at,stopped:draft_evidence->stopped,deferred:draft_evidence->send_deferred,sent_at,approved_at,send_blocked_reason,send_blocked_at')
      .in('id', ids.slice(i, i + 60))
    if (error) throw error
    for (const row of data ?? []) {
      const queued = row.sequence_step === 1 && row.lane === 'swishdm_first_list' && row.approved_at && !row.sent_at
        && !row.send_blocked_at && !row.send_blocked_reason && !row.stopped && !row.deferred
        && row.queue_state === 'queued' && row.queue_reason === 'reaction_fast_path'
      updates.set(row.id, { is_reaction: row.is_reaction === true, reactionQueueAt: queued ? row.due_at : null })
    }
  }
  return rows.map(m => updates.has(m.id) ? { ...m, ...updates.get(m.id) } : m)
}
