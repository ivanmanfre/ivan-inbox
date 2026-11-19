// Stop (2026-11-19, Sol r1/r2): Ivan's Stop and the turn's own end of generation race on ONE row, his question.
// Each side writes its stamp only while the other's is absent (compare-and-set), so exactly one wins.

/**
 * Stop (2026-11-19): marks Ivan's own question row; the turn answering it reads the mark while the model writes
 * and stops there. A turn already past the model (planning or saving) finishes as normal.
 */
// deno-lint-ignore no-explicit-any
export async function stopTurn(svc: any, userId: string, clientKey: string): Promise<{ ok: boolean; error?: string }> {
  if (!clientKey) return { ok: false, error: 'bad_key' }
  const { data: row, error } = await svc.from('desk_messages').select('id, meta').eq('user_id', userId).eq('role', 'user').eq('client_key', clientKey).maybeSingle()
  if (error) return { ok: false, error: 'read_failed' }
  if (!row) return { ok: false, error: 'not_found' }
  if ((row.meta as { gen_done_at?: string } | null)?.gen_done_at) return { ok: false, error: 'too_late' }
  // compare-and-set against the turn's own stamp (closeStopWindow): a turn already past the model wins
  const { data: won, error: uErr } = await svc.from('desk_messages').update({ meta: { ...(row.meta ?? {}), stop_at: new Date().toISOString() } })
    .eq('id', row.id).filter('meta->>gen_done_at', 'is', null).select('id')
  if (uErr) return { ok: false, error: 'write_failed' }
  return Array.isArray(won) && won.length === 1 ? { ok: true } : { ok: false, error: 'too_late' }
}

/**
 * The turn's side of Stop: 'go' = generation is over and no Stop came first, so planning may run; 'stopped' = a Stop
 * won; 'error' = the row could not be read or written (Sol r3: the turn then fails as an error, never runs, never
 * pretends Ivan stopped it).
 */
// deno-lint-ignore no-explicit-any
export async function closeStopWindow(svc: any, questionId: string): Promise<'go' | 'stopped' | 'error'> {
  const { data: row, error } = await svc.from('desk_messages').select('meta').eq('id', questionId).maybeSingle()
  if (error || !row) return 'error'
  if ((row.meta as { stop_at?: string } | null)?.stop_at) return 'stopped'
  const { data: won, error: uErr } = await svc.from('desk_messages').update({ meta: { ...(row.meta ?? {}), gen_done_at: new Date().toISOString() } })
    .eq('id', questionId).filter('meta->>stop_at', 'is', null).select('id')
  if (uErr || !Array.isArray(won)) return 'error'
  return won.length === 1 ? 'go' : 'stopped'
}
