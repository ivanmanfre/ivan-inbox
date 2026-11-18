import { supabase } from './supabase'

// Calendar panel read (db/20261117r cp17_calendar_panel_ivan): belief and vehicle per planned post, the week's
// quotas and how full each week is, the profile-first score, profile views by contacted people in 48 hours,
// cohort rates of the newest filter period, and booking reasons. Ivan's seat only. Read only.
export type PanelSlot = { slot_id: string; week_start: string; draft_id: string | null; belief: number | null; vehicle: string | null; is_copy: boolean }
export type PanelQuota = { slot_kind: string; belief: number | null; vehicle: string | null; per_week: number | null; every_n_weeks: number; note: string | null }
export type PanelWeekFill = { week_start: string; slots: number; copies: number; no_belief: number; by_belief: Record<string, number>; by_vehicle: Record<string, number> }
export type PanelPost = { id: string; posted_at: string; first_line: string; kind: string | null; belief: number | null; vehicle: string | null; proof: boolean; him: boolean; is_copy: boolean }
export type PanelProfileFirst = { score: string; proof: boolean; outreach_belief: boolean; him: boolean; unlabeled: string[]; posts: PanelPost[] }
export type PanelViews = { posted_at: string; first_line: string; kind: string | null; contacted_viewers_48h: number; contacted_fit_viewers_48h: number | null; contacted_fit_known_48h?: number | null; baseline_per_48h: number | null; window_open: boolean }
export type PanelCohort = {
  filter_key: string; campaign_name: string | null; period_from: string | null; period_to: string | null
  top_post_kind: string | null; top_belief: number | null; top_vehicle: string | null
  invites: number; accept_base: number; accepts: number; reply_base: number; replies: number; booking_base: number; bookings: number
  accept_rate: number | null; reply_rate: number | null; booking_rate: number | null; small_n: boolean
  scorer_version?: string | number | null; note_arm?: string | null; comparable?: boolean | null; reply_small_n?: boolean | null; booking_small_n?: boolean | null
}
export type PanelBooking = { call_date: string; reason_class: string; quote: string }
export type CalendarPanel = {
  as_of: string; this_week: string
  slots: PanelSlot[]; quotas: PanelQuota[]; week_fill: PanelWeekFill[]
  profile_first: PanelProfileFirst | null
  pv48: PanelViews[]
  cohorts: { filter_key: string | null; rows: PanelCohort[]; note: string }
  booking_reasons: PanelBooking[]
  enforce: string | null
}

const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])

export function parseCalendarPanel(data: unknown): CalendarPanel {
  const d = data as (Partial<CalendarPanel> & { ok?: boolean }) | null
  if (!d || d.ok !== true || !Array.isArray(d.slots) || !Array.isArray(d.week_fill)) throw new Error('The calendar check returned no usable read.')
  const pf = d.profile_first as Partial<PanelProfileFirst> | null | undefined
  const co = (d.cohorts ?? {}) as Partial<CalendarPanel['cohorts']>
  return {
    as_of: String(d.as_of ?? ''), this_week: String(d.this_week ?? ''),
    slots: d.slots, quotas: arr<PanelQuota>(d.quotas), week_fill: d.week_fill,
    profile_first: pf && typeof pf.score === 'string' ? { score: pf.score, proof: pf.proof === true, outreach_belief: pf.outreach_belief === true, him: pf.him === true, unlabeled: arr<string>(pf.unlabeled), posts: arr<PanelPost>(pf.posts) } : null,
    pv48: arr<PanelViews>(d.pv48),
    cohorts: { filter_key: typeof co.filter_key === 'string' ? co.filter_key : null, rows: arr<PanelCohort>(co.rows), note: typeof co.note === 'string' ? co.note : '' },
    booking_reasons: arr<PanelBooking>(d.booking_reasons),
    enforce: typeof d.enforce === 'string' ? d.enforce : null,
  }
}

export async function fetchCalendarPanel(signal?: AbortSignal): Promise<CalendarPanel> {
  const q = supabase.rpc('cp17_calendar_panel_ivan')
  const { data, error } = await (signal ? q.abortSignal(signal) : q)
  if (error) throw new Error(error.message || 'The calendar check could not load.')
  return parseCalendarPanel(data)
}
