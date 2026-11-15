import { supabase } from './supabase'
import { currentUserId } from './swr'
import type { InboxMessage } from './inbox'

// The parity-proven first-rows RPC (complete histories for every Needs-you candidate across seats),
// one reader for the frame's DM counts (d/counts/dmDrafts) and the inbox's priority paint (inboxLoad).
// Concurrent asks share the request. `reuseMs` lets a caller take a read that STARTED that recently:
// the inbox's paint, which starts ~4 s after the counts' read on every place (2026-11-15 speed
// review: the same ~1 MB went out twice on every open). The counts keep reuseMs 0, so every count
// refresh asks again. A different signed-in user never joins another user's read. Null = the RPC
// is absent (PGRST202), so the caller takes its old path.
type Flight = { p: Promise<InboxMessage[] | null>; at: number; done: boolean; ok: boolean }
const flights = new Map<string, Flight>()

export function readFirstRows(reuseMs = 0, now: () => number = () => Date.now()): Promise<InboxMessage[] | null> {
  const user = currentUserId()
  const hit = user ? flights.get(user) : undefined
  if (hit && (!hit.done || (hit.ok && now() - hit.at < reuseMs))) return hit.p
  const p = Promise.resolve(supabase.rpc('inbox_phone_first_rows_r2', {}, { get: true })).then(({ data, error }) => {
    if (error?.code === 'PGRST202') return null
    if (error) throw error
    if (!Array.isArray(data)) throw new Error('Could not read DM count threads')
    return data as InboxMessage[]
  })
  if (user) {
    const f: Flight = { p, at: now(), done: false, ok: false }
    flights.set(user, f)
    p.then(() => { f.done = true; f.ok = true }, () => { f.done = true; if (flights.get(user) === f) flights.delete(user) })
  }
  return p
}
