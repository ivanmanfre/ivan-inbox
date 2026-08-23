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

// The scorer's sentence, wherever this row's writer put it. Both live writers
// use a different key, so both are read; an unknown shape yields null rather
// than a stringified object.
export function ideaWhy(b: Record<string, unknown> | null): string | null {
  if (!b) return null
  for (const k of ['why', 'reason', 'rationale', 'note']) {
    const v = b[k]
    if (typeof v === 'string' && v.trim()) return v
  }
  return null
}
