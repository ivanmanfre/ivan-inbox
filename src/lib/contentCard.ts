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
  return { day: c.day, state: c.state as CardState, live: c.live as CardLive, why: c.why === 'poland' ? 'poland' : 'newest', picked_at: String(c.picked_at ?? ''), draft: (c.draft ?? null) as CardDraft | null }
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

/** After a fix from the card: the card follows the saved body (only while that body is the stored one). */
export async function rebaseCard(day: string, draftId: string, body: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('content_card_rebase', { p_day: day, p_draft: draftId, p_body: body })
  if (error) throw new Error(error.message || 'The card did not follow the edit.')
  return data === true
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
