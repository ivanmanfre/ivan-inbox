/* The glance's one new read: when each seat last TRIED to send an invite.
   Source: the sender's own log (`outreach_engagement_log`, action_type
   'connection_request'), one row per attempt, success true when it went out,
   false when LinkedIn refused it. Scoped to a seat through
   prospect -> campaign.client_id (Ivan = NULL), newest row only, 14 days back.
   SELECT only. */
import { supabase } from '../../../lib/supabase'
import { SEATS, type Seat } from '../../seats'
import type { Attempt } from './model'

const LOOKBACK_DAYS = 14

type Row = { created_at: string; success: boolean | null; error_message: string | null }

export async function fetchLastAttempt(seat: Seat, now = Date.now()): Promise<Attempt | null> {
  let q = supabase.from('outreach_engagement_log')
    .select('created_at, success, error_message, p:outreach_prospects!inner(c:outreach_campaigns!inner(client_id))')
    .eq('action_type', 'connection_request')
    .gt('created_at', new Date(now - LOOKBACK_DAYS * 864e5).toISOString())
  q = seat === 'ivan' ? q.is('p.c.client_id', null) : q.eq('p.c.client_id', seat)
  const { data, error } = await q.order('created_at', { ascending: false }).limit(1)
  if (error) throw error
  const r = (data as unknown as Row[] | null)?.[0]
  return r ? { at: r.created_at, ok: r.success === true, error: r.error_message } : null
}

/** All three seats, each settling on its own: one seat's failed read never blanks another. */
export async function fetchLastAttempts(): Promise<Record<Seat, Attempt | null | 'failed'>> {
  const res = await Promise.allSettled(SEATS.map(s => fetchLastAttempt(s)))
  return Object.fromEntries(SEATS.map((s, i) => [s, res[i].status === 'fulfilled' ? (res[i] as PromiseFulfilledResult<Attempt | null>).value : 'failed'])) as Record<Seat, Attempt | null | 'failed'>
}
