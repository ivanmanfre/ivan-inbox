import { supabase } from '../../lib/supabase'
import { SCHEDULABLE } from './model'

// D Content's one write that is not called straight from lib: today's
// scheduleDraft (lib/studioActions) with the same table, the same payload
// (status='scheduled' + scheduled_at) and the same Ivan scope, plus a status
// filter so the DATABASE refuses a published, errored or generating row even
// when the screen is stale. An empty `.select()` is a refusal, not a success
// (PostgREST answers a silent 204 to an UPDATE its filter skipped).
export async function scheduleGuarded(id: string, scheduledAtIso: string): Promise<void> {
  const { data, error } = await supabase.from('carousel_drafts')
    .update({ status: 'scheduled', scheduled_at: scheduledAtIso })
    .eq('id', id).is('client_id', null)
    .in('status', [...SCHEDULABLE]).is('published_at', null)
    .select('id')
  if (error) throw error
  if (!data || data.length === 0) {
    throw new Error('Not scheduled. This draft is no longer in review, approved or scheduled (it may have been published, skipped or errored since it loaded).')
  }
}
