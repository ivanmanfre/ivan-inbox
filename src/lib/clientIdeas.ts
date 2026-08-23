import { supabase } from './supabase'
import {
  CLIENT_OPS_GATE, ClientRpcError, clientRpcMessage,
  type ContentLane,
} from './content'

// THE CLIENT LANE'S IDEA BANK — `client_ideas`, a different table from Ivan's.
//
// Ivan, 2026-08-23, reading a WhatsApp line that said three RISE DTC sales-call
// topics had been added: "i dont see this on inbox -- content -- maybe ideas
// category is missing".
//
// It was. Content's Ideas tab reads `lm_idea_candidates`, and that table has no
// tenancy column at all (ContentList.tsx, CLIENT_STAGES) — which is true, and
// was the whole reason the client lanes were built with no Ideas tab. What that
// reasoning missed is that a client's ideas were never in that table: they are
// in `client_ideas`, keyed by `client_id`. Probed the same day:
//
//   client_ideas · risedtc: 155 staged · 23 live · 34 rejected · 4 archived
//                · arch:     28 staged
//
// So 183 staged ideas across the two client lanes had no surface in this app,
// while Today's queue was already counting them ("N ideas staged",
// workQueue.ts fetchStagedIdeaPile) with nowhere to send him.
//
// 🔴 THE RPC, NEVER THE TABLE. `operator_client_ideas` is what the dashboard's
// Client Ops floor reads (clientops2/shared.tsx:501) and it is SECURITY
// DEFINER, gated, `authenticated`-only, and already ordered by icp_score. A
// direct select would be a second definition of "which ideas count" — the RPC
// filters `status = 'staged'` in SQL, and that filter is the definition.

export type ClientIdea = {
  id: string
  title: string | null
  hook: string | null
  source_label: string | null
  source_ref: string | null
  pillar: string | null
  format: string | null
  status: string | null
  created_at: string | null
  icp_score: number | null
  // The funnel stage DECLARED at staging, and the same value the generation
  // kickoff copies onto the draft with funnel_source='declared' (n8n
  // FsuRkf1owG1QpcyD). So it is the tag the post ships with, decided here —
  // which is why the card prints it beside the decision rather than leaving it
  // to be guessed after generation. Added to the RPC by db/042.
  funnel_stage: string | null
  funnel_source: string | null
  // The scorer's own reasoning object. Shape varies by the workflow that wrote
  // the row (the Fathom call miner and the X trend ingestor both write here),
  // so it is carried whole and read defensively at the card.
  score_breakdown: Record<string, unknown> | null
}

function num(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v : null
}

function toIdea(raw: unknown): ClientIdea | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.id !== 'string') return null
  return {
    id: r.id,
    title: str(r.title),
    hook: str(r.hook),
    source_label: str(r.source_label),
    source_ref: str(r.source_ref),
    pillar: str(r.pillar),
    format: str(r.format),
    status: str(r.status),
    created_at: str(r.created_at),
    icp_score: num(r.icp_score),
    funnel_stage: str(r.funnel_stage),
    funnel_source: str(r.funnel_source),
    score_breakdown: r.score_breakdown && typeof r.score_breakdown === 'object'
      ? (r.score_breakdown as Record<string, unknown>)
      : null,
  }
}

// 🔴 Ivan's lane is NOT in this table. `client_ideas.client_id` holds 'risedtc'
// and 'arch' and nothing else; his own bank is `lm_idea_candidates`, read by
// fetchIdeaCandidates. Calling this with 'ivan' would return a calm, wrong
// empty list, so it refuses instead.
export async function fetchClientIdeas(lane: ContentLane): Promise<ClientIdea[]> {
  if (lane === 'ivan') throw new Error('fetchClientIdeas: Ivan’s ideas are in lm_idea_candidates')
  const { data, error } = await supabase.rpc('operator_client_ideas', {
    p_gate: CLIENT_OPS_GATE, p_client_id: lane,
  })
  if (error) throw new Error(error.message)
  const r = (data ?? {}) as Record<string, unknown>
  if (r.ok !== true) {
    const code = typeof r.error === 'string' ? r.error : 'unknown'
    throw new ClientRpcError(code, clientRpcMessage(code))
  }
  const rows = Array.isArray(r.ideas) ? r.ideas : []
  return rows.map(toIdea).filter((x): x is ClientIdea => x !== null)
}

export type ClientIdeaDecision = 'approved' | 'rejected'

// APPROVE / REJECT, through the dashboard's own write path.
//
// 🔴 WHAT THE RPC ACTUALLY DOES, read off pg_get_functiondef 2026-08-23 rather
// than inferred from its name:
//
//   operator_approve_idea(p_gate text, p_idea_id uuid, p_decision text)
//     · gate first                                   -> 'bad_gate'
//     · p_decision not in ('approved','rejected')    -> 'bad_decision'
//     · update client_ideas set status = p_decision,
//         approved_at = now() when approving
//       WHERE id = p_idea_id AND status = 'staged'   -> 'not_found_or_not_staged'
//
// It writes ONE column. It does not generate anything itself and it cannot
// reach the client's board: the generation run is a separate job that picks up
// `status = 'approved'`, and what it produces lands at `review`, internal, with
// board_visible untouched. That is the same boundary the Ivan lane's Approve
// states, and it is why this ships without a confirm sheet — both decisions are
// reversible at the row, and the one act nothing undoes (delete) is not offered
// here at all.
export async function decideClientIdea(
  id: string, decision: ClientIdeaDecision,
): Promise<void> {
  const { data, error } = await supabase.rpc('operator_approve_idea', {
    p_gate: CLIENT_OPS_GATE, p_idea_id: id, p_decision: decision,
  })
  if (error) throw new Error(error.message)
  const r = (data ?? {}) as Record<string, unknown>
  if (r.ok !== true) {
    const code = typeof r.error === 'string' ? r.error : 'unknown'
    throw new ClientRpcError(code, CLIENT_IDEA_MESSAGES[code] ?? clientRpcMessage(code))
  }
}

const CLIENT_IDEA_MESSAGES: Record<string, string> = {
  not_found_or_not_staged:
    'That idea is no longer staged — something decided it first. Nothing changed here.',
  bad_decision: 'The database only accepts approve or reject on an idea.',
}

// 🔴 `score_breakdown.why` IS THE VERBATIM LINE FROM THE CALL, not a rationale.
//
// The ingestor writes `why: t.evidence_quote` (n8n ED3KvNsjKwANZsuf, "Fathom
// Call Ingestor"), and the extractor prompt that produced it — canon,
// `content_prompts/rise-dtc-call-extractor` — defines the field as:
//
//   "evidence_quote (copied VERBATIM, character-for-character, from a SINGLE
//    transcript line that supports the topic; no ellipsis, no edits, no
//    merging lines)"
//
// with a hard filter that "a quote that does not support the title disqualifies
// the candidate" and, on the reach track, "verbatim, contiguous, first-person".
// So this is the sentence somebody actually said, and rendering it under a
// heading that says "why it scored" describes it as the machine's opinion. It
// is evidence. 171 of the 183 staged rows carry one.
//
// The other writers on this table (the X trend ingestor) put a real rationale
// under the same key, which is why the label travels with the SOURCE and not
// with the field — see quoteLabel below.
export function ideaWhy(b: Record<string, unknown> | null): string | null {
  if (!b) return null
  for (const k of ['why', 'reason', 'rationale', 'note']) {
    const v = b[k]
    if (typeof v === 'string' && v.trim()) return v
  }
  return null
}

// WHOSE line it is, when the extractor could tell. `voice` is the ingestor's
// own selection filter (buyer > neutral > unclear > seller), tagged "from the
// SPEAKER OF THE evidence_quote, attributed by CONTENT and never by the speaker
// label". `unclear` is the honest state — it is what the diarization guard
// forces when the transcript collapsed and a quote cannot be attributed — so it
// is printed as a doubt rather than smoothed into a name.
const VOICE_ATTRIB: Record<string, string> = {
  buyer: 'the founder, on the call',
  neutral: 'on the call',
  seller: 'Mattan, on the call',
  unclear: 'on the call — speaker not attributable',
}

export function quoteLabel(i: ClientIdea): string | null {
  // Only a call row's `why` is a transcript line. Everything else on this table
  // writes a rationale under the same key, and calling that a quote would be
  // the one claim this card must never get wrong.
  if (!/call/i.test(i.source_label ?? '')) return null
  const voice = String(i.score_breakdown?.voice ?? '').toLowerCase()
  return VOICE_ATTRIB[voice] ?? 'on the call'
}

// A COLOUR PER SOURCE, and the ask is DISTINCTNESS: Ivan, 2026-08-23, "make
// every source a different colour". 16 distinct source_labels are live across
// the two client lanes today ("From your sales calls" 106, "From competitor
// feeds" 24, five different subreddit threads, "Winner repurpose", …) and the
// ingestors mint new ones without asking, so a hardcoded palette would be wrong
// the next time somebody names a subreddit — the same reasoning the style
// roster carries about hardcoded catalogues.
//
// 🔴 THE FIRST BUILD HASHED THE LABEL TO A HUE AND ITS OWN TEST KILLED IT.
// FNV-1a mod 360 is stable and perfectly uniform, and uniform is exactly the
// problem: on the nine sources live on Mattan's bank, two of them landed 3
// APART, which is the same colour to an eye. Hashing gives stability and cannot
// give separation, and separation is what was actually asked for.
//
// So the hues are dealt from the SET that is on screen: sort the labels (a
// deterministic order, never the order the rows happened to arrive in), then
// space them evenly around the wheel. n sources get 360/n between them, which
// is the widest any n colours can be. The trade-off, stated rather than hidden:
// a label's hue can shift when a NEW source appears in the bank, because the
// deal changes. That is the price of the guarantee, and it is the right way
// round — a colour that means "not the one next to it" beats a colour that
// means "always this exact hue" on a list whose whole job is to be scanned.
export function sourceHues(labels: readonly (string | null)[]): Map<string, number> {
  const uniq = [...new Set(labels.filter((l): l is string => !!l))].sort()
  const out = new Map<string, number>()
  // The offset keeps "From your sales calls" — first alphabetically among the
  // live labels and 106 of Mattan's 155 rows — off pure red, which every other
  // mark on this surface reserves for a failure.
  uniq.forEach((l, i) => out.set(l, Math.round((i * 360) / uniq.length + 20) % 360))
  return out
}
