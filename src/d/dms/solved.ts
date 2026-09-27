// "Mark as solved" (Ivan 09-27: "sometimes I don't want to answer ... more like a closer, and I can
// just mark as solved"). No new state: it is TODAY'S plain discard of every pending leg
// (lib discardLegs, mode null) plus the reply detector's own flag lowered on this one prospect.
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
// On a thread with NO draft there is nothing to discard, and the flag alone does not move the
// list (the owed rule reads messages, not the flag), so the key is not offered there.
import { supabase } from '../../lib/supabase'
import type { Thread } from '../../lib/inbox'

export function canMarkSolved(t: Thread): boolean {
  return t.draft !== null && !t.spam && !t.ownerConfirmation
}

/** The detector's "a human has to answer" flag on ONE prospect (same column markSpam/markNotSpam write). */
export async function setNeedsManualReply(prospectId: string, value: boolean): Promise<void> {
  const { error } = await supabase.from('outreach_prospects')
    .update({ needs_manual_reply: value, updated_at: new Date().toISOString() })
    .eq('id', prospectId)
  if (error) throw error
}
