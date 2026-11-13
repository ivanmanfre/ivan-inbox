import type { ContentDraft } from './content'
import { supabase } from './supabase'

// THE DAY'S POST CARD (db/20261112_content_daily_card). One draft of Ivan's seat is picked at 11:00 Warsaw; a
// notification rings (family content_card) and the app slides it in. These are the card's reads and writes; posting
// itself is the Review desk's own one-tap path (weekVerbs.useApproveSchedule), never a new publish path.

export type CardState = 'shown' | 'posted' | 'skipped' | 'expired'
/** Whether the card can still post: ok, or why not (its body changed elsewhere, it was decided elsewhere, it left Review). */
export type CardLive = 'ok' | 'changed' | 'decided' | 'gone'
export type CardDraft = Pick<ContentDraft, 'id' | 'client_id' | 'status' | 'type' | 'title' | 'post_body' | 'image_urls' | 'video_url'
  | 'taxonomy' | 'scheduled_at' | 'published_at' | 'created_at' | 'updated_at' | 'cb34_p2_member' | 'qa_verdict' | 'line_flags'>
export type TodayCard = {
  /** The Warsaw day (YYYY-MM-DD). */
  day: string
  state: CardState
  live: CardLive
  why: 'poland' | 'newest'
  picked_at: string
  draft: CardDraft | null
  /** The one guided question (db/20261112b_content_card_question): only while it was asked on the current text. */
  question?: CardQuestion | null
}
/** `sha` = the body hash it was asked on; `answer` = his answer if he already gave one. */
export type CardQuestion = { text: string; anchor: string; kind: string | null; sha: string; answer: string | null }

function questionOf(raw: unknown): CardQuestion | null {
  const q = raw as Partial<CardQuestion> | null
  if (!q || typeof q.text !== 'string' || !q.text.trim() || typeof q.anchor !== 'string' || typeof q.sha !== 'string') return null
  return { text: q.text, anchor: q.anchor, kind: typeof q.kind === 'string' ? q.kind : null, sha: q.sha, answer: typeof q.answer === 'string' ? q.answer : null }
}

const STATES: readonly string[] = ['shown', 'posted', 'skipped', 'expired']
const LIVES: readonly string[] = ['ok', 'changed', 'decided', 'gone']

/** Today's card, or null when none was picked today. Throws on a failed read (a failure is never "no card"). */
export async function readTodayCard(): Promise<TodayCard | null> {
  const { data, error } = await supabase.rpc('content_card_today')
  if (error) throw new Error(error.message || 'The post card could not load.')
  if (data == null) return null
  const c = data as Partial<TodayCard>
  if (typeof c.day !== 'string' || !STATES.includes(String(c.state)) || !LIVES.includes(String(c.live))) throw new Error('The post card came back malformed.')
  return { day: c.day, state: c.state as CardState, live: c.live as CardLive, why: c.why === 'poland' ? 'poland' : 'newest', picked_at: String(c.picked_at ?? ''), draft: (c.draft ?? null) as CardDraft | null, question: questionOf(c.question) }
}

/** skipped / shown (the Undo of a skip). Resolves to whether the database took it. */
export async function setCardState(day: string, draftId: string, state: 'skipped' | 'shown'): Promise<boolean> {
  const { data, error } = await supabase.rpc('content_card_set', { p_day: day, p_draft: draftId, p_state: state })
  if (error) throw new Error(error.message || 'The card did not change.')
  return !!(data as { ok?: boolean } | null)?.ok
}

/** A Post the database refused on purpose (db: content_card_post). `review`: it needs a look in Review now. */
export class CardRefused extends Error {
  readonly review: boolean
  constructor(message: string, review: boolean) { super(message); this.review = review }
}

/** Post, one transaction (db: content_card_post): card, draft and membership locked, every check (today's shown card,
 *  the draft still in review, undated, unpublished, its body hash = `bodySha` of the text shown, QA, line flags and
 *  release still good), then the existing approve (the database decides: cb39 keep verdict for a brain draft, else
 *  approveReviewDraft's update) and scheduleGuarded's update, and the card marked posted. A busy row is refused
 *  ("being changed right now", card_busy) with nothing written. Returns the scheduled_at the row holds. */
export async function postCard(day: string, draftId: string, bodySha: string, atIso: string, msToVerdict?: number): Promise<string | null> {
  const { data, error } = await supabase.rpc('content_card_post', {
    p_day: day, p_draft: draftId, p_body_sha: bodySha, p_at: atIso, p_ms_to_verdict: msToVerdict ?? null,
  })
  if (error) {
    const hint = (error as { hint?: string | null }).hint ?? ''
    if (/^card_/.test(hint)) throw new CardRefused(error.message, hint === 'card_review')
    throw new Error(error.message || 'Not posted.')
  }
  return (data as { scheduled_at?: string | null } | null)?.scheduled_at ?? null
}

/** The swap Post would do on today's card (db/20261114b_content_card_poland_swap): a Poland draft in a week short on
 *  Poland takes the slot of a business post of this week, and that post moves back. Null = Post takes the next free slot. */
export type SwapPlan = { day: string; draftId: string; incumbent: string; slotAt: string; autopilot: boolean; title: string }
export async function readSwapPlan(): Promise<SwapPlan | null> {
  const { data, error } = await supabase.rpc('content_card_swap_plan')
  if (error) throw new Error(error.message || 'The week could not be read.')
  const p = data as { day?: unknown; draft_id?: unknown; incumbent?: unknown; slot_at?: unknown; autopilot?: unknown; title?: unknown } | null
  if (!p || typeof p.day !== 'string' || typeof p.draft_id !== 'string' || typeof p.incumbent !== 'string' || typeof p.slot_at !== 'string'
    || Number.isNaN(Date.parse(p.slot_at))) return null
  return { day: p.day, draftId: p.draft_id, incumbent: p.incumbent, slotAt: p.slot_at, autopilot: p.autopilot === true, title: typeof p.title === 'string' ? p.title : '' }
}

/** Post with the swap, one transaction (db: content_card_post_swap): the business post moves to `toIso` with its queue
 *  row, then content_card_post approves this draft and dates it on the slot that post held. Any refusal undoes it all. */
export async function postCardSwap(day: string, draftId: string, bodySha: string, plan: SwapPlan, toIso: string, msToVerdict?: number): Promise<string | null> {
  const { data, error } = await supabase.rpc('content_card_post_swap', {
    p_day: day, p_draft: draftId, p_body_sha: bodySha, p_incumbent: plan.incumbent, p_incumbent_slot: plan.slotAt,
    p_incumbent_to: toIso, p_ms_to_verdict: msToVerdict ?? null,
  })
  if (error) {
    const hint = (error as { hint?: string | null }).hint ?? ''
    if (/^card_/.test(hint)) throw new CardRefused(error.message, hint === 'card_review')
    throw new Error(error.message || 'Not posted.')
  }
  return (data as { scheduled_at?: string | null } | null)?.scheduled_at ?? null
}

/** After a fix from the card: the card follows the saved body (only while that body is the stored one). */
export async function rebaseCard(day: string, draftId: string, body: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('content_card_rebase', { p_day: day, p_draft: draftId, p_body: body })
  if (error) throw new Error(error.message || 'The card did not follow the edit.')
  return data === true
}

/** His answer to the card's question, kept even if he cancels the edit; `saved`: he saved the post with it. */
export async function answerCard(day: string, draftId: string, answer: string, saved = false): Promise<boolean> {
  const { data, error } = await supabase.rpc('content_card_answer', { p_day: day, p_draft: draftId, p_answer: answer, p_saved: saved })
  if (error) throw new Error(error.message || 'The answer was not kept.')
  return data === true
}

/** The post with his answer worked in (content-card-weave). Never writes the draft: the text is a proposal for his own
 *  edit. Throws on any failure. Bare fetch, same as emailStats.ts. */
export async function weaveCard(day: string, draftId: string, bodySha: string, answer: string): Promise<string> {
  const { data } = await supabase.auth.getSession()
  if (!data.session?.access_token) throw Error('Sign in again.')
  const r = await window.fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/content-card-weave`, {
    method: 'POST', headers: { Authorization: `Bearer ${data.session.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ day, draft_id: draftId, body_sha: bodySha, answer }), signal: AbortSignal.timeout(120_000),
  })
  const result = await r.json().catch(() => ({})) as { ok?: boolean; text?: unknown; error?: string }
  if (!r.ok || !result.ok || typeof result.text !== 'string' || !result.text.trim()) throw Error(result.error || 'Not woven.')
  return result.text
}

export type SlotRow = Pick<ContentDraft, 'scheduled_at' | 'published_at' | 'status'>
/** Ivan's dated and published posts of the last 90 days: the input of seatSlotOf (the seat's own posting time). */
export async function fetchIvanSlotRows(): Promise<SlotRow[]> {
  const since = new Date(Date.now() - 90 * 86_400_000).toISOString()
  const { data, error } = await supabase.from('carousel_drafts')
    .select('scheduled_at, published_at, status')
    .is('client_id', null)
    .or(`scheduled_at.gte.${since},published_at.gte.${since}`)
    .limit(1000)
  if (error) throw error
  return (data ?? []) as SlotRow[]
}
