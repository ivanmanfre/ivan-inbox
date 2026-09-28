// "Mark as solved" (Ivan 09-27: "sometimes I don't want to answer ... more like a closer, and I can
// just mark as solved"). solved_at = now on the prospect, plus, where a draft exists, TODAY'S plain
// discard of every pending leg (lib discardLegs, mode null); the reply flag is lowered on this one
// prospect when a draft exists or it is raised (the drafters pick on it).
//
// Why that is enough, and why it undoes itself:
//  - The list's owed rule (lib/inbox unansweredSince) treats a discard newer than the last owed
//    inbound as "a human already ruled on this thread", so the thread leaves Needs you. The stage is
//    never touched, so no sequencer or picker restarts.
//  - The reply drafters pick on needs_manual_reply=true; lowering it (scoped by id) stops a fresh
//    draft for the message he chose not to answer. The discard reason also blocks a redraft.
//  - A NEW inbound is newer than the discard, so the thread is owed again, and every detector raises
//    the flag again on a new message (Conversation Monitor, RISE and ARCH reply detectors, the ARCH
//    email inbound: see O/B/dms3-solved-proposal.md for the lines).
// 2026-09-27 (coordinator, option A): outreach_prospects.solved_at now carries the ruling itself, so
// a thread with NO draft can be solved too. The stamp settles the thread while it is not older
// than the last owed inbound (lib/inbox isSettledBySolve); a newer inbound brings it back.
import { supabase } from '../../lib/supabase'
import { unansweredWaitSince, type Thread } from '../../lib/inbox'

/** Every thread that owes a reply (draft or not), or carries a draft; never a filed pitch. */
export function canMarkSolved(t: Thread): boolean {
  if (t.spam) return false
  return t.draft !== null || unansweredWaitSince(t) !== null
}

export type SolvedPatch = { solved_at: string | null; needs_manual_reply?: boolean }

/** ONE PATCH on ONE prospect (?id=eq.): the solve stamp, and the reply flag when it moves. */
export async function writeSolved(prospectId: string, p: SolvedPatch): Promise<void> {
  const { error } = await supabase.from('outreach_prospects')
    .update({ ...p, updated_at: new Date().toISOString() })
    .eq('id', prospectId)
  if (error) throw error
}
