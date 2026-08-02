// Where a prospect actually sits, as a position on a ladder rather than a
// capitalised database string.
//
// ThreadScreen's own header renders `stageLabel(thread.stage)`, which is the raw
// column with its first letter upper-cased ("Connection_sent"). That is fine as a
// label and useless as a position: it does not say what comes before or after, so
// the operator cannot tell "this person just got an invite" from "this person
// replied and is waiting" without knowing the vocabulary.
//
// An unknown stage returns null. Inventing a position for a value this file has
// not seen would be worse than drawing nothing — the pipeline writes new stage
// names regularly (the outreach engine, not this app, owns that vocabulary).

export const STAGE_LADDER = ['Invited', 'Connected', 'Messaged', 'Replied'] as const
export type StageStep = 0 | 1 | 2 | 3

const MAP: Record<string, StageStep> = {
  connection_sent: 0,
  invited: 0,
  ballot_hold: 0,
  engaged: 1,
  connected: 1,
  accepted: 1,
  inbound_request_dm: 1,
  // The stage live rows actually carry once a DM has gone out. Read off the
  // production data on 2026-08-01 rather than guessed: 'dm_sent' is the modal
  // value in the inbox today.
  dm_sent: 2,
  dm1_sent: 2,
  dm2_sent: 2,
  inmail_sent: 2,
  followup_sent: 2,
  messaged: 2,
  replied: 3,
  needs_manual_reply: 3,
  in_conversation: 3,
  warm: 3,
  nurture: 3,
  booked: 3,
  meeting_booked: 3,
  call_booked: 3,
  won: 3,
  client: 3,
}

export function stageStep(stage: string): StageStep | null {
  const key = (stage ?? '').trim().toLowerCase()
  return key in MAP ? MAP[key] : null
}

// 'archived' is not a step backwards on the ladder, it is off the ladder — the
// grouper already treats it as the reason a draft is suppressed (inbox.ts:73).
export function stageIsOff(stage: string): boolean {
  const key = (stage ?? '').trim().toLowerCase()
  return key === 'archived' || key === 'disqualified' || key === 'bounced'
}
