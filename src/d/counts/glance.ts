import { supabase } from '../../lib/supabase'
import { mergeAlerts, type AutomationAlert } from '../../lib/glance'
import { fetchWeekEvents } from '../../lib/salesPacks'
import { upcomingToday } from '../../exp/v2c/useSalesToday'

// Three of today's frame numbers D did not read (parity: frame-today rows 8, 11):
// workflow health, the Magnets review count, and Sales' "calls today not
// started". Same queries and the same rules as today's useGlanceCounts /
// useSalesToday, as plain readers the frame's provider can poll, seed and share.

/** Today's alarm window for automation failures (useGlanceCounts ALERT_WINDOW_DAYS). */
const WINDOW_DAYS = 7

export type AutomationHealth = {
  /** Corroborated failures: both health views agree it failed and stopped (`kind === 'both'`). Today's rail number. */
  urgent: AutomationAlert[]
  /** Every windowed alert, urgent first. */
  alerts: AutomationAlert[]
  olderErrored: number
  olderStalled: number
  acknowledged: number
}

export async function fetchAutomationHealth(now: number = Date.now()): Promise<AutomationHealth> {
  const cut = new Date(now - WINDOW_DAYS * 86_400_000).toISOString()
  const [wf, jobs] = await Promise.all([
    // is.true, never not.eq: `not.eq` drops NULLs, and a NULL is_active is not evidence it runs.
    supabase.from('dashboard_workflow_stats')
      .select('workflow_name, last_execution_at, last_error_message, error_acknowledged')
      .eq('last_execution_status', 'error')
      .is('is_active', true),
    supabase.from('scheduled_ops_status')
      .select('label, source, category, status, last_run_at, last_error_message')
      .is('enabled', true)
      .in('status', ['OVERDUE', 'ERRORING']),
  ])
  if (wf.error) throw wf.error
  if (jobs.error) throw jobs.error
  const m = mergeAlerts(wf.data ?? [], jobs.data ?? [], cut)
  const urgent = m.alerts.filter(a => a.kind === 'both')
  return {
    urgent,
    alerts: [...urgent, ...m.alerts.filter(a => a.kind !== 'both')],
    olderErrored: m.olderErrored, olderStalled: m.olderStalled, acknowledged: m.acknowledged,
  }
}

/** Today's sentence under the number (exp/v2c/Shell.tsx health.note), word for word. */
export function healthNote(h: AutomationHealth): string {
  const n = h.urgent.length
  if (n === 0) return ''
  return `${n} automation${n === 1 ? '' : 's'} failed and ${n === 1 ? 'has' : 'have'} stopped running. `
    + `${h.alerts.length - n} more errored in the last 7 days without stopping`
    + (h.acknowledged > 0 ? `, ${h.acknowledged} you already acknowledged` : '')
    + `, and ${h.olderErrored + h.olderStalled} have not run in a week.`
}

/** Lead magnets at review, every lane (`lm_review` folds into review, as the Magnets list shows it). */
export async function fetchMagnetsReview(): Promise<number> {
  const { data, count, error } = await supabase.from('lm_drafts_v2')
    .select('client_id', { count: 'exact' })
    .in('status', ['review', 'lm_review'])
  if (error) throw error
  // The exact count header, never the clamped row length.
  return count ?? (data ?? []).length
}

/** Sales' number: calls today (Warsaw day) that have not started yet. */
export async function fetchCallsToday(now: Date = new Date()): Promise<number> {
  const events = await fetchWeekEvents(new Date(now.getTime() - 36e5 * 36), new Date(now.getTime() + 36e5 * 36))
  return upcomingToday(events, now)
}
