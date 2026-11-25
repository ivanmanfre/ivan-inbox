import type { InboxMessage } from './inbox'
import { supabase } from './supabase'
import { currentUserId } from './swr'

type Park = { id: string; inbound_id: string; next_touch_after: string }
const flights = new Map<string, Promise<Map<string, Park>>>()

// The list and the per-seat badge share the read. A newer inbound can arrive
// before the worker clears the prospect's park, so bind it to its exact row.
export function fetchDeferredCheckbacks(): Promise<Map<string, Park>> {
  const user = currentUserId()
  const pending = user ? flights.get(user) : undefined
  if (pending) return pending
  const read = Promise.resolve().then(() => supabase.from('outreach_prospects')
      .select('id,next_touch_after,inbound_id:enrichment_data->deferred_reply->>inbound_id')
      .eq('skip_reason', 'deferred_reply')
      .eq('enrichment_data->deferred_reply->>who', 'us')
      .not('next_touch_after', 'is', null)
      .order('next_touch_after')
      .limit(1000))
      .then(({ data, error }) => {
        if (error) throw error
        if (user !== currentUserId()) return new Map<string, Park>()
        return new Map(((data ?? []) as Park[]).filter(p => p.inbound_id).map(p => [p.id, p]))
      })
      .finally(() => { if (user) flights.delete(user) })
  if (user) flights.set(user, read)
  return read
}

export function withDeferredCheckbacks(rows: InboxMessage[], parks: Map<string, Park>): InboxMessage[] {
  return rows.map(m => {
    const park = parks.get(m.prospect_id)
    return park?.inbound_id === m.id ? { ...m, deferred_checkback_at: park.next_touch_after } : m
  })
}
