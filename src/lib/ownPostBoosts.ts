/* ==========================================================================
   OWN-POST BOOSTED MARKS — P5 W-M4. Boosted own posts are excluded from own
   baselines and outlier counts by the recompute lane (M/B); this file is the
   read+write the inbox needs to show and set that state on the surface that
   lists our own published posts (Strategy > Reach, ReachBlock.tsx PostLine).

   · fetchOwnPostBoosts reads `operator_own_post_boosts` (db cb15u, this
     lane's own RPC) — the newest mark per post_ref, keyed by post_ref.
   · markOwnPostBoosted calls `operator_mark_own_post_boosted` (db cb15b,
     lane B's RPC — same gate pattern as operator_market_outliers per
     PLAN.md). This file does not define that function; it only calls it.

   Both fail toward "nothing changes": a bad read renders every post
   unboosted rather than guessing, and a failed write throws so the UI can
   revert its optimistic toggle instead of showing a state the database never
   recorded.
   ========================================================================== */
import { supabase } from './supabase'
import { CLIENT_OPS_GATE, type ContentLane } from './content'

export type OwnPostBoostMark = { boosted: boolean; marked_at: string | null; marked_by: string | null }

export type OwnPostBoostRead = { ok: boolean; byRef: ReadonlyMap<string, OwnPostBoostMark> }

const EMPTY_READ: OwnPostBoostRead = { ok: false, byRef: new Map() }

export async function fetchOwnPostBoosts(lane: ContentLane): Promise<OwnPostBoostRead> {
  try {
    const { data, error } = await supabase.rpc('operator_own_post_boosts', {
      p_gate: CLIENT_OPS_GATE, p_client_id: lane,
    })
    if (error || !data || typeof data !== 'object' || Array.isArray(data)) return EMPTY_READ
    const byRef = new Map<string, OwnPostBoostMark>()
    for (const [ref, raw] of Object.entries(data as Record<string, unknown>)) {
      if (!raw || typeof raw !== 'object') continue
      const r = raw as Record<string, unknown>
      byRef.set(ref, {
        boosted: r.boosted === true,
        marked_at: typeof r.marked_at === 'string' ? r.marked_at : null,
        marked_by: typeof r.marked_by === 'string' ? r.marked_by : null,
      })
    }
    return { ok: true, byRef }
  } catch {
    return EMPTY_READ
  }
}

/** @throws Error carrying the database's own refusal message when the write
    does not land — the caller (ReachBlock's toggle) reverts its optimistic
    update on catch rather than trusting a state nothing confirmed. */
export async function markOwnPostBoosted(
  lane: ContentLane, postRef: string, boosted: boolean,
): Promise<void> {
  const { error } = await supabase.rpc('operator_mark_own_post_boosted', {
    p_gate: CLIENT_OPS_GATE, p_client_id: lane, p_post_ref: postRef, p_boosted: boosted,
  })
  if (error) throw new Error(error.message)
}
