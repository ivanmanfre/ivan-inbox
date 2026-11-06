import { supabase } from '../../lib/supabase'
import { SCHEDULABLE, isPastSchedule } from './model'

// D Content's one write that is not called straight from lib: today's
// scheduleDraft (lib/studioActions) with the same table, the same payload
// (status='scheduled' + scheduled_at) and the same Ivan scope, plus a status
// filter so the DATABASE refuses a published, errored or generating row even
// when the screen is stale. An empty `.select()` is a refusal, not a success
// (PostgREST answers a silent 204 to an UPDATE its filter skipped).
// A time that already passed is refused here, as operator_set_schedule_date does
// (past_date): it would publish on the next tick. Returns the scheduled_at the
// row now holds, because the weekday guard trigger can store another day than
// the one asked for; callers say that day (armedReceipt), not the requested one.
export async function scheduleGuarded(id: string, scheduledAtIso: string): Promise<string | null> {
  if (isPastSchedule(scheduledAtIso)) throw new Error('That time has already passed. Pick a later time.')
  const { data, error } = await supabase.from('carousel_drafts')
    .update({ status: 'scheduled', scheduled_at: scheduledAtIso })
    .eq('id', id).is('client_id', null)
    .in('status', [...SCHEDULABLE]).is('published_at', null)
    .select('id, scheduled_at')
  if (error) throw error
  if (!data || data.length === 0) {
    throw new Error('Not scheduled. This draft is no longer in review, approved or scheduled (it may have been published, skipped or errored since it loaded).')
  }
  return (data[0] as { scheduled_at?: string | null }).scheduled_at ?? null
}

/**
 * GOING STALE (review 2026-11-06 #30): Archive for an undated review draft of Ivan's seat. Nothing is deleted, the
 * row only moves to 'archived'. The filter refuses a draft that moved on since it loaded (dated, approved,
 * published); an empty `.select()` is that refusal. Called once the Undo window has passed (decisions.ts).
 */
export async function archiveStaleDraft(id: string): Promise<void> {
  const { data, error } = await supabase.from('carousel_drafts')
    .update({ status: 'archived' })
    .eq('id', id).is('client_id', null).eq('status', 'review')
    .is('published_at', null).is('scheduled_at', null)
    .select('id')
  if (error) throw error
  if (!data || data.length === 0) throw new Error('Not archived: this draft changed since it loaded.')
}
