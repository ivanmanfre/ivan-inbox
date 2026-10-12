import { supabase } from './supabase'
import type { Lane } from '../d/content/model'
import { CLIENT_OPS_GATE } from './content'

// Content plan read model (db/252 content_plan_week): the next two weeks per account, each slot with its
// reason and evidence, topics already done, written drafts waiting, and warnings. Read only.
export type PlanEvidence = { type: string; label: string; ref?: string; at?: string; quote?: string | null }
// db/259: the content brain data per item, the plan-level brain strip. Optional: older reads carry none of it.
export type PlanFlags = { lm: boolean; boosted: boolean; founder: boolean; carousel: boolean; weekend: boolean; failed: boolean; low_score: boolean; fact_fail: boolean }
export type PlanQa = { outcome: 'passed' | 'recovered' | 'low' | 'failed' | 'hand' | null; first: number | null; final: number | null; max: number | null; pass_line: number | null; rewrites: number; approved_anyway: boolean; dims: Record<string, number> | null; weakest: string | null }
export type PlanBrainRead = { dim: string; val: string; rate: number; base: number; n: number; lo: number | null; hi: number | null; proven: boolean; small: boolean }
export type PlanBrain = {
  draft_id: string | null; words: number | null; edited: boolean; thumb: string | null; body_head: string | null; first_line: string | null; has_link: boolean
  flags: PlanFlags; qa: PlanQa | null; facts: { pass: boolean; failed: number | null; total: number | null } | null
  angle: { structure: string | null; opener: string | null } | null; trait: string | null; read: PlanBrainRead | null
  brief: { author: string | null; ratio: number | null; url: string | null; why: string | null } | null
  quote: string | null; quote_pending: boolean
  photo: { has: boolean; reason: string | null; rotation: boolean } | null
  replaced: { title: string; on: string } | null
  result: { views: number | null; reactions: number | null; comments: number | null; viral: boolean; young: boolean; url: string | null; engaged: { brand: number; total: number; usual_pct: number } | null } | null
  time_set_by: 'hand' | 'planner' | null
}
export type StripRule = { rule_id: string; name: string; metric: 'views' | 'comments'; gain: number | null; lo: number | null; hi: number | null; status: 'live' | 'shadow'; unclear: boolean; held_latest: boolean | null; your_rule: boolean; enforcer: string | null; creators: number | null }
export type BrainStrip = {
  rules: StripRule[]
  next_check: { date: string | null; watch: string[]; proposals: { id: number; rule_id: string; name: string; to_status: string; reason: string | null; kind?: string }[]; recent: { rule_id: string; name: string; to_status: string; at: string; undo_token: string | null }[] }
  reads: { items: { title: string; x: number; lo: number | null; hi: number | null; proven: boolean; small: boolean }[]; total: number }
  predictions: { measured: number; need: number; validated: boolean }
  views: { median: number | null; breakouts: number; measured: number; posts: { d: string; v: number; young: boolean }[] }
  idea_stock: { topic: string; stock: number; used: number }[]
  collection: { posts: number; creators: number } | null
  note: string | null
}
export type PlanPost = {
  kind: 'post'; draft_id?: string; queue_id?: string; title: string; day: string; at: string; status: string
  format: string | null; picture: string; lead_magnet: boolean; founder: boolean; evidence: PlanEvidence[]
  brain?: PlanBrain
}
export type PlanSlot = {
  kind: 'planned'; slot_id: string; topic: string; why_now: string; evidence: PlanEvidence[]; format: string | null
  picture: string | null; idea_source: 'lm_idea_candidates' | 'client_ideas' | 'carousel_drafts'; idea_ref: string
  proposal: boolean; status: string; status_label: string; draft_id: string | null
  /** The day this slot is meant for: the first free weekday of its week (db/255). Null = no free weekday left. */
  day?: string | null
  brain?: PlanBrain
}
export type PlanWeek = { start: string; which: 'this' | 'next' | 'after'; target: number; filled: number; open: number; posts: PlanPost[]; planned: PlanSlot[]; dated?: number; no_day?: number }
export type PlanWarning = { code: string; text: string; topic?: string }
export type PlanRead = {
  account: Lane; today: string; target: number; target_week: string | null; open: number
  state: 'two_weeks_planned' | 'planning'; proposals_only: boolean; auto_generate?: boolean; founder_story_max: number; cadence_source: string
  weeks: PlanWeek[]
  done: { title: string; day: string; format: string | null; pillar: string | null; draft_id?: string; impressions?: number | null; reactions?: number | null; comments?: number | null }[]
  warnings: PlanWarning[]; last_run: { ran_at: string; target_week: string | null; open_before: number; picked: number } | null
  done_median?: number | null; tz?: { name: string; label: string }; x_days?: string[]
  /** Null when the brain data failed to load; the plan itself still reads. brain_error then says why. */
  brain_strip?: BrainStrip | null; brain_error?: string
  supply?: { draft_id: string; title: string; format: string | null; created_at: string; brain: boolean | PlanBrain; brain_draft?: boolean; evidence: PlanEvidence[] }[]
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

/** A refused move: the server's own code (bad_gate, not_found, bad_status, bad_week, same_week, out_of_horizon, no_room). */
export class PlanMoveError extends Error {
  readonly code: string
  constructor(code: string) { super(`The plan refused the move: ${code}.`); this.name = 'PlanMoveError'; this.code = code }
}

/**
 * Move a planned slot (no draft date yet) to another week of the 3-week plan (db/263 content_plan_move_slot).
 * The server moves it only to a week with room and writes the slot's week and nothing else: no draft is dated,
 * scheduled or published. Same operator gate as the other operator_* writes.
 */
export async function moveSlotWeek(slotId: string, week: string): Promise<{ from_week: string; to_week: string }> {
  const { data, error } = await supabase.rpc('content_plan_move_slot', { p_gate: CLIENT_OPS_GATE, p_slot: slotId, p_week: week })
  if (error) throw new Error(error.message || 'The move could not reach the plan.')
  const r = (data ?? {}) as { ok?: boolean; error?: string; from_week?: string; to_week?: string }
  if (r.ok !== true) throw new PlanMoveError(typeof r.error === 'string' ? r.error : 'unknown')
  return { from_week: String(r.from_week ?? ''), to_week: String(r.to_week ?? week) }
}

/** A refused brain action: the server's own code (bad_gate, bad_args, not_open) or `failed` when the call itself raised. */
export class BrainActionError extends Error {
  readonly code: string
  constructor(code: string) { super(`The brain refused the change: ${code}.`); this.name = 'BrainActionError'; this.code = code }
}

/**
 * Accept or dismiss one change the brain held back (db/264 operator_brain_proposal_decide, which calls
 * brain_proposal_accept / brain_proposal_dismiss as 'ivan'). The server passes the rule change through; a proposal that
 * is no longer open makes accept raise and dismiss answer {dismissed:false}: both come back as a BrainActionError.
 */
export async function decideProposal(id: number, accept: boolean): Promise<void> {
  const { data, error } = await supabase.rpc('operator_brain_proposal_decide', { p_gate: CLIENT_OPS_GATE, p_id: id, p_accept: accept })
  if (error) {
    const m = error.message ?? ''
    throw new BrainActionError(/not an open proposal/i.test(m) ? 'not_open' : /direction change/i.test(m) ? 'by_hand' : 'failed')
  }
  const r = (data ?? {}) as { ok?: boolean; error?: string; dismissed?: boolean; skipped?: string }
  if (r.ok === false) throw new BrainActionError(typeof r.error === 'string' ? r.error : 'failed')
  if (!accept && r.dismissed !== true) throw new BrainActionError('not_open')
  // The rule change itself can be skipped by the brain's own guards (a rule you locked, a rule already in that state).
  if (accept && typeof r.skipped === 'string') throw new BrainActionError(`skipped_${r.skipped}`)
}

/** Put a rule change back (db/264 operator_brain_rule_undo -> brain_rule_undo, which also vetoes the rule so the brain does not retry it). The token comes from `next_check.recent`. */
export async function undoRuleChange(token: string): Promise<void> {
  const { data, error } = await supabase.rpc('operator_brain_rule_undo', { p_gate: CLIENT_OPS_GATE, p_token: token })
  if (error) throw new BrainActionError('failed')
  const r = (data ?? {}) as { ok?: boolean; error?: string; already_rolled_back?: boolean }
  if (r.ok === false || typeof r.error === 'string') throw new BrainActionError(typeof r.error === 'string' ? r.error : 'failed')
  // A change that was already put back is not a second success: nothing happened this time.
  if (r.already_rolled_back === true) throw new BrainActionError('not_open')
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
