import { supabase } from './supabase'
import type { ContentDraft, ContentLane } from './content'

// The old dashboard's ACTIONS, brought to the inbox's reading window.
//
// Ivan, 2026-08-03: "you need to check on old interface
// ivanmanfredi.com/dashboard?content inside the window all the actions i have
// for content... as well as lead magnets.. i have stuff like regen cover image
// and others like regen copy".
//
// Inventoried from ~/Desktop/personal-site/components/dashboard (the live
// source; the page itself is OTP-gated) and re-probed here before shipping.
// Everything below hits the SAME endpoint the old dashboard hits — no
// reimplementation of the pipeline, no new webhook, no decorative buttons.
//
// TRANSPORT, probed 2026-08-03 from this app's origin: all three n8n webhooks
// answer an OPTIONS preflight with
//   access-control-allow-origin: https://ivanmanfre.github.io
//   access-control-allow-methods: OPTIONS, POST
// so a direct browser POST works and no edge-function relay is needed. The
// webhooks carry NO auth of their own; the table writes ride the operator's
// existing Supabase session.

const POSTGEN = import.meta.env.VITE_POSTGEN_WEBHOOK
  ?? 'https://n8n.ivanmanfredi.com/webhook/post-gen-v2'
const LMGEN = import.meta.env.VITE_LM_GEN_WEBHOOK
  ?? 'https://n8n.ivanmanfredi.com/webhook/lm-gen-v2'
const LM_REGEN_COVER = import.meta.env.VITE_LM_REGEN_COVER_WEBHOOK
  ?? 'https://n8n.ivanmanfredi.com/webhook/lm-regen-cover-v2'

async function fire(url: string, body: Record<string, unknown>): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`${new URL(url).pathname} returned ${res.status}`)
}

// ---------------------------------------------------------------------------
// The two conflicts a regen has to SURFACE rather than silently resolve
// ---------------------------------------------------------------------------

// db/025 — the human-edit guard. A service_role UPDATE cannot overwrite
// post_body (or wipe image_urls) on a row whose taxonomy.human_edited is true.
// That is a FEATURE and this code must not disable it behind Ivan's back: a
// regen fired at a protected row runs the whole 8-minute pipeline and lands
// nothing. So the window says so, and clearing the flag is a separate,
// explicit act — which is exactly the escape hatch 025 documents (write
// human_edited = 'false').
// ⚠ taxonomy is jsonb that is SOMETIMES A BARE STRING on live rows
// (content.ts:43-45 documents both shapes). Spreading a string produces
// {0:'{',1:'"',…} and would write character-indexed garbage over the column, so
// every read and every merge goes through this.
function taxObj(t: ContentDraft['taxonomy']): Record<string, unknown> {
  return t && typeof t === 'object' && !Array.isArray(t) ? t as Record<string, unknown> : {}
}

export function isHumanEdited(d: Pick<ContentDraft, 'taxonomy'>): boolean {
  return String(taxObj(d.taxonomy).human_edited ?? '') === 'true'
}

// The image trap. post-gen only writes image_urls when include_image = 'Yes',
// which the old dashboard sends for every single_image row — so a Regenerate
// there destroys a hand-pinned photo (memory: "Rise draft regen wipes
// image_urls -> re-pin photo"). We default to COPY-ONLY whenever the row
// already has an image, which preserves it, and say which one we are doing.
export function regenWouldReplaceImage(d: Pick<ContentDraft, 'type' | 'image_urls'>, withImage: boolean): boolean {
  return withImage && d.type === 'single_image' && (d.image_urls?.length ?? 0) > 0
}

export type RegenPlan = {
  postFormat: 'Carousel' | 'Text Post' | 'Single Image'
  includeImage: 'Yes' | 'No'
  keepsPinnedImage: boolean
  blockedByGuard: boolean
}

// What a regen WILL do, decided before it is fired so the confirm can state it.
// `withImage` is the operator's explicit choice; absent it, an existing image is
// always kept.
export function planRegen(d: ContentDraft, withImage = false): RegenPlan {
  const hasImage = (d.image_urls?.length ?? 0) > 0
  const postFormat: RegenPlan['postFormat'] = d.type === 'carousel'
    ? 'Carousel'
    : d.type === 'single_image' ? 'Single Image' : 'Text Post'
  // NEVER hardcode Carousel here: the old dashboard's original bug was callers
  // reaching for buildCarousel(), "silently turning every Re-author into a
  // carousel" (studioActions.ts:47-51 over there).
  const includeImage: 'Yes' | 'No' = d.type === 'single_image' && withImage ? 'Yes' : 'No'
  return {
    postFormat,
    includeImage,
    keepsPinnedImage: hasImage && includeImage === 'No',
    blockedByGuard: isHumanEdited(d),
  }
}

// ---------------------------------------------------------------------------
// POST / CONTENT DRAFT
// ---------------------------------------------------------------------------

// Regenerate the copy. Same two steps the dashboard does: flip the row to
// generating (stamping when the run started, which is what the stuck-generation
// detector reads), then fire post-gen-v2.
export async function regenerateDraft(d: ContentDraft, withImage = false): Promise<RegenPlan> {
  const plan = planRegen(d, withImage)
  const tax = { ...taxObj(d.taxonomy), generating_started_at: new Date().toISOString() }
  const { error } = await supabase.from('carousel_drafts')
    .update({ status: 'generating', taxonomy: tax })
    .eq('id', d.id)
  if (error) throw error
  await fire(POSTGEN, {
    draft_id: d.id,
    topic: d.topic ?? d.title ?? '',
    title: d.title ?? '',
    author: 'Ivan',
    source: 'Inbox',
    post_format: plan.postFormat,
    include_image: plan.includeImage,
  })
  return plan
}

// ---------------------------------------------------------------------------
// THE SAME RETRY, ON A CLIENT LANE
// ---------------------------------------------------------------------------
//
// Ivan, 2026-08-24: "in the errors section there is no regen option, right, so
// I can only delete it. It's kind of weird."
//
// He is right, and the reason it was Ivan-only was right when it was written
// and is no longer the whole picture. `regenerateDraft` fires `post-gen-v2`
// with `author: 'Ivan'`, and pointing THAT at a client row would run Ivan's
// voice over Mattan's post — so RetryDraft refused the lane outright rather
// than fire the wrong pipeline.
//
// What that missed is that the client lane HAS its own generator, and it takes
// the same shape. `CLIENT Rise DTC - Post Generation MAX` (n8n 5WjbV0eks4d9Wyh5,
// webhook `rise-dtc-post-gen-v2-max`) reads `body.draft_id` straight into
// `task_id` and rewrites THAT row — it never creates one. The kickoff
// (FsuRkf1owG1QpcyD) calls it with a draft it just made; a retry calls it with a
// draft that already exists. Identical call, different row age.
//
// 🔴 PER LANE, AND ONLY WHERE THE GENERATOR IS ALIVE. `CLIENT ARCH. Influencer
// Agency - Post Generation` exists on the same shape and is INACTIVE
// ("born-dead", active=false). Offering Retry there would flip a row to
// `generating` and nothing would ever come back — a silent stall, which is
// strictly worse than no button. A lane absent from this map gets no Retry, and
// that absence is the enforcement.
type ClientGen = {
  webhook: string
  author: string
  brand: { wordmark_html: string; domain: string }
}

const CLIENT_GEN: Partial<Record<ContentLane, ClientGen>> = {
  risedtc: {
    webhook: import.meta.env.VITE_RISE_POSTGEN_WEBHOOK
      ?? 'https://n8n.ivanmanfredi.com/webhook/rise-dtc-post-gen-v2-max',
    // Verbatim from the kickoff's own payload. The generator reads `author`
    // into the briefing, so a near-miss here is a post in nobody's voice.
    author: 'Mattan Danino (Rise DTC)',
    brand: { wordmark_html: 'RISE DTC', domain: 'risedtc.com' },
  },
}

export function canRetryLane(lane: ContentLane): boolean {
  return lane === 'ivan' || CLIENT_GEN[lane] !== undefined
}

// Same two steps the Ivan path takes — flip to generating with the stamp the
// stuck-detector reads, then fire — with the client payload the kickoff sends.
// `register` / `story_ref` / `consent_tier` are carried off the row rather than
// defaulted: they are the consent overlay, and a retry that dropped them would
// quietly re-generate a personal-register post as a tactical one.
export async function regenerateClientDraft(
  d: ContentDraft, lane: ContentLane,
): Promise<RegenPlan> {
  const gen = CLIENT_GEN[lane]
  if (!gen) throw new Error(`No live generator for the ${lane} lane`)
  const plan = planRegen(d, false)
  const tax = taxObj(d.taxonomy)
  const { error } = await supabase.from('carousel_drafts')
    .update({
      status: 'generating',
      taxonomy: { ...tax, generating_started_at: new Date().toISOString() },
    })
    .eq('id', d.id)
  if (error) throw error
  const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)
  await fire(gen.webhook, {
    draft_id: d.id,
    title: d.title ?? '',
    topic: d.topic ?? d.title ?? '',
    author: gen.author,
    source: `client-${lane}`,
    post_format: plan.postFormat,
    post_format_details: '',
    // Always 'No'. Same rule as the Ivan card: post-gen only writes image_urls
    // when this is 'Yes', so asking for an image is what DESTROYS a hand-pinned
    // photo. A new image stays a takeover decision.
    include_image: 'No',
    editorial_notes: str(tax.pillar) ? `pillar: ${String(tax.pillar)}` : '',
    // 🔴🔴 keep_gate: THE DRAFT MUST NOT PROMOTE ITSELF.
    //
    // `CLIENT Rise DTC - Post Generation MAX`, node "Update Task Status", ends
    // every run with:
    //
    //     keep_gate ? { status:'review' } : { status:'review', board_visible:true }
    //
    // so a generation that does not ask for the gate puts its own output on the
    // CLIENT'S BOARD the moment it finishes. Retrying an errored internal draft
    // from the Errors tab would therefore hand Mattan a post nobody had read —
    // the exact thing the promote button exists to be a decision about. This
    // flag was missing from the first cut of this function (shipped 2026-08-24,
    // ~1h before Ivan asked why an approved idea reached his board unreviewed)
    // and every retry it fired would have promoted on landing.
    keep_gate: true,
    register: str(tax.register),
    story_ref: str(tax.story_ref),
    consent_tier: null,
    client_id: lane,
    brand: gen.brand,
  })
  return plan
}

// The deliberate escape hatch from db/025, as its own act. Only ever called
// after the window has told Ivan the guard is protecting his edit.
export async function clearHumanEdit(d: ContentDraft): Promise<void> {
  const tax = { ...taxObj(d.taxonomy), human_edited: 'false' }
  const { error } = await supabase.from('carousel_drafts').update({ taxonomy: tax }).eq('id', d.id)
  if (error) throw error
}

// ---------------------------------------------------------------------------
// LEAD MAGNET
// ---------------------------------------------------------------------------

// "Regen cover" — the action Ivan named. Writes lm_drafts_v2.cover_url and
// NOTHING else (the engine's own guarantee), so it cannot disturb a reviewed
// body. Costs real money (Gemini image gen, ~$0.24), hence a confirm at the
// call site.
export async function regenLmCover(draftId: string): Promise<void> {
  await fire(LM_REGEN_COVER, { draft_id: draftId })
}

// "Generate content" — the LM equivalent of a copy regen. Flips the row to
// generating first, same as the dashboard, so the board stops showing it as
// reviewable while the ~10-minute run is out.
export async function regenLmContent(
  lm: { id: string; topic?: string | null; format?: string | null },
): Promise<void> {
  const { error } = await supabase.from('lm_drafts_v2')
    .update({ status: 'generating' })
    .eq('id', lm.id)
  if (error) throw error
  await fire(LMGEN, {
    draft_id: lm.id,
    topic: lm.topic ?? '',
    format: lm.format ?? '',
    phase: 'content',
  })
}

// ---------------------------------------------------------------------------
// SCHEDULE — the reference's `Approve & schedule` (studioActions.ts
// `scheduleCarousel` over there), ported one-for-one.
//
// 🔴 THIS ARMS A PUBLISHER. status='scheduled' + scheduled_at is exactly what
// the n8n Bridge (yzXqLDIpuNzuhUQq) reads to insert the publisher queue row
// that puts a post on LinkedIn. It is the only affordance in the draft window
// with a public consequence, which is why the call site confirms in those words
// rather than calling it "scheduling".
//
// Ivan lane only (`.is('client_id', null)`), same scope as approve and the
// edit — Mattan's lane schedules through the client board's own gates.
// Verified like every other write here: PostgREST answers a silent 204 to an
// UPDATE that RLS filtered away, so a `.select()` that comes back empty is a
// failure, not a success.
export async function scheduleDraft(id: string, scheduledAtIso: string): Promise<void> {
  const { data, error } = await supabase.from('carousel_drafts')
    .update({ status: 'scheduled', scheduled_at: scheduledAtIso })
    .eq('id', id).is('client_id', null)
    .select('id')
  if (error) throw error
  if (!data || data.length === 0) {
    throw new Error('Schedule failed — the database did not accept the write.')
  }
}

// ---------------------------------------------------------------------------
// A HUMAN NOTE IN THE GENERATION REGISTER — the reference's AgentLogFeed
// composer (`append_agent_log`). The log is written by a dozen agents; this is
// the one place a person writes back into it, which is what makes it a log
// rather than a transcript.
//
// The RPC appends rather than replacing, so two writers cannot clobber each
// other the way a read-modify-write on the jsonb array would.
export async function appendAgentNote(
  table: 'carousel_drafts' | 'lm_drafts_v2',
  id: string,
  body: string,
): Promise<void> {
  const { error } = await supabase.rpc('append_agent_log', {
    p_table: table, p_id: id, p_agent: 'Ivan', p_body: body,
  })
  if (error) throw error
}

// A text field on a lead-magnet row — the reference's LeadMagnetEditor
// `Save changes` (studioActions `saveLMDraft` over there), narrowed to the two
// fields this window edits.
//
// 🔴 `status` is NOT reachable through this function, and that is the point.
// Whether an n8n watcher treats lm_drafts_v2.status='approved' as a publish
// trigger is unverifiable from this repo, so the field list is an allowlist of
// two rather than a patch object a caller could widen.
//
// Verified like every other write here: PostgREST answers a silent 204 to an
// UPDATE that RLS filtered away, and a surface that says "Saved" off a
// filtered-away write is lying.
export async function saveLmField(
  id: string,
  field: 'post_body' | 'email_copy',
  value: string,
): Promise<void> {
  const { data, error } = await supabase.from('lm_drafts_v2')
    .update({ [field]: value })
    .eq('id', id)
    .select('id')
  if (error) throw error
  if (!data || data.length === 0) {
    throw new Error('Save failed — the database did not accept the edit.')
  }
}
