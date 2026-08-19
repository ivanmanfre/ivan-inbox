import { supabase } from './supabase'
import { setBoardVisible, setScheduleDateAt } from './content'

// THE REACTION DESK (Ivan, 2026-08-19: reactions belong "in ops as well instead
// of content pipeline… only if i approve it goes to ballot on mattan case —
// schedules for next slot in ivan's case").
//
// A reaction post is a found artifact (a screenshotted take someone is already
// arguing about) plus Ivan's own answer to it. That second half is why this
// surface exists at all: the 2026-08-18 goal-run generated 14 reaction bodies
// and a calibrated blind judge clocked 14 of 14 as machine-written, so the lane
// shipped as a PROVEN NEGATIVE — harvest and screenshot are automated, the body
// is hand-written. A desk that offered a generated body would be re-arming the
// exact thing that failed.
//
// WHERE THE ROWS COME FROM, and what already filtered them:
//   X Reaction ingestor (n8n 99LHX3WdkXcjoeoA) stamps evidence[0].format
//   ='reaction' and inserts at status='pending' — deliberately NOT diverted at
//   insert, so the ICP floor still grades every row. The server-side scorer
//   (claude-code-railway main.py `_lm_apply`) runs its four reject rules FIRST
//   and only then moves survivors to status='reaction_desk'. On 08-19 that floor
//   hard-rejected all three first-fire rows at icp 2/5/4, which is the whole
//   argument for keeping it upstream of this desk: without it Ivan reads the
//   junk himself.
//
// 🔴 'reaction_desk' is selected by THIS surface and nothing else. The Ideas
// section keys on 'reviewing' and the ClickUp Promoter on 'scored', so a row
// sitting here can never be auto-promoted into a generated draft. That is the
// "instead of content pipeline" half of Ivan's instruction, enforced by the
// status value rather than by anyone remembering.

export type ReactionEvidence = {
  author: string | null
  who: string | null
  excerpt: string | null
  thread_url: string | null
  created_at: string | null
  likes: number | null
  views: number | null
  quotes: number | null
  comments: number | null
  retweets: number | null
  controversy_ratio: number | null
  tier_weight: string | null
}

// Which lane a card belongs to, and therefore what Approve MEANS.
//   'ivan'    → a dated review draft on his own calendar (he is the publisher)
//   'risedtc' → a draft put on Mattan's board for HIS call (Ivan is not)
// Ivan, 2026-08-19: "rise half i want them first in ops -> i approve/edit ->
// go to ballot". Two different terminal states, one desk.
export type ReactionLane = 'ivan' | 'risedtc'

export type ReactionRow = {
  lane: ReactionLane
  id: string
  raw_topic: string | null
  source_ref: string | null
  composite_score: number | null
  icp_fit_score: number | null
  why_score: string | null
  ingested_at: string | null
  evidence: ReactionEvidence | null
  // The captured screenshot, if the capture step has run. NEVER inferred from a
  // storage path: an authed `.storage.list()` answers `[]` with no error when a
  // policy is missing, so an absent shot must render as absent, not as broken.
  //
  // 🔴 It lives in `evidence[0].shot_url`, NOT in a `taxonomy` column —
  // lm_idea_candidates HAS NO taxonomy column (42703; carousel_drafts does, and
  // selecting it here cost a live "desk unavailable" before it was caught).
  shot_url: string | null
}

export const REACTION_STATUS = 'reaction_desk'

const COLS =
  'id,raw_topic,source_ref,composite_score,icp_fit_score,why_score,ingested_at,evidence'

// jsonb round-trips as `unknown`. Coerce every field rather than trust the
// shape: one malformed evidence blob should cost that row its numbers, not
// blank the desk.
function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}
function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null
}

export function toEvidence(raw: unknown): ReactionEvidence | null {
  const arr = Array.isArray(raw) ? raw : null
  const e = arr && arr.length > 0 && arr[0] && typeof arr[0] === 'object'
    ? (arr[0] as Record<string, unknown>)
    : null
  if (!e) return null
  return {
    author: str(e.author),
    who: str(e.who),
    excerpt: str(e.excerpt),
    thread_url: str(e.thread_url),
    created_at: str(e.created_at),
    likes: num(e.likes),
    views: num(e.views),
    quotes: num(e.quotes),
    comments: num(e.comments),
    retweets: num(e.retweets),
    controversy_ratio: num(e.controversy_ratio),
    tier_weight: str(e.tier_weight),
  }
}

function toShotUrl(raw: unknown): string | null {
  const arr = Array.isArray(raw) ? raw : null
  const e = arr && arr.length > 0 && arr[0] && typeof arr[0] === 'object'
    ? (arr[0] as Record<string, unknown>)
    : null
  return e ? str(e.shot_url) : null
}

// RISE's reactions live in a DIFFERENT TABLE with a different shape: the
// X Viral-Trend Ingestor (n8n xBV2Cq3UWBY5v5nQ) grades them in-flight and writes
// client_ideas rows whose source metadata sits under `score_breakdown`, not
// `evidence`. Same desk, two readers — never one query pretending the tables
// agree.
const RISE_COLS =
  'id,title,hook,source_ref,source_label,icp_score,score_breakdown,taxonomy,created_at'

// score_breakdown carries the harvest facts the Ivan lane keeps in evidence[0].
// Mapped rather than aliased, so a rename on either side fails here loudly
// instead of rendering a card full of dashes.
function riseEvidence(raw: unknown): ReactionEvidence | null {
  if (!raw || typeof raw !== 'object') return null
  const b = raw as Record<string, unknown>
  const eng = (b.source_engagement && typeof b.source_engagement === 'object'
    ? b.source_engagement
    : {}) as Record<string, unknown>
  const who = str(b.source_author)
  return {
    author: who ? who.replace(/^@/, '') : null,
    who,
    // The RISE lane stores the graded hook, not the source tweet's own words.
    // Whatever it holds is shown verbatim; the card's caller decides the label.
    excerpt: null,
    thread_url: null,
    created_at: null,
    likes: num(eng.likes),
    views: num(eng.views),
    quotes: num(eng.quotes),
    comments: num(eng.replies),
    retweets: null,
    controversy_ratio: num(b.controversy_ratio),
    tier_weight: str(b.source_tier),
  }
}

async function fetchIvanReactions(): Promise<ReactionRow[]> {
  const { data, error } = await supabase.from('lm_idea_candidates')
    .select(COLS)
    .eq('status', REACTION_STATUS)
    // Freshest first, not highest-scoring. A reaction is perishable in a way an
    // evergreen idea is not: answering a take from nine days ago reads as
    // arriving late no matter how well it scored.
    .order('ingested_at', { ascending: false })
    .limit(50)
  if (error) throw error
  return (data ?? []).map(r => {
    const row = r as unknown as Record<string, unknown>
    return {
      lane: 'ivan' as const,
      id: String(row.id),
      raw_topic: str(row.raw_topic),
      source_ref: str(row.source_ref),
      composite_score: num(row.composite_score),
      icp_fit_score: num(row.icp_fit_score),
      why_score: str(row.why_score),
      ingested_at: str(row.ingested_at),
      evidence: toEvidence(row.evidence),
      shot_url: toShotUrl(row.evidence),
    }
  })
}

async function fetchRiseReactions(): Promise<ReactionRow[]> {
  const { data, error } = await supabase.from('client_ideas')
    .select(RISE_COLS)
    .eq('client_id', 'risedtc')
    .eq('status', REACTION_STATUS)
    .order('created_at', { ascending: false })
    .limit(50)
  if (error) throw error
  return (data ?? []).map(r => {
    const row = r as unknown as Record<string, unknown>
    const tax = (row.taxonomy && typeof row.taxonomy === 'object'
      ? row.taxonomy
      : {}) as Record<string, unknown>
    return {
      lane: 'risedtc' as const,
      id: String(row.id),
      // The graded hook is what Mattan's lane actually holds; the title is the
      // filed version of it. Hook first, because it is the sentence.
      raw_topic: str(row.hook) ?? str(row.title),
      source_ref: str(row.source_ref),
      composite_score: num(row.icp_score),
      icp_fit_score: null,
      why_score: str((row.score_breakdown as Record<string, unknown> | null)?.why),
      ingested_at: str(row.created_at),
      evidence: riseEvidence(row.score_breakdown),
      shot_url: str(tax.shot_url),
    }
  })
}

// Both lanes, one list, freshest first. A failure in EITHER lane fails the whole
// read on purpose: half a desk that looks complete is the worse outcome, and the
// error text names which table refused.
export async function fetchReactionDesk(): Promise<ReactionRow[]> {
  const [ivan, rise] = await Promise.all([fetchIvanReactions(), fetchRiseReactions()])
  return [...ivan, ...rise].sort((a, b) => (b.ingested_at ?? '').localeCompare(a.ingested_at ?? ''))
}

// ---------- the two decisions ----------

// Kill is a real write, not a session-local hide: the same row would come back
// on the next read otherwise, and the desk would never empty. It lands in the
// same 'archived' bucket every other rejected candidate uses so the scorer's
// rejection history stays one list.
export async function killReaction(row: ReactionRow, reason?: string): Promise<void> {
  const note = reason?.trim()
  if (row.lane === 'risedtc') {
    // client_ideas has no archived_reason column; the lane's own dead-row value
    // is 'archived' and the note goes where the rest of that row's provenance
    // already lives.
    const { error } = await supabase.from('client_ideas')
      .update({ status: 'archived' })
      .eq('id', row.id)
      .eq('status', REACTION_STATUS)
    if (error) throw error
    return
  }
  const { error } = await supabase.from('lm_idea_candidates')
    .update({
      status: 'archived',
      archived_reason: `killed_at_desk${note ? ':' + note : ''}`,
    })
    .eq('id', row.id)
    .eq('status', REACTION_STATUS)
  if (error) throw error
}

// ---------- the next slot ----------

// Ivan's lane runs roughly one post a day, at no fixed minute (the live spread
// is 12:00–15:30 UTC). "Next slot" therefore means the next DAY with nothing on
// it, at a default hour — not a queue position.
//
// 🔴 EARLIEST free day, never the end of the queue. A reaction appended behind
// a full fortnight publishes as a comment on something nobody remembers. This
// is the one scheduling rule where "soonest" beats "tidiest".
export const REACTION_SLOT_HOUR_UTC = 14

export function nextFreeSlot(
  occupiedDays: string[],
  now: Date,
  hourUtc: number = REACTION_SLOT_HOUR_UTC,
): string {
  const taken = new Set(occupiedDays)
  // Start at tomorrow: today's slot hour may already have passed, and a post
  // scheduled into the past is a publish-now with extra steps.
  for (let i = 1; i <= 60; i++) {
    const d = new Date(Date.UTC(
      now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + i, hourUtc, 0, 0, 0,
    ))
    const day = d.toISOString().slice(0, 10)
    if (!taken.has(day)) return d.toISOString()
  }
  // 60 consecutive occupied days is not a real calendar state; falling back to
  // day 61 keeps the caller from receiving an empty string it would then write.
  const d = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 61, hourUtc, 0, 0, 0,
  ))
  return d.toISOString()
}

// The days Ivan's lane already holds. Only review/scheduled count: a published
// day is in the past and a disqualified one was never going to fire.
export async function fetchOccupiedDays(): Promise<string[]> {
  const { data, error } = await supabase.from('carousel_drafts')
    .select('scheduled_at')
    .is('client_id', null)
    .not('scheduled_at', 'is', null)
    .in('status', ['review', 'scheduled'])
    .limit(500)
  if (error) throw error
  return (data ?? [])
    .map(r => (r as { scheduled_at: string | null }).scheduled_at)
    .filter((s): s is string => typeof s === 'string')
    .map(s => s.slice(0, 10))
}

// ---------- approve ----------

export type ApproveResult = { draftId: string; scheduledAt: string }

// A body is not optional and the caller cannot make it so. Approve on this desk
// means "this take is worth answering AND here is the answer" — there is no
// generator behind it to fill a blank, so an empty body would create a draft
// whose post_body is '' and quietly schedule it.
export function canApprove(body: string): boolean {
  return body.trim().length > 0
}

// RISE's terminal state is NOT a schedule — Ivan does not publish on Mattan's
// behalf. Approving puts the post on Mattan's board for his call, which is what
// "goes to ballot" means on that lane.
//
// 🔴 THE CLIENT BOARD IS A CACHED BLOB. `get_client_board` returns
// `client_boards.board` verbatim, so a green PATCH on carousel_drafts proves
// NOTHING about what Mattan sees. `operator_set_board_visible` is the call that
// both flips the flag AND fires the board queue sync, and its result must be
// asserted rather than assumed.
export async function approveRiseReaction(
  row: ReactionRow,
  body: string,
): Promise<{ draftId: string }> {
  if (!canApprove(body)) throw new Error('approve: the reaction has no body yet')
  const ev = row.evidence
  const handle = ev?.who || (ev?.author ? '@' + ev.author : 'X')

  const { data, error } = await supabase.from('carousel_drafts')
    .insert({
      title: `Reaction — ${handle}`,
      type: 'single_image',
      topic: row.raw_topic ?? `Reaction to ${handle}`,
      post_body: body.trim(),
      image_urls: row.shot_url ? [row.shot_url] : [],
      // review is a precondition of operator_set_board_visible, not a
      // formality: the RPC refuses 'not_in_review'.
      status: 'review',
      client_id: 'risedtc',
      // FALSE at birth, then flipped by the RPC. Inserting it true would show
      // the post on the board without ever firing the queue sync that rebuilds
      // the blob the board actually reads.
      board_visible: false,
      source_ref: row.source_ref,
      source_label: `Reaction to ${handle} on X`,
      client_idea_id: row.id,
      taxonomy: {
        human_edited: true,
        human_edited_at: new Date().toISOString(),
        // 🔴 NEVER a `register` key on a RISE row: the client-facing Weekly Plan
        // Note selects on taxonomy->>register, and one here would leak this
        // into a note Mattan reads before he has approved anything.
        reaction: {
          idea_id: row.id,
          source_url: row.source_ref,
          author: ev?.author ?? null,
          shot_url: row.shot_url,
        },
      },
    })
    .select('id')
    .single()
  if (error) throw error
  const draftId = String((data as { id: string }).id)

  await setBoardVisible(draftId, true)

  const { error: closeErr } = await supabase.from('client_ideas')
    .update({ status: 'live', approved_at: new Date().toISOString() })
    .eq('id', row.id)
  if (closeErr) throw closeErr

  return { draftId }
}

export async function approveReaction(
  row: ReactionRow,
  body: string,
  scheduledAt: string,
): Promise<ApproveResult> {
  if (!canApprove(body)) throw new Error('approve: the reaction has no body yet')
  const ev = row.evidence
  const handle = ev?.who || (ev?.author ? '@' + ev.author : 'X')

  // 🔴 DRAFT FIRST, ALWAYS. Writing a scheduled_posts row directly makes an
  // orphan chip on the calendar every time (its onOpen hands the scheduled_posts
  // id to a DRAFTS lookup and finds nothing). The draft is the row that exists;
  // the schedule is a field on it.
  const { data, error } = await supabase.from('carousel_drafts')
    .insert({
      title: `Reaction — ${handle}`,
      // single_image because the screenshot IS the post's visual. A reaction
      // with no shot captured yet still inserts as single_image with an empty
      // image list rather than silently becoming a different format.
      type: 'single_image',
      topic: row.raw_topic ?? `Reaction to ${handle}`,
      post_body: body.trim(),
      image_urls: row.shot_url ? [row.shot_url] : [],
      status: 'review',
      client_id: null,
      board_visible: true,
      source_ref: row.source_ref,
      source_label: `Reaction to ${handle} on X`,
      // human_edited from birth: this body was typed by Ivan, and any sweep that
      // treats an unmarked body as machine output is licensed to rewrite it.
      taxonomy: {
        human_edited: true,
        human_edited_at: new Date().toISOString(),
        reaction: {
          candidate_id: row.id,
          source_url: ev?.thread_url ?? row.source_ref,
          author: ev?.author ?? null,
          shot_url: row.shot_url,
        },
      },
    })
    .select('id')
    .single()
  if (error) throw error
  const draftId = String((data as { id: string }).id)

  // Date only. setScheduleDateAt writes scheduled_at and nothing else — no
  // status flip, no board arming — so approving here puts the post on the
  // calendar without publishing it or promoting it anywhere.
  const at = await setScheduleDateAt(draftId, scheduledAt)

  // Close the candidate LAST. If the draft insert or the schedule failed, the
  // row stays on the desk and can be approved again; closing it first would
  // lose the take with nothing to show for it.
  const { error: closeErr } = await supabase.from('lm_idea_candidates')
    .update({
      status: 'promoted',
      promoted_draft_id: draftId,
      promoted_draft_table: 'carousel_drafts',
    })
    .eq('id', row.id)
  if (closeErr) throw closeErr

  return { draftId, scheduledAt: at }
}
