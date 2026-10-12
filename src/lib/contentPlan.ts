import { supabase } from './supabase'
import type { Lane } from '../d/content/model'

// Content plan read model (db/252 content_plan_week): the next two weeks per account, each slot with its
// reason and evidence, topics already done, written drafts waiting, and warnings. Read only.
export type PlanEvidence = { type: string; label: string; ref?: string; at?: string; quote?: string | null }
export type PlanPost = {
  kind: 'post'; draft_id?: string; queue_id?: string; title: string; day: string; at: string; status: string
  format: string | null; picture: string; lead_magnet: boolean; founder: boolean; evidence: PlanEvidence[]
}
export type PlanSlot = {
  kind: 'planned'; slot_id: string; topic: string; why_now: string; evidence: PlanEvidence[]; format: string | null
  picture: string | null; idea_source: 'lm_idea_candidates' | 'client_ideas' | 'carousel_drafts'; idea_ref: string
  proposal: boolean; status: string; status_label: string; draft_id: string | null
  /** The day this slot is meant for: the first free weekday of its week (db/255). Null = no free weekday left. */
  day?: string | null
}
export type PlanWeek = { start: string; which: 'this' | 'next' | 'after'; target: number; filled: number; open: number; posts: PlanPost[]; planned: PlanSlot[]; dated?: number; no_day?: number }
export type PlanWarning = { code: string; text: string }
export type PlanRead = {
  account: Lane; today: string; target: number; target_week: string | null; open: number
  state: 'two_weeks_planned' | 'planning'; proposals_only: boolean; auto_generate?: boolean; founder_story_max: number; cadence_source: string
  weeks: PlanWeek[]; done: { title: string; day: string; format: string | null; pillar: string | null }[]
  warnings: PlanWarning[]; last_run: { ran_at: string; target_week: string | null; open_before: number; picked: number } | null
}

export function parsePlan(data: unknown, lane: Lane): PlanRead {
  const d = data as Partial<PlanRead> & { ok?: boolean } | null
  if (!d || d.ok !== true || d.account !== lane) throw new Error('The plan returned no usable read.')
  // A plan always carries three weeks (this, next, the week after). Fewer is a failed read, never an empty plan.
  if (!Array.isArray(d.weeks) || d.weeks.length !== 3) throw new Error('The plan returned no weeks.')
  if (!Array.isArray(d.done) || !Array.isArray(d.warnings)) throw new Error('The plan returned a partial read.')
  return d as PlanRead
}

export async function fetchPlan(lane: Lane, signal?: AbortSignal): Promise<PlanRead> {
  const q = supabase.rpc('content_plan_week', { p_account: lane })
  const { data, error } = await (signal ? q.abortSignal(signal) : q)
  if (error) throw new Error(error.message || 'The plan could not load.')
  return parsePlan(data, lane)
}

/** "Mon 19 Oct" from an ISO date (date-only, read as a calendar day). */
export function planDay(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`)
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
}
export function weekLabel(w: Pick<PlanWeek, 'start' | 'which'>): string {
  const name = w.which === 'this' ? 'This week' : w.which === 'next' ? 'Next week' : 'Week after'
  return `${name} · from ${planDay(w.start).replace(/^\w+ /, '')}`
}
const FORMAT: Record<string, string> = { text: 'Text', post: 'Text', single_image: 'Image', image: 'Image', carousel: 'Carousel', pdf: 'Carousel', video: 'Video' }
export const formatWord = (f: string | null | undefined) => (f ? FORMAT[f] ?? f.replace(/_/g, ' ') : 'Format open')
const STATUS: Record<string, string> = { published: 'Published', scheduled: 'Scheduled', approved: 'Approved', review: 'Waiting for approval', pending: 'In the publish queue', posted: 'Published' }
export const postStatus = (lane: Lane, s: string) => (lane === 'arch' && s === 'review' ? 'Waiting for Davorin' : STATUS[s] ?? s)

/** What the picture line says. The planner stores a few machine phrases; the card shows plain ones. */
export function pictureWord(p: string | null | undefined): string {
  if (!p) return 'Picture chosen when written'
  if (/^decided when drafted$/i.test(p)) return 'Picture chosen when written'
  if (/^photo if one fits/i.test(p)) return 'Photo if one fits'
  return p.charAt(0).toUpperCase() + p.slice(1)
}

// Display only: some drafts were written in Title Case, others in sentence case. A title whose long words all start
// with a capital is shown in sentence case. Acronyms, words with digits or inner capitals, "I" and known names stay.
// Nothing stored changes.
const NAMES = new Set(['Meta', 'Google', 'Shopify', 'Amazon', 'Facebook', 'Instagram', 'LinkedIn', 'TikTok', 'YouTube', 'Klaviyo', 'Pinterest',
  'Apple', 'Walmart', 'Costco', 'Stripe', 'PayPal', 'Slack', 'Reddit', 'Snapchat', 'Gemini', 'Claude', 'ChatGPT', 'OpenAI', 'Mattan', 'Davorin',
  'Ivan', 'Black', 'Friday', 'Cyber', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Saturday', 'Sunday', 'January', 'February', 'March',
  'April', 'June', 'July', 'August', 'September', 'October', 'November', 'December', 'American', 'European', 'US', 'UK', 'EU'])
const bare = (w: string) => w.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '')
export function displayTitle(title: string | null | undefined): string {
  const t = (title ?? '').trim()
  if (!t) return ''
  const words = t.split(/\s+/)
  const long = words.map(bare).filter(w => w.length >= 4 && /[a-z]/.test(w))
  if (long.length < 5 || !long.every(w => /^[A-Z]/.test(w))) return t
  return words.map((w, i) => {
    const b = bare(w)
    if (!b) return w
    const first = i === 0 || /[:.?!]$/.test(words[i - 1] ?? '')
    if (/^[A-Z]{2,}$/.test(b) || /[0-9]/.test(b) || /[a-z][A-Z]/.test(b) || /^I(['’][a-z]+)?$/.test(b) || NAMES.has(b)) return w
    const lower = w.replace(b, b.toLowerCase())
    return first ? lower.replace(/[a-z]/, c => c.toUpperCase()) : lower
  }).join(' ')
}
