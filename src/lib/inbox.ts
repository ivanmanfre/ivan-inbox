import { parseEmailCc } from './emailCc'
import { label } from './labels'
import { supabase } from './supabase'
import { bounded } from './noAnswer'
import { STAGE_LADDER, stageIsOff, stageStep } from '../exp/v2c/stage'
import type { EmailDetails, EmailMetadata } from './emailPresentation'

export type InboxMessage = {
  id: string; prospect_id: string; direction: 'inbound' | 'outbound';
  message_text: string; message_type: string | null;
  channel: 'linkedin' | 'linkedin_inmail' | 'email';
  sent_at: string | null; approved_at: string | null; read_at: string | null;
  created_at: string; send_blocked_at: string | null; send_blocked_reason: string | null;
  unipile_chat_id: string | null;
  unipile_message_id?: string | null;
  // 'manual_mirror' = typed by hand in the LinkedIn app and mirrored in by the
  // sync; anything else outbound was dispatched by the system.
  ai_model: string | null;
  prospect_name: string; prospect_company: string | null; prospect_headline: string | null;
  prospect_stage: string; prospect_email: string | null; profile_photo_url: string | null;
  // outreach_prospects.linkedin_url, denormalised into inbox_messages_v by db/044.
  // The FALLBACK link, for the invite-only rows that have no LinkedIn chat yet.
  prospect_linkedin_url: string | null;
  // LinkedIn's own conversation id, resolved by db/044 from `unipile_chats` (which mirrors
  // the `provider_id` on the Unipile chat object). The last segment of a real messaging
  // thread URL — see CopyChatLink. Null on threads that are still invite-only.
  chat_provider_id: string | null;
  campaign_name: string; client_id: string;
  // outreach_prospects.skip_reason, denormalised into inbox_messages_v on 2026-09-07. The one
  // value this app reads is SPAM_REASON: the reply detector's verdict that a stranger was
  // cold-pitching a client's seat (Ivan, on John Adegboye's Upwork pitch reaching his inbox as
  // "Replied": "a small likely-spam folder ... so I don't miss anything ... but no push").
  // Optional because the stock screens' fixtures predate the column.
  prospect_skip_reason?: string | null;
  // outreach_messages.reply_intent (the reply detector's verdict on an inbound:
  // negative / neutral / positive / info_ask / soft_yes) and
  // outreach_prospects.blacklisted, both denormalised into inbox_messages_v on
  // 2026-09-22 (db/204). Andy Brenits' "No thank you, not Needed." sat in
  // "Needs your reply" for 8 days: the detector had stamped it negative AND
  // blacklisted the prospect, but the app re-judged the text with its own regex
  // (which knows "no thanks" and not "no thank you"). The engine's verdict wins.
  reply_intent?: string | null;
  prospect_blacklisted?: boolean | null;
  // outreach_prospects.enrichment_data->>'lane', denormalised into inbox_messages_v on
  // 2026-09-24 (db/212) so the thread list can show which campaign lane a conversation
  // came from (Ivan: "on inbox we can see the different lanes we are sending to with a
  // tag no? specially for davorin's"). Optional because the stock screens' fixtures
  // predate the column, same as reply_intent/prospect_blacklisted above.
  lane?: string | null;
  // The copy route this ARCH person is on, '<sent|next>:<route>[:<invite arm>]' (db/213, 2026-09-24),
  // null for every other seat. Rendered by labels.ts copyRouteTag. Optional for the same fixture reason.
  copy_route?: string | null;
  // lane_of(campaign name) (db/215, 2026-09-26): cold / warm / engager / harvest / partner / signal.
  // The row's lane chip falls back to it where `lane` is unset (almost every Ivan and RISE row).
  campaign_lane?: string | null;
  // db/216 (decision 12): 'reply_myself' when the draft was discarded with "I'll reply myself", which
  // keeps the thread under Needs your reply. Null for a plain discard and for every other row.
  discard_mode?: string | null;
  // Not in inbox_messages_v — annotated onto pending drafts by useInbox from the
  // fetchDraftEmailStamps() probe. When set on a draft, approving it makes the
  // dispatcher ALSO email the scan to this address (rise_dm2_scan_delivery_v1 rows).
  recipient_email?: string | null;
  email_cc?: string[] | null;
  email_details?: EmailDetails;
  email_details_unavailable?: boolean;
  email_delivery_recipient?: string | null;
  send_via?: DraftSendVia | null;
  // The exact email body the dispatcher will send (composed + stored by the
  // drafter). Shown verbatim under the badge so approval sees the real send.
  email_mirror_text?: string | null;
  // Answerability gate (Ivan 2026-08-19). Set by the RISE reply drafter when the
  // prospect asked something rise-company-facts does not cover, so the reply's
  // substance is UNVERIFIED (George Gazzard/SOLSKIN asked how the creative gets
  // produced; the drafter invented "real shoots for model and skin content").
  // Advisory on ordinary drafts; owner_confirmation rows are internal holds.
  context_gap?: DraftContextGap | null;
  // What the drafter was actually GIVEN when it wrote this (Ivan 2026-08-20: "see the draft on the
  // dm with a small context collapsed thing"). A logged input list, never the model's account of
  // what it used — asked that, a model confabulates. Probed like context_gap: not in the view.
  draft_evidence?: DraftEvidence | null;
  draft_evidence_unavailable?: boolean;
  // The email-stamp probe failed, so the app cannot tell whether approving this
  // draft also mails something. Said on the card, never guessed.
  email_stamp_unavailable?: boolean;
  // "Push this to later" (Ivan, 2026-08-20 — "some people just say I am
  // travelling"). Set from the draft card; db/037. A pushed draft stays PENDING
  // (approved_at NULL), so the dispatcher still cannot send it — see the
  // migration header. Columns live in inbox_messages_v, so unlike the two
  // probe-annotated fields above these arrive with every row.
  snoozed_until: string | null;
  snoozed_at: string | null;
}

export type Thread = {
  prospect_id: string; prospect_name: string; prospect_company: string | null;
  client_id: string; channel: InboxMessage['channel']; stage: string;
  // Where this conversation lives on LinkedIn, for handing it to whoever has to act on it
  // by hand: the chat itself when one exists, the profile as the fallback. See CopyChatLink.
  linkedin_url: string | null;
  chat_provider_id: string | null;
  last: InboxMessage; unread: number; draft: InboxMessage | null; messages: InboxMessage[];
  // Filed as a cold pitch (prospect_skip_reason === SPAM_REASON). A spam thread is out of
  // every lane but 'spam', out of the badge and out of the push, and stays readable there
  // so nothing is lost. See filterThreads / inboxBreakdown / markSpam / markNotSpam.
  spam: boolean;
  // outreach_prospects.blacklisted: the engine closed this person (decline, opt-out,
  // vendor). Stage stays 'replied' on a decline, so CLOSED_STAGES cannot see it.
  blacklisted: boolean;
  // A SECOND pending draft on a DIFFERENT channel, staged as one intent with the
  // first (Ivan, 2026-09-04, Nitin Manchanda: "he asked for an email so we should
  // have the ability to check the email draft as well as the dm").
  //
  // 🔴 WHY THIS EXISTS. `draft` is drafts[last], which is right for a REDRAFT — a
  // second rise_reply on the same channel supersedes the first, and showing both
  // would offer to send the same message twice. It is wrong when the two rows are
  // different LEGS: a LinkedIn DM saying "shooting it to your inbox too" plus the
  // email that backs it. Nitin had exactly that pair, both pending, both stamped
  // at 21:13:26 — and the inbox rendered only the email, with the DM invisible
  // (drafts are excluded from the bubble list) and unsendable. Unlike the RISE
  // mirror, where one row carries email_mirror_text and the sender does both legs,
  // these are two independent rows the dispatcher picks up separately.
  //
  // Paired ONLY on a different channel family, so a supersede is never split into
  // two cards. Everything older on either channel stays hidden as before. On a
  // pair, the EMAIL is the one that lands here and the LinkedIn message keeps the
  // main box — see the ordering note in groupThreads.
  companionDraft: InboxMessage | null;
  // Internal decision waiting on a confirmed fact or automatic retry; never sendable.
  ownerConfirmation?: InboxMessage | null;
  // The drafter sometimes writes a reply after Ivan already answered the
  // prospect himself (5 live cases on 2026-07-22: George, Jeremy, Jonathan,
  // Antoine, Rudra). True when a real outbound send is newer than the last
  // inbound, so the pending draft is answering an already-handled message.
  draftStale: boolean;
  // When the pending draft was pushed to, or null when nothing is pushed and
  // when a push has expired or been voided by a reply. THE one place the app
  // asks "is this draft parked": buckets, badge, needsAnswer and every card
  // read this, so they cannot disagree about whether a draft is waiting.
  draftSnoozedUntil: string | null;
  // outreach_prospects.needs_manual_reply — the reply detector's own "a human
  // has to answer this one" flag. It is NOT derivable from the messages: on
  // 2026-08-03, 43 of the 45 flagged prospects had ZERO inbound rows in
  // inbox_messages_v (the reply the detector saw never got mirrored into the
  // view — the reply-blindspot class of bug). Going by message rows alone would
  // make every one of them invisible, so the flag rides on the thread.
  needsManualReply: boolean;
  // outreach_prospects.solved_at (db/20260927): Ivan's "Mark as solved", the thread needs no
  // answer. Not in inbox_messages_v; D reads it separately and merges it (src/d/counts/solved.ts).
  // The thread is settled while solved_at is at or after its last owed inbound; a newer inbound
  // makes it owed again by itself. Absent (undefined) everywhere nobody merged it.
  solvedAt?: string | null;
  // last.lane, coalesced to null. See InboxMessage.lane above.
  lane: string | null;
  // last.copy_route, coalesced to null. See InboxMessage.copy_route above.
  copyRoute: string | null;
  // last.campaign_lane, coalesced to null. Optional so older fixtures still type.
  campaignLane?: string | null;
}

/* ==========================================================================
   E1 · THE LADDER, DERIVED FROM FIELDS (goal run
   inbox-repair-floor-and-21st-moves-2026-09-12).

   The thread pane drew the stage ladder off `stageStep(stage)` alone, which can
   only ever say done / current / todo. A pipeline that can only move forward
   cannot say a thing FAILED, so a send the dispatcher blocked at the send moment
   drew exactly like a person who has simply not replied yet.

   THE RULE: `failed` renders only where a FIELD proves it. Nothing here infers a
   failure from a stage that stopped moving, from an age, or from a silence.
   ========================================================================== */

/** A send that was blocked and is not coming back on its own.

    ONE predicate for the ladder and for the bubble's own "Send failed: …" label
    (Conversation.tsx's `outLabel`), so the rung and the message under it can
    never disagree about whether something failed. Every recoverable state is
    excluded by name: the discard marker, a race hold and a lint hold (both of
    which `isDraft` treats as still-pending), and the internal-confirmation
    reasons, which are a question waiting on an owner rather than a failure. */
export function sendFailed(m: InboxMessage): boolean {
  if (m.direction !== 'outbound') return false
  if (m.send_blocked_at === null) return false
  if (m.send_blocked_reason === DISCARD_REASON || m.send_blocked_reason === REDRAFT_REASON || ['scheduled_in_inbox','scheduled_send_cancelled'].includes(m.send_blocked_reason ?? '')) return false
  if (isRecoverableHold(m.send_blocked_reason)) return false
  // LinkedIn will not deliver to this person (blocked, or cannot receive): a quiet "Not delivered" line, never a failure.
  if (isUnreachableSend(m)) return false
  // SwishDM review hold (first-list notes, DM1 rows and reply drafts): waiting for a person, nothing was attempted.
  if (m.send_blocked_reason === SWISHDM_REPLY_HOLD) return false
  // A sender that deliberately did not send (invite instead, they replied, excluded...) did not fail.
  if (isIntentionalStop(m)) return false
  if (isInternalConfirmation(m)) return false
  if (isEngineRetired(m)) return false
  return true
}

// A send the SENDER chose not to make, on purpose, after the row was approved: the person got an
// invite instead (routed_to_invite), they replied or reacted first, someone messaged them by hand,
// the invite was withdrawn, or an exclusion list matched. Nothing failed and nobody has to act, so
// it never wears "Send failed" and never offers "Send anyways" (SwishDM, 2026-10-19: 18 routed
// InMails drew a red bubble in every thread). Real failures keep their own reasons (send_failed_*,
// inmail_failed_*, stale_send_claim:, bad_text:) and stay failures.
const INTENTIONAL_STOP = /^(routed_to_invite|(?:[a-z]+_)*(?:replied|reply|reaction|reacted)_stop|manual_touch|invite_withdrawn|(?:[a-z]+_)*exclu(?:sion|ded)(?:_[a-z]+)*)(?=$|[:\s])/

// A message we or Ivan stopped ON PURPOSE (disqualified, rejected, a killed revival, a dead thread, "do not send"...).
// KEEP IN SYNC with public.send_rejected_inbox_draft (live 2026-10-21, send audit 2): that function raises
// "This message was stopped on purpose" for exactly these prefixes (`~ '^(...)'`) or a reason matching
// `~* 'do not send'` (it also refuses a blacklisted prospect, which the inbox rows do not carry). The inbox
// shows these as a quiet "Stopped: ..." line with Discard only: never Held, never a failure, never Send anyway.
export const STOPPED_ON_PURPOSE_PREFIXES = ['ivan_disqualify', 'ivan_rejected', 'revival_cancelled', 'revival_lane_killed', 'vetting_',
  'duplicate_already_delivered', 'superseded_war_room', 'stale_convo_closed', 'stale_draft_voided', 'phishing_link', 'cross_tenant_leak',
  'drafter_echoed', 'model_meta_no_reply', 'wrong_branch', 'replied_stop', 'auto_reply_ooo'] as const
/** The DB's own pattern, character for character: `send_blocked_reason ~ STOPPED_ON_PURPOSE_SQL`. */
export const STOPPED_ON_PURPOSE_SQL = `^(${STOPPED_ON_PURPOSE_PREFIXES.join('|')})`
const STOPPED_ON_PURPOSE = new RegExp(STOPPED_ON_PURPOSE_SQL)
/** The DB's case-insensitive `~* 'do not send'`. */
export const DO_NOT_SEND_SQL = 'do not send'
const DO_NOT_SEND = new RegExp(DO_NOT_SEND_SQL, 'i')

export function isStoppedOnPurposeReason(reason: string | null | undefined): boolean {
  const r = reason ?? ''
  return STOPPED_ON_PURPOSE.test(r) || DO_NOT_SEND.test(r)
}

/** An unsent outbound row stopped on purpose (see STOPPED_ON_PURPOSE_PREFIXES). */
export function isStoppedOnPurpose(m: Pick<InboxMessage, 'direction' | 'sent_at' | 'send_blocked_reason'>): boolean {
  return m.direction === 'outbound' && !m.sent_at && isStoppedOnPurposeReason(m.send_blocked_reason)
}

const STOPPED_WORDS: Record<(typeof STOPPED_ON_PURPOSE_PREFIXES)[number], string> = {
  ivan_disqualify: 'you disqualified this person', ivan_rejected: 'you rejected this lead', revival_cancelled: 'the revival was cancelled',
  revival_lane_killed: 'the revival lane was turned off', vetting_: 'the thread was vetted as dead', duplicate_already_delivered: 'it was already delivered',
  superseded_war_room: 'replaced by another message', stale_convo_closed: 'the conversation was closed', stale_draft_voided: 'the draft was voided',
  phishing_link: 'a phishing link was found in the thread', cross_tenant_leak: 'it was drafted on the wrong seat', drafter_echoed: 'the draft echoed a LinkedIn notice',
  model_meta_no_reply: 'no reply was needed', wrong_branch: 'it was drafted for the wrong situation', replied_stop: 'they replied',
  auto_reply_ooo: 'their message was an out-of-office auto-reply',
}

// A superseded row in any spelling (superseded_by_*, superseded_awaiting_*, 'superseded: ... rerouted to invite'):
// something replaced it, nothing failed (send audit 2, Krishna Solanki drew a red "Send failed").
const SUPERSEDED = /^superseded(?=$|[_:\s])/

export function isIntentionalStopReason(reason: string | null | undefined): boolean {
  return INTENTIONAL_STOP.test(reason ?? '') || SUPERSEDED.test(reason ?? '') || isStoppedOnPurposeReason(reason)
}

export function isIntentionalStop(m: Pick<InboxMessage, 'direction' | 'sent_at' | 'send_blocked_reason' | 'draft_evidence'>): boolean {
  if (m.direction !== 'outbound' || m.sent_at) return false
  const stopped = m.draft_evidence?.stopped
  return isIntentionalStopReason(m.send_blocked_reason) || (stopped !== undefined && stopped !== null && stopped !== false)
}

/** The muted line an intentional stop shows where a failed send would say "Send failed". */
export function stopLabel(m: Pick<InboxMessage, 'send_blocked_reason'>): string {
  const r = m.send_blocked_reason ?? ''
  if (r.startsWith('routed_to_invite')) return 'Not sent: sent an invite instead'
  if (/(?:replied|reply)_stop/.test(r)) return 'Not sent: they replied'
  if (/(?:reaction|reacted)_stop/.test(r)) return 'Not sent: they reacted'
  if (r.startsWith('manual_touch')) return 'Not sent: you messaged them yourself'
  if (r.startsWith('invite_withdrawn')) return 'Not sent: invite withdrawn'
  if (/exclu(?:sion|ded)/.test(r)) return 'Not sent: excluded'
  const kill = STOPPED_ON_PURPOSE_PREFIXES.find(p => r.startsWith(p))
  if (kill) return `Stopped: ${STOPPED_WORDS[kill]}`
  if (r.startsWith('superseded_scan_owed')) return 'Not sent: blocked, the reply with the scan replaces it'
  if (SUPERSEDED.test(r)) return /invite/i.test(r) ? 'Not sent: sent an invite instead' : 'Not sent: replaced by another message'
  if (DO_NOT_SEND.test(r)) return 'Stopped: marked do not send'
  return 'Not sent: stopped on purpose'
}

/** A row on Jonathan's SwishDM seat. Only the SwishDM n8n senders send these; the inbox never does. */
export function isSwishdmRow(m: Pick<InboxMessage, 'client_id' | 'draft_evidence' | 'lane'>): boolean {
  return m.client_id === 'swishdm' || m.draft_evidence?.client === 'swishdm'
    || /^swishdm_/.test(m.draft_evidence?.lane ?? '') || /^swishdm_/.test(m.lane ?? '')
}

/** A SwishDM first-list DM1 waits for the invite to go out and be accepted before its sender queues it.
 *  Null for every other row. Reads the prospect stage the thread already carries (no extra read). */
export function swishdmDm1Wait(m: InboxMessage): string | null {
  if (m.client_id !== 'swishdm' || m.direction !== 'outbound' || m.sent_at || !m.approved_at || m.send_blocked_at) return null
  if (messageChannel(m) !== 'dm') return null
  if (m.draft_evidence?.dm_queue?.state === 'queued') return null
  const ev = m.draft_evidence?.lane
  if (ev && ev !== 'swishdm_first_list') return null
  if (m.prospect_stage === 'connection_sent') return 'Waiting for accept'
  if (SWISHDM_PRE_INVITE.has(m.prospect_stage)) return 'Waiting for invite'
  return null
}
const SWISHDM_PRE_INVITE = new Set(['swishdm_staged_hold', 'enriched', 'queued', 'ballot_hold', 'expansion_hold'])

// A pending draft the ENGINE itself took off the table because something newer
// replaced it: a redraft, a fresher inbound, a closed conversation, the 3-day expiry, or a writer that
// answered "no reply needed". Nothing was attempted and nothing failed, so it
// never wears "Send failed" (JeongHyun Bae carried six red "Send failed" bubbles
// for six superseded redrafts, 2026-09-26 review). Matched on the unsent row
// only: a sent row is history whatever its reason says.
const ENGINE_RETIRED = /^(superseded_by|stale_draft_expired|stale_convo_closed|model_meta_no_reply|writer_no_reply|replied_before_qualifier)/

export function isEngineRetired(m: InboxMessage): boolean {
  return m.direction === 'outbound' && !m.sent_at && !m.approved_at
    && ENGINE_RETIRED.test(m.send_blocked_reason ?? '')
}

// An engine-retired draft that shows NOTHING, not even the quiet line: the
// inbound-request lane's canned opener, pulled because the person wrote first.
// It was never Mattan's message and the thread already shows their note (Ivan
// 2026-09-28 on Danil Kontsevoy: "why do I need to see send failed").
export function isHiddenRetired(m: InboxMessage): boolean {
  return isEngineRetired(m) && m.send_blocked_reason === 'replied_before_qualifier'
}

/** Reasons that are never a failed send, judged on the reason alone: replaced, expired, scheduled, an invite
 *  instead, they replied, excluded, or stopped on purpose. A POSIX regex both Postgres (`~`, the Lanes and send
 *  log counts in lib/sends) and JS read the same way, so the count and the rows cannot disagree (send audit 2). */
export const NOT_A_FAILURE_SQL = `^(discarded|superseded|redraft_requested|scheduled_in_inbox|scheduled_send_cancelled|stale_draft_expired|stale_convo_closed|model_meta_no_reply|writer_no_reply|replied_before_qualifier|routed_to_invite|manual_touch|invite_withdrawn|([a-z]+_)*(replied|reply|reaction|reacted)_stop|([a-z]+_)*exclu(sion|ded)|${STOPPED_ON_PURPOSE_PREFIXES.join('|')})`
const NOT_A_FAILURE = new RegExp(NOT_A_FAILURE_SQL)
export function isNotAFailureReason(reason: string | null | undefined): boolean {
  const r = reason ?? ''
  return NOT_A_FAILURE.test(r) || DO_NOT_SEND.test(r)
}

/** The quiet line an engine-retired draft shows in place of a bubble. */
export function retiredLabel(m: InboxMessage): string {
  const r = m.send_blocked_reason ?? ''
  if (r.startsWith('superseded_by')) return 'Draft not sent, replaced by a newer one'
  if (r.startsWith('stale_draft_expired')) return 'Draft not sent, it expired'
  if (r.startsWith('stale_convo_closed')) return 'Draft not sent, the conversation was closed'
  return 'Draft not sent, no reply was needed'
}

/* ==========================================================================
   HELD SENDS (Ivan 2026-10-21, Barak Zuman: he pressed Send on his own edited
   reply, the sender held it, and it vanished: he thought it was deleted).

   A gate that holds a message clears the approval and writes a reason. A lint
   hold became a "draft" again, and a newer internal retry hold or a newer
   draft pushed it out of both the draft pane and the history. Other gate holds
   drew as "Send failed" on a thread nobody opened (~25 leads since 10-07).

   THE RULE: an unsent outbound row with words and a gate reason is HELD, and a
   held row is never invisible. Not a hold: a discard, a supersede, a schedule,
   an invite sent instead, the internal question / retry hold (PR #42 keeps its
   own card), an engine retirement, an intentional stop, and the SwishDM review
   hold (a draft waiting for approval, nothing was attempted).
   ========================================================================== */
const NOT_A_HOLD = /^(discarded|superseded|scheduled|routed_to_invite|owner_confirmation_superseded|redraft_requested)(?=$|[_:\s])/

export function isHeldSend(m: InboxMessage): boolean {
  if (m.direction !== 'outbound' || m.sent_at || m.unipile_message_id) return false
  const r = m.send_blocked_reason
  if (!r || !m.send_blocked_at || !(m.message_text ?? '').trim()) return false
  if (NOT_A_HOLD.test(r) || r === SWISHDM_REPLY_HOLD) return false
  // Unreachable on LinkedIn (Ivan 10-21: "if he's blocked, he shouldn't even appear as an error"): nothing to act on.
  if (isUnreachableRecipient(r)) return false
  return !isInternalConfirmation(m) && !isEngineRetired(m) && !isIntentionalStop(m)
}

/** The newest held row on a thread, while we have sent nothing since it was written. Any later send
 *  means the thread was seen and followed up (Ivan 10-21: show only the holds nobody acted on). */
export function heldSend(t: Pick<Thread, 'messages'>): InboxMessage | null {
  const held = t.messages.filter(isHeldSend).sort((a, b) => Date.parse(a.send_blocked_at!) - Date.parse(b.send_blocked_at!)).at(-1)
  if (!held) return null
  // Send audit 2: (a) the same words already went out (a sent row or a manual_mirror of it, e.g. Aurimas Gackas /
  // Nicole Sumner: delivered, mirrored seconds after the reservation, then held as unconfirmed). (b) Otherwise judge
  // "sent since" from the last moment it was chosen to go out (written, approved, or a Send anyway / schedule
  // press), never later than the hold: a send before Ivan approved it is not a follow-up to it (Alicia Yingru WANG
  // 06aaab91: written 10-11, three sends 10-11/12, approved 10-15, held 10-15 and hidden since).
  const words = sameWords(held.message_text)
  const blocked = Date.parse(held.send_blocked_at!)
  const chosen = [held.created_at, held.approved_at, operatorSentAt(held)?.at].filter(validAt).map(Date.parse)
  const at = Math.min(blocked, Math.max(...chosen))
  return t.messages.some(m => m.id !== held.id && m.direction === 'outbound' && m.sent_at
    && (Date.parse(m.sent_at) > at || (!!words && sameWords(m.message_text) === words && Date.parse(m.sent_at) >= Date.parse(held.created_at) - SAME_WORDS_NEAR_MS))) ? null : held
}
const SAME_WORDS_NEAR_MS = 10 * 60_000
const sameWords = (text: string | null | undefined) => (text ?? '').replace(/\s+/g, ' ').trim().toLowerCase()

/** A held row the existing scheduler (schedule_inbox_dm) takes as it is: only a lint or race hold. A gate
 *  hold (duplicate_in_thread, send_failed_verified...) is refused there, and a paused schedule has its own card. */
export function canScheduleHeld(m: InboxMessage): boolean {
  const r = m.send_blocked_reason
  return isHeldSend(m) && !m.approved_at && isRecoverableHold(r) && !r!.startsWith(`${RACE_HOLD_PREFIX}scheduled`)
}

/** LinkedIn's 422 invalid_recipient / blocked_recipient (provider_invalid_recipient, or the provider type kept in
 *  the reason, e.g. 'send_failed_verified: ... [errors/blocked_recipient]'): the person cannot receive messages
 *  or blocked us, so Send anyway only burns a daily slot (send audit 10-21). Not 'no_connection_with_recipient':
 *  that one is fixable with an invite and stays a held send. */
export function isUnreachableRecipient(reason: string | null | undefined): boolean {
  const r = reason ?? ''
  return UNREACHABLE_MARKS.some(k => r.includes(k))
}
/** The words that mark a reason as unreachable ('provider_invalid_recipient' carries the first). One list, so the
 *  server-side filters that keep these rows out of failure counts (lib/sends) match this helper exactly. */
export const UNREACHABLE_MARKS = ['invalid_recipient', 'blocked_recipient'] as const

/** An unsent outbound row LinkedIn would not deliver (Ivan 10-21, Ben Chehebar / Toby Hart: "if he's blocked,
 *  he shouldn't even appear as an error ... I don't want to see it"). Not held, not failed, not a draft: the
 *  thread shows one quiet "Not delivered" line in its place and nothing else lists it. */
export function isUnreachableSend(m: Pick<InboxMessage, 'direction' | 'sent_at' | 'send_blocked_at' | 'send_blocked_reason'> & { unipile_message_id?: string | null }): boolean {
  return m.direction === 'outbound' && !m.sent_at && !m.unipile_message_id && !!m.send_blocked_at && isUnreachableRecipient(m.send_blocked_reason)
}

/** The quiet line an unreachable row shows in the thread, in place of its bubble. */
export function unreachableLabel(m: Pick<InboxMessage, 'send_blocked_reason'>): string {
  return (m.send_blocked_reason ?? '').includes('blocked_recipient')
    ? 'Not delivered \u00b7 blocked you on LinkedIn'
    : 'Not delivered \u00b7 can\u2019t receive messages on LinkedIn'
}

/** Why a row is held, in plain words. An unknown code shows as written. */
export function heldReasonText(reason: string | null | undefined): string {
  const r = (reason ?? '').trim()
  const tail = r.includes(':') ? r.slice(r.indexOf(':') + 1).trim() : ''
  if (r.startsWith('lint_calendar_') || /^calendar_(context_or_)?wording_unverified/.test(r)) return 'The calendar check could not verify the proposed time or wording.'
  if (r.startsWith('arch_market_claim_unratified')) return `It mentions ${tail || 'a market'}, which is not a confirmed ARCH market.`
  // Send audit 2 (10-21): the sender retries a failure on our side (a guard, a code error, a reservation) twice
  // without writing a reason; only the 3rd failure writes dispatch_error:<why>, clears the approval and stops.
  // Nothing retries after that, so the words say so. dispatch_hold:<why> is the same stop before any attempt,
  // and dm_dispatch:<why> is the send-slot reservation refusing it (the row keeps its approval but is not retried).
  if (r.startsWith('dispatch_error')) return 'Couldn\u2019t reach LinkedIn after 3 tries. Nothing was sent. Send anyway to try again.'
  if (r.startsWith('dispatch_hold')) return 'Our system stopped it before it reached LinkedIn. Nothing was sent. Send anyway to try again.'
  if (r.startsWith('dm_dispatch')) return r.includes('claim_changed')
    ? 'The send slot changed while it was going out. Nothing was sent. Send anyway to try again.'
    : 'The send slot was not available. Nothing was sent. Send anyway to try again.'
  // A deliberate stop (send_rejected_inbox_draft refuses Send anyway on these): plain words, never the code.
  if (isStoppedOnPurposeReason(r)) return stopLabel({ send_blocked_reason: r })
  if (isUnreachableRecipient(r)) return r.includes('blocked_recipient') ? 'This person blocked messages on LinkedIn.' : 'LinkedIn says this person can\u2019t receive messages.'
  // Not connected yet: fixable, so it stays a held send (Ivan 10-21).
  if (r.includes('no_connection_with_recipient')) return 'Not connected on LinkedIn: send an invite first.'
  if (r.startsWith('send_failed_verified')) return /status code \d{3}|\b[45]\d\d\b/.test(r)
    ? `LinkedIn refused the send${/\b422\b/.test(r) ? ' (error 422)' : ''}. Check LinkedIn before sending again.`
    : `Our system stopped it before it reached LinkedIn${tail ? ` (${tail.replace(/^(hard error|chat create failed):\s*/, '').replace(/_/g, ' ')})` : ''}.`
  if (r.startsWith('inmail_failed_422')) return /limit_exceeded|usage limit/i.test(r) ? 'The InMail limit for this period was reached.' : 'LinkedIn refused the InMail (error 422).'
  if (r.startsWith('provider_success_unconfirmed')) return 'The sender could not confirm it arrived. Check LinkedIn before sending again.'
  if (r.startsWith('accuracy_hold')) return 'The accuracy check found a claim that needs correcting.'
  if (r === 'duplicate_in_thread') return 'It repeats a message already in the thread.'
  if (r === 'rise_followup_repeated_or_unwarranted') return 'The follow-up check found it repeats an earlier ask or is not needed.'
  if (r === 'arch_qualification_review') return 'This lead’s ARCH qualification needs a review first.'
  if (r === 'followup_prospect_held') return 'Follow-ups are paused for this person.'
  if (r === 'followup_future_date') return 'They asked to hear back on a later date.'
  if (r === 'arch_conversation_owner_only') return 'Only Davorin writes in this conversation.'
  if (r.startsWith('geo_gate_v2')) return 'The location check blocked it.'
  if (r === 'asset_promise_without_link') return 'It promises something without the link.'
  if (r === 'lint_unbacked_commitment') return 'It promises an email that is not attached.'
  if (r === 'lint_email_cc_invalid') return 'The CC addresses need checking.'
  if (r === 'lint_scan_quality_hold') return 'The scan review found no supported recommendation.'
  if (r.startsWith(LINT_HOLD_PREFIX)) return 'The send check flagged a line.'
  if (r.startsWith(RACE_HOLD_PREFIX)) return 'The thread changed while it was queued.'
  // Send audit 2: codes that reached Ivan raw under a held bubble.
  if (r === 'wins_operator_review_required') return 'Needs your review before it sends.'
  if (r.startsWith('not_icp')) return 'Marked as not a fit (outside the ICP).'
  if (r === 'wins_release_review_withdrawn') return 'The wins review withdrew its release. Review it before sending.'
  if (r === 'ballot') return 'Held for a decision on this lane or its copy.'
  if (r === 'audit_request_repair') return 'The audit request needs a fix before it sends.'
  if (r === 'arch_owner_quote_review') return 'Davorin needs to review the quote first.'
  if (r === 'followup_structured_hold') return 'The follow-up check held it for review.'
  // The copy lint's own codes, one or several joined by commas: em_dash, buzzword, opener_*, hedge_*, closer_*.
  if (/^(em_dash|buzzword|(opener|hedge|closer)_[a-z_]+)(,(em_dash|buzzword|(opener|hedge|closer)_[a-z_]+))*$/.test(r)) return 'The language check flagged a line.'
  // An unknown code never reaches the screen bare: the code in words (without a trailing date), then its note.
  const code = (r.includes(':') ? r.slice(0, r.indexOf(':')) : r).replace(/_?\d{4}-\d{2}-\d{2}$/, '')
  return code ? `${label(code)}${tail ? `: ${tail}` : ''}` : r
}

// Why a recoverable hold came back to the inbox. The sender used to say this
// only in a WhatsApp alert; the draft itself looked like any other draft.
export function holdReason(m: InboxMessage): string | null {
  const r = m.send_blocked_reason
  if (isSwishdmReplyHold(m) && isDraft(m)) return null
  if (!isDraft(m) || !isRecoverableHold(r)) return null
  if (isRaceHold(r)) return r === `${RACE_HOLD_PREFIX}outbound`
    ? 'Came back: a message went out on this thread while it was queued. Re-read the thread, then approve again.'
    : 'Came back: they wrote while it was queued. Re-read their message, then approve again.'
  if (r?.startsWith('lint_calendar_')) return 'Not sent: the calendar check held this draft. Review the proposed time or edit the invitation before sending again.'
  if (r === 'lint_email_cc_invalid') return 'Email held: check the CC addresses before approving.'
  if (r === 'lint_scan_quality_hold') return 'Scan held: the latest review found no supported recommendation. Review the scan before approving; the sender will keep it held.'
  if (r === 'lint_unbacked_commitment') return 'Came back: the DM promises an email that is not attached. Fix the line or add the email, then approve again.'
  return 'Came back: the send check flagged a line. Fix it, then approve again.'
}

export type LadderStepState = 'done' | 'current' | 'todo' | 'failed'
export type LadderStep = { id: string; label: string; state: LadderStepState }

/** What the pane draws where the ladder goes. `off` and `unknown` carry the raw
    stage so the caller can put it through `label()`; this module never renders. */
export type LadderView =
  | { kind: 'off'; stage: string }
  | { kind: 'unknown'; stage: string }
  | { kind: 'steps'; steps: LadderStep[] }

export function ladderSteps(thread: Pick<Thread, 'stage' | 'messages'>): LadderView {
  const stage = thread.stage ?? ''
  // Off the ladder entirely (archived / disqualified / bounced). Not a failed
  // RUNG — there is no rung — and not a state this function invents a position
  // for either.
  if (stageIsOff(stage)) return { kind: 'off', stage }
  const step = stageStep(stage)
  // A stage this app has not been taught. Saying so beats drawing a guess: the
  // outreach engine owns that vocabulary and adds to it regularly.
  if (step === null) return { kind: 'unknown', stage }
  // THE LAST OUTBOUND ROW, and only that one. A send that failed in March and
  // was followed by one that landed is history, not the state of this
  // conversation; marking the rung red for ever would be the same class of lie
  // as a severity on a backlog.
  let lastOut: InboxMessage | null = null
  for (const m of thread.messages) {
    if (m.direction !== 'outbound') continue
    if (isDraft(m) || isInternalConfirmation(m)) continue
    lastOut = m
  }
  const failed = lastOut !== null && sendFailed(lastOut)
  return {
    kind: 'steps',
    steps: STAGE_LADDER.map((l, i) => ({
      id: l,
      label: l,
      // The failure happened on the rung the conversation is standing on: the
      // ones behind it really were climbed.
      state: i < step ? 'done' : i === step ? (failed ? 'failed' : 'current') : 'todo',
    })),
  }
}

export type Filter = 'all' | 'ivan' | 'risedtc' | 'arch' | 'swishdm' | 'email' | 'spam'

// The marker the RISE reply detector writes on a vendor verdict (skip_reason). The inbox's
// own Spam button writes the same value, so the engine, the push trigger and this app all
// read one word.
export const SPAM_REASON = 'inbound_vendor_pitch'

// Written by the inbox-delete-thread edge fn once the LinkedIn chat is confirmed gone
// (Ivan, 2026-09-22). groupThreads drops these threads everywhere. Keep in sync with
// the edge fn.
export const DELETED_REASON = 'thread_deleted_by_operator'

// A draft the dispatcher HELD at the send moment because the thread changed
// after approval (Mattan typed on LinkedIn mid-queue, or a fresh inbound
// landed). Unlike every other block reason this one is recoverable by design:
// the copy usually still fits, so the row comes back as a pending draft and
// approve is one tap after re-reading the thread. Discards keep their own
// reason ('discarded_in_inbox') and stay permanent — U1 is untouched.
export const RACE_HOLD_PREFIX = 'post_approval_race:'

// A lint hold ('lint_*', e.g. lint_unbacked_commitment) is the dispatcher's
// deterministic screen bouncing a row at the send moment — the DM claimed an
// email was coming with nothing stamped to back it (06-PLAN item 3, 2026-08-26).
// Recoverable by design, same as a race hold: fix the line (or attach the
// email) and approve is one tap.
export const LINT_HOLD_PREFIX = 'lint_'

// The reason discardDraft writes, and the ONLY block reason restoreDraft will
// undo. Every other value in that column means something restore must not
// touch: `send_failed_verified:*` rows may already have landed on the platform,
// `geo_gate_v2:*` rows are still queued upstream, and a `post_approval_race:*`
// row is already a pending draft with no block to clear.
export const DISCARD_REASON = 'discarded_in_inbox'

// "Draft again" (Ivan 2026-10-25 on Dana Doron's follow-up: "should I have a button Draft again… to try a
// different approach"). A discard tells the stall bump "never redraft this turn"; this marker tells it the
// opposite: write a new follow-up, reading the rejected text and Ivan's note (Stalled Conversation Bump
// qCCZhgogk549PP6v reads redraft_requested rows first and writes the outcome back into the request).
export const REDRAFT_REASON = 'redraft_requested'
const REDRAFT_MODEL = /stall_bump/

/** Offered on stall-bump follow-ups only: that lane is the one that reads the request. */
export function canDraftAgain(t: Thread): boolean {
  return t.draft !== null && REDRAFT_MODEL.test(t.draft.ai_model ?? '') && ['ivan', 'arch', 'risedtc'].includes(t.client_id)
    && !t.spam && !t.ownerConfirmation && t.draftSnoozedUntil === null
}

export type RedraftRequest = {
  v: string; at: string; note: string | null; rejected_text: string
  outcome?: { result: 'drafted' | 'no_follow_up' | 'held'; reason?: string; due_at?: string | null; at: string }
}

/** Retire one leg as a redraft request. False = the guard refused it (approved, sent or changed). */
export async function requestRedraft(id: string, shown: string, note: string): Promise<boolean> {
  const { data: row, error: readError } = await supabase.from('outreach_messages').select('draft_evidence').eq('id', id).single()
  if (readError) throw readError
  const evidence = (row?.draft_evidence ?? null) as DraftEvidence | null
  const at = new Date().toISOString()
  const request: RedraftRequest = { v: 'inbox_redraft_v1', at, note: note.trim() || null, rejected_text: shown }
  let query = supabase.from('outreach_messages')
    .update({ send_blocked_reason: REDRAFT_REASON, send_blocked_at: at, draft_evidence: { ...(evidence ?? {}), redraft_request: request } })
    .eq('id', id).is('sent_at', null).is('approved_at', null)
    .or(`send_blocked_reason.is.null,send_blocked_reason.like.${RACE_HOLD_PREFIX}*,send_blocked_reason.like.${LINT_HOLD_PREFIX}*`)
  query = evidence == null ? query.is('draft_evidence', null) : query.eq('draft_evidence', JSON.stringify(evidence))
  const { data, error } = await query.select('id')
  if (error) throw error
  return (data ?? []).length > 0
}

/** The newest Draft-again request on a thread, with what the writer did about it. */
export async function fetchRedraftRequest(prospectId: string): Promise<{ id: string; request: RedraftRequest | null } | null> {
  const { data, error } = await supabase.from('outreach_messages')
    .select('id,request:draft_evidence->redraft_request')
    .eq('prospect_id', prospectId).eq('send_blocked_reason', REDRAFT_REASON).is('sent_at', null)
    .order('send_blocked_at', { ascending: false }).limit(1)
  if (error) throw error
  const r = (data ?? [])[0] as { id: string; request: RedraftRequest | null } | undefined
  return r ?? null
}

export function isRaceHold(reason: string | null): boolean {
  return reason !== null && reason.startsWith(RACE_HOLD_PREFIX)
}

// Race holds and lint holds share the recovery path: the row comes back as a
// pending draft and approving clears the block.
export function isRecoverableHold(reason: string | null): boolean {
  return isRaceHold(reason) || (reason !== null && reason.startsWith(LINT_HOLD_PREFIX))
}

// SwishDM (Jonathan's seat) holds EVERY draft until a person approves it. The lane-2 reply writer, the
// reaction reply and the comparison-page reply are inserted with this reason and send_blocked_at set, so no
// drafter, reminder or dispatcher that filters on `send_blocked_at IS NULL` ever touches them. The inbox
// shows such a reply as a pending draft and approving it (approve_swishdm_reply_draft) clears the hold on
// that one row. The first-list connection notes and DM1 rows carry the same reason but are reviewed on the
// first-list page, so they are NOT matched here: the match needs the reply writer's ai_model.
export const SWISHDM_REPLY_HOLD = 'awaiting_client_review'
export const SWISHDM_REPLY_MODEL = /^swishdm_reply_/

export function isSwishdmReplyHold(m: Pick<InboxMessage, 'client_id' | 'send_blocked_reason' | 'ai_model'>): boolean {
  return m.client_id === 'swishdm' && m.send_blocked_reason === SWISHDM_REPLY_HOLD && SWISHDM_REPLY_MODEL.test(m.ai_model ?? '')
}

/** The comparison page a SwishDM reply links to, when this reply carries one (from the draft evidence). */
export function swishdmPageUrl(m: Pick<InboxMessage, 'client_id' | 'ai_model' | 'draft_evidence'>): string | null {
  if (!isSwishdmReply(m)) return null
  const u = (m.draft_evidence as { page_url?: unknown } | null | undefined)?.page_url
  return typeof u === 'string' && /^https:\/\/madebyswishdm\.com\/compare\/[a-z0-9]{20}\/$/.test(u) ? u : null
}

/** A SwishDM reply that is waiting for Ivan, in either state: held, or brought back after a discard. */
export function isSwishdmReply(m: Pick<InboxMessage, 'client_id' | 'ai_model'>): boolean {
  return m.client_id === 'swishdm' && SWISHDM_REPLY_MODEL.test(m.ai_model ?? '')
}

export function confirmationOwner(clientId: string): string {
  return clientId === 'swishdm' ? 'Jonathan' : clientId === 'arch' ? 'Davorin' : clientId === 'risedtc' ? 'Mattan' : 'owner'
}

export function isInternalConfirmation(m: InboxMessage): boolean {
  return m.direction === 'outbound' && !m.sent_at && !m.approved_at &&
    (m.send_blocked_reason === 'owner_confirmation' || m.send_blocked_reason === 'owner_confirmation_superseded' || m.send_blocked_reason === 'reply_retry_pending')
}

export function isOwnerConfirmation(m: InboxMessage): boolean {
  return isInternalConfirmation(m) && m.send_blocked_reason === 'owner_confirmation'
}

export function isReplyRetryPending(m: InboxMessage): boolean {
  return isInternalConfirmation(m) && m.send_blocked_reason === 'reply_retry_pending'
}

// Older drafter failures use the owner hold slot, but require a manual reply,
// not a business fact. Only the explicit retry-ceiling marker unlocks compose.
export function isReplyRetryExhausted(m: InboxMessage): boolean {
  return isOwnerConfirmation(m) && m.context_gap?.why?.startsWith('Retry ceiling reached:') === true
}

export function internalHoldSummary(m: InboxMessage): string {
  return isReplyRetryPending(m) ? 'Waiting for automatic retry'
    : isReplyRetryExhausted(m) ? 'Drafting failed. Write this reply yourself.'
      : `Needs owner confirmation: ${m.context_gap?.question || 'Open the internal question'}`
}

export function isDraft(m: InboxMessage): boolean {
  return m.direction === 'outbound' && !m.sent_at && !m.approved_at && m.send_blocked_reason !== 'post_approval_race:scheduled_thread_changed' && !isInternalConfirmation(m) &&
    (!m.send_blocked_at || isRecoverableHold(m.send_blocked_reason) || isSwishdmReplyHold(m))
}

// A NUDGE, not a reply: written because the person went quiet, by the bump
// lanes (`Outreach - Stalled Conversation Bump`, the not-closed follow-up
// drafter) rather than in answer to something they said.
//
// 🔴 WHY THIS EXISTS (Ivan, 2026-08-20: "if its follow up it shouldnt have
// warning"). draftStale asks "did our own send land after their last message" —
// and for a follow-up that is not a defect, it is THE PRECONDITION. The lane
// only drafts when we spoke last and they never answered, so EVERY follow-up
// draft scored stale, wore "you already replied — probably not needed", sank to
// the bottom of the list, and 🔴🔴 was swept by the StaleBar's bulk "Discard
// stale". On the bump lane that bulk discard is unrecoverable: it is
// one-bump-per-prospect-EVER and the prospect is already in the ever-skip set.
//
// Matched on the drafter's own tag rather than the copy, and deliberately a
// touch broad: a false positive costs one advisory warning, a false negative
// costs a prospect. Reply drafters (rise_reply_draft_v1, warm_reply_auto_v1)
// carry none of these tokens and are unaffected.
const FOLLOW_UP_MODEL = /stall_bump|_bump_|bump_v|_followup|follow_up/i

export function isFollowUp(m: InboxMessage): boolean {
  return FOLLOW_UP_MODEL.test(m.ai_model ?? '')
}

// Is this draft parked right now? Two conditions, and the second is the reason
// snoozed_at is stored at all:
//   1. the target time has not arrived, and
//   2. nothing inbound has landed since the push was set.
// (2) is what makes a push safe to give a prospect who said "I'm travelling":
// the moment they actually write back the park is void, the draft returns and
// the thread goes back to owing an answer. No cron, no wake-up job — the
// condition is evaluated on every read.
export function snoozeActive(m: InboxMessage, lastInbound: string | null, now: number = Date.now()): boolean {
  if (!m.snoozed_until) return false
  if (Date.parse(m.snoozed_until) <= now) return false
  if (m.snoozed_at !== null && lastInbound !== null && lastInbound > m.snoozed_at) return false
  return true
}

// A historical insert-loop left hundreds of phantom rows: the same message to
// the same prospect, identical text, stamped at the exact same millisecond
// (e.g. 587 copies of one June-13 DM to Brian Gerstner). They are not real
// separate sends, so collapse them anywhere messages are shown. Two genuinely
// distinct sends never share prospect+text+timestamp to the millisecond, so
// this never eats a real message.
export function dedupeMessages(rows: InboxMessage[]): InboxMessage[] {
  // Dispatch stores a multi-bubble send as one row; sync sees each LinkedIn bubble.
  // Match whole bubbles in the same chat near the send, independent of fetch order.
  const splitSends = new Map<string, number[]>()
  const bubbleKey = (m: InboxMessage, text: string) => JSON.stringify([m.prospect_id, m.unipile_chat_id, text.replace(/\s+/g, ' ').trim()])
  for (const m of rows) {
    if (m.direction !== 'outbound' || m.ai_model === 'manual_mirror' || m.channel !== 'linkedin' || !m.sent_at || !m.unipile_chat_id || !['dm', 'manual_reply'].includes(m.message_type ?? '')) continue
    const parts = m.message_text.split(/^[ \t]*-{3,}[ \t\r]*$/m).map(p => p.trim()).filter(Boolean)
    if (parts.length < 2) continue
    for (const part of parts) {
      const key = bubbleKey(m, part)
      splitSends.set(key, [...(splitSends.get(key) ?? []), Date.parse(m.sent_at)])
    }
  }
  const mirrorTimes = new Map<string, number[]>()
  for (const m of rows) {
    if (m.direction !== 'outbound' || m.ai_model !== 'manual_mirror' || m.channel !== 'linkedin' || !m.sent_at || !m.unipile_chat_id) continue
    const key = bubbleKey(m, m.message_text)
    mirrorTimes.set(key, [...(mirrorTimes.get(key) ?? []), Date.parse(m.sent_at)])
  }
  const seen = new Set<string>()
  const native = new Map<string, number>()
  const out: InboxMessage[] = []
  for (const m of rows) {
    if (m.direction === 'outbound' && m.ai_model === 'manual_mirror' && m.channel === 'linkedin' && m.sent_at && m.unipile_chat_id
      && splitSends.get(bubbleKey(m, m.message_text))?.some(at => {
        const time = Date.parse(m.sent_at!)
        // Keep earlier messages and ambiguous repeated manual replies visible.
        return time >= at && time - at <= 120_000
          && mirrorTimes.get(bubbleKey(m, m.message_text))?.filter(t => t >= at && t - at <= 120_000).length === 1
      })) continue
    // One provider message can arrive as both the sent InMail and a body-only sync mirror.
    const nativeKey = m.sent_at && m.unipile_message_id ? `${m.prospect_id}|${m.direction}|${m.unipile_chat_id}|${m.unipile_message_id}` : null
    // The view omits provider IDs; its InMail sync mirror still has the exact timestamp and body.
    const mirrorBody = String(m.message_text ?? '').replace(/^Subject:[^\n]*\r?\n(?:\r?\n)?/i, '').trim()
    const mirrorKey = m.sent_at && mirrorBody && (m.message_type === 'inmail' || m.ai_model === 'manual_mirror')
      ? `inmail:${m.prospect_id}|${m.direction}|${m.sent_at}|${mirrorBody}` : null
    const index = (nativeKey ? native.get(nativeKey) : undefined) ?? (mirrorKey ? native.get(mirrorKey) : undefined)
    if (index !== undefined) {
      if (out[index].ai_model === 'manual_mirror' && m.ai_model !== 'manual_mirror') out[index] = m
      continue
    }
    const key = `${m.prospect_id}|${m.direction}|${m.sent_at ?? m.created_at}|${m.message_text}`
    if (seen.has(key)) continue
    seen.add(key)
    if (nativeKey) native.set(nativeKey, out.length)
    if (mirrorKey) native.set(mirrorKey, out.length)
    out.push(m)
  }
  return out
}

// When the message actually happened, as opposed to when we stored it. A reply captured
// late (backfilled by the detector hours or days after the person wrote it) has a created_at
// far newer than its sent_at, so ordering by created_at renders it below messages it in fact
// preceded. Unsent drafts have no sent_at, so they fall back to created_at and sort last,
// which is what we want for a pending draft.
// 2026-09-28 (Ivan: "I respond at midnight and it shows I replied at 4 pm"): a reply approved but not
// yet picked up by the sender is timed at the approval, never at the hour its draft was written.
export const eventTime = (m: InboxMessage): string => m.sent_at ?? (m.direction === 'outbound' && m.approved_at ? m.approved_at : null) ?? m.created_at

/* ==========================================================================
   A HELD ROW SITS AT ITS HOLD (Ivan 2026-10-21, Leighton Penrose: "it deleted
   it and put the old one in draft"). He pressed Send anyway at 15:19, the sender
   held it again at 15:20 and cleared the approval, and the bubble jumped back to
   the row's creation time (Mon 12 Oct 13:48), pixel for pixel the old held card.

   THE RULE: in the conversation a held row is placed and timed at send_blocked_at,
   the moment it was stopped, and says when he sent it (heldAgainLine). Only the
   timeline moves: eventTime keeps ordering threads, drafts and staleness.
   ========================================================================== */
export function timelineTime(m: InboxMessage): string {
  return (isHeldSend(m) || isUnreachableSend(m)) && m.send_blocked_at ? m.send_blocked_at : eventTime(m)
}

type OperatorEvidence = {
  operator_send_anyways?: { approved_at?: string | null; previous_approval?: { approved_at?: string | null } | null } | null
  operator_copy_approval?: { text?: string | null; approved_at?: string | null } | null
  operator_edits?: unknown[] | null
}
const evidenceOf = (m: Pick<InboxMessage, 'draft_evidence'>) => (m.draft_evidence ?? null) as (DraftEvidence & OperatorEvidence) | null
const validAt = (at: unknown): at is string => typeof at === 'string' && Number.isFinite(Date.parse(at))

/** When he last pressed Send (approve, Send anyway, a hand reply, a schedule) on this row, if that came
 *  before the hold: the row was stopped after he sent it. */
export function operatorSentAt(m: InboxMessage): { at: string; scheduled: boolean } | null {
  if (!m.send_blocked_at) return null
  const held = Date.parse(m.send_blocked_at)
  const ev = evidenceOf(m)
  const sched = ev?.scheduled_send?.at
  const pressed = [
    ...[ev?.operator_send_anyways?.approved_at, ev?.operator_send_anyways?.previous_approval?.approved_at, ev?.operator_copy_approval?.approved_at,
      m.message_type === 'manual_reply' && !validAt(sched) ? m.created_at : null].filter(validAt).map(at => ({ at, scheduled: false })),
    ...(validAt(sched) ? [{ at: sched, scheduled: true }] : []),
  ].filter(p => Date.parse(p.at) <= held)
  return pressed.sort((a, b) => Date.parse(a.at) - Date.parse(b.at)).at(-1) ?? null
}

/** The words on screen are his: a hand reply, or text he edited and approved (not the drafter's text as
 *  written). 'approved': the drafter's words, approved by him as they were. Null: never approved. */
export function operatorWords(m: InboxMessage): 'own' | 'approved' | null {
  if (m.message_type === 'manual_reply' || /^inbox_scheduled_manual/.test(m.ai_model ?? '')) return 'own'
  const ev = evidenceOf(m)
  if (ev?.operator_edits?.length) return 'own'
  const ca = ev?.operator_copy_approval
  if (!ca || (ca.text ?? null) !== m.message_text) return null
  return typeof ev?.generated_text === 'string' && ev.generated_text === m.message_text ? 'approved' : 'own'
}

/* ==========================================================================
   PENDING SENDS IN THE TIMELINE (Ivan 2026-10-19, SwishDM / George at BUFFS:
   "this looks weird wtf").

   A SwishDM DM1 is approved with the invite (approved_at 16:07) but only goes
   out after the invite is accepted. eventTime() timed it at the approval, so it
   sat ABOVE the invite (sent 16:15), wore a sent bubble and a time that was never
   a send time. Its sent_at was a true null, not the now() column default.

   THE RULE: a sent item sits in true send order; anything approved and not sent
   (waiting for an accept, queued for the sender) renders AFTER every sent item,
   dimmed, and carries no clock unless a real scheduled time exists. The signal is
   the row's own fields (outbound, sent_at null, approved_at set, no block, not an
   intentional stop), never a stage guess. Unapproved drafts are not history.
   ========================================================================== */
export function isPendingSend(m: Pick<InboxMessage, 'direction' | 'sent_at' | 'approved_at' | 'send_blocked_at' | 'send_blocked_reason' | 'draft_evidence'>): boolean {
  return m.direction === 'outbound' && !m.sent_at && Boolean(m.approved_at) && !m.send_blocked_at && !isIntentionalStop(m)
}

/** The only honest clock on a pending send: the time it was scheduled for, when the row carries one. */
export function pendingSendTime(m: Pick<InboxMessage, 'draft_evidence'>): string | null {
  const at: unknown = m.draft_evidence?.scheduled_send?.at
  return typeof at === 'string' && Number.isFinite(Date.parse(at)) ? at : null
}

/** The clock a timeline bubble shows: its send time; null for a pending send with no scheduled time. */
export function shownTime(m: InboxMessage): string | null {
  return isPendingSend(m) ? pendingSendTime(m) : eventTime(m)
}

/** Sent items in their given (send) order, then every pending send, oldest approval first. */
export function sentThenPending<T extends InboxMessage>(rows: readonly T[]): T[] {
  const sent = rows.filter(m => !isPendingSend(m))
  const pending = rows.filter(isPendingSend).sort((a, b) => (a.approved_at ?? a.created_at).localeCompare(b.approved_at ?? b.created_at))
  return [...sent, ...pending]
}

/** The line under a pending bubble: what it is waiting for. */
export function pendingSendLabel(m: InboxMessage): string {
  const wait = swishdmDm1Wait(m)
  if (wait === 'Waiting for accept') return 'Sends after they accept'
  if (wait === 'Waiting for invite') return 'Sends after the invite is accepted'
  if (pendingSendTime(m)) return 'Scheduled, not sent yet'
  return 'Queued, not sent yet'
}

// Ivan 2026-09-24: "'Viewed the scan' can trigger the next touch". A pending (not pushed) stall-bump
// draft for someone who opened their scan on 2+ distinct days goes to the top; everything else keeps
// the newest-first order, and the lift ends the moment the draft is sent, discarded or pushed.
// ONE comparator for groupThreads AND browseOrder: browseOrder used to re-sort by recency alone,
// which undid the lift on the default DMs view (2026-09-26 review).
export function scanOpenerLifted(t: Thread): boolean {
  return t.draft !== null && t.draftSnoozedUntil === null && Number(t.draft.draft_evidence?.scan_open_days ?? 0) >= 2
}

// DMs rebuild (blueprint v3): an internal owner question is the first thing on the list. No reply is
// queued behind it until Davorin/Mattan confirm the fact, so every hour it sits is an hour the person
// waits. The automatic-retry hold is not lifted: it clears itself.
export function ownerQuestionLifted(t: Thread): boolean {
  return t.ownerConfirmation != null && t.ownerConfirmation.send_blocked_reason !== 'reply_retry_pending'
}

export function threadOrder(a: Thread, b: Thread): number {
  return Number(ownerQuestionLifted(b)) - Number(ownerQuestionLifted(a))
    || Number(scanOpenerLifted(b)) - Number(scanOpenerLifted(a))
    || eventTime(b.last).localeCompare(eventTime(a.last))
}

export function groupThreads(
  rows: InboxMessage[],
  manualReplyIds: ReadonlySet<string> = new Set(),
  now: number = Date.now(),
): Thread[] {
  const map = new Map<string, InboxMessage[]>()
  for (const m of rows) {
    if (!map.has(m.prospect_id)) map.set(m.prospect_id, [])
    map.get(m.prospect_id)!.push(m)
  }
  const threads: Thread[] = []
  for (const messages of map.values()) {
    messages.sort((a, b) => eventTime(a).localeCompare(eventTime(b)))
    const last = messages[messages.length - 1]
    if ((last.prospect_skip_reason ?? null) === DELETED_REASON) continue
    const latestHold = messages.filter(isInternalConfirmation).at(-1)
    // A newer internal decision invalidates every older leg, including a paired email.
    const drafts = messages.filter(m => isDraft(m) && (!latestHold || eventTime(m) > eventTime(latestHold)))
    const newerOutbound = latestHold && messages.some(m => m.direction === 'outbound'
      && !isInternalConfirmation(m) && eventTime(m) > eventTime(latestHold))
    const ownerConfirmation = latestHold && (isOwnerConfirmation(latestHold) || isReplyRetryPending(latestHold)) && !newerOutbound
      && !CLOSED_STAGES.has(last.prospect_stage) ? latestHold : null
    // Archived prospects are dead lanes (e.g. ~76 April cold-email drafts from
    // a retired campaign) — their leftover drafts don't belong in the queue.
    const newestDraft = last.prospect_stage === 'archived'
      ? null
      : drafts.length ? drafts[drafts.length - 1] : null
    // The other leg, when there is one. See Thread.companionDraft.
    const otherLeg = newestDraft === null
      ? null
      // Different FAMILY, not merely a different messageChannel: an invite and a
      // DM ride the same LinkedIn chat, so pairing them offered "Send both" on
      // what is really a supersede (check3-drafts E1.12).
      : drafts.filter(d => d.id !== newestDraft.id
          && CHANNEL_FAMILY[messageChannel(d)] !== CHANNEL_FAMILY[messageChannel(newestDraft)]).at(-1) ?? null
    // 🔴 WHICH LEG IS THE MAIN BOX. On a pair, the LinkedIn message is the primary
    // and the email rides in the blue box under it (Ivan, 2026-09-04: "the blue
    // thing should be the email like on mattan's case"). Not a cosmetic
    // preference: it is the shape of the RISE mirror, where the row IS the DM and
    // email_mirror_text is the rider, and reading them in that order is how he
    // checks that the DM's promise and the email actually agree. Ordering by
    // created_at put Nitin's email on top because it was inserted a beat later.
    // Only the email is ever demoted; an invite/InMail pair keeps newest-first.
    const [draft, companionDraft] = otherLeg !== null
      && newestDraft !== null && messageChannel(newestDraft) === 'email'
      ? [otherLeg, newestDraft]
      : [newestDraft, otherLeg]
    // Must use the same clock as lastSent below (sent_at). Comparing an inbound created_at
    // against an outbound sent_at is two different clocks, and a backfilled reply then made
    // a live draft look stale.
    // Computed BEFORE the snooze test, which needs it: a reply arriving after
    // the push voids the push.
    const lastInbound = messages.filter(m => m.direction === 'inbound').map(eventTime).sort().at(-1) ?? null
    const lastSent = messages
      .filter(m => m.direction === 'outbound' && m.sent_at)
      .map(m => m.sent_at!).sort().at(-1) ?? null
    // A pushed draft is NOT hidden — it stays on its thread with the date it
    // comes back on. What it loses is the claim on Ivan's attention: the flag
    // below is what drops it out of the badge, out of "Needs you" and out of
    // the Draft-ready list until its time arrives.
    const snoozedUntil = draft !== null && snoozeActive(draft, lastInbound, now)
      ? draft.snoozed_until
      : null
    // What this conversation actually RODE, which a pending draft has not done yet.
    // Nitin's thread ended on an unsent email draft, so `last.channel` read 'email'
    // and switched the composer off ("Email compose lands in v1.1") on a live
    // LinkedIn thread. Judged on sent history; a thread that is only ever a draft
    // (retired April cold-email lane) still falls back to the last row.
    // 2026-09-26: the sender's own MIRROR email row (the copy of a DM it mailed
    // after LinkedIn confirmed) is not the conversation switching channel. Reading
    // it as one turned Ofir Bello's ARCH composer into an EMAIL composer and
    // switched Heather Sloan's RISE composer off. The thread stays LinkedIn unless
    // a real email conversation (their email, or a native email row) happened.
    const lastRode = messages.filter(m => !isDraft(m) && !isInternalConfirmation(m)
      && !isSenderMirrorEmail(m) && !isEngineRetired(m)).at(-1) ?? last
    threads.push({
      prospect_id: last.prospect_id, prospect_name: last.prospect_name,
      prospect_company: last.prospect_company, client_id: last.client_id,
      channel: lastRode.channel, stage: last.prospect_stage, last,
      // Every row of a thread carries the same prospect's url; the newest is as good as any.
      linkedin_url: last.prospect_linkedin_url,
      // The chat id, though, is only on the rows that RODE that chat — the newest message
      // can be a pending draft, which has none. Take the first row that has one.
      chat_provider_id: messages.map(m => m.chat_provider_id).find(Boolean) ?? null,
      unread: messages.filter(m => m.direction === 'inbound' && !m.read_at).length,
      draft, companionDraft, ownerConfirmation,
      // isFollowUp: a nudge is DEFINED by "we spoke last and they went quiet",
      // which is what this test measures — so without the exemption every
      // follow-up draft ever written scores stale. See isFollowUp.
      draftStale: draft !== null && !isFollowUp(draft)
        && lastInbound !== null && lastSent !== null && lastSent > lastInbound,
      draftSnoozedUntil: snoozedUntil,
      needsManualReply: manualReplyIds.has(last.prospect_id),
      spam: (last.prospect_skip_reason ?? null) === SPAM_REASON,
      blacklisted: Boolean(last.prospect_blacklisted),
      lane: last.lane ?? null,
      copyRoute: last.copy_route ?? null,
      campaignLane: last.campaign_lane ?? null,
      messages,
    })
  }
  // Newest CONVERSATION first, by when its last message happened, not when the
  // row was stored. The spam folder made the gap visible: the detector files cold
  // pitches in one sweep, so every filed thread shared a created_at and the list
  // printed Aug 31 above Sep 1 above Sep 2 under headers that read the real day.
  // The day header and the row's age already read eventTime; now the order does too.
  // Ivan 2026-09-24: "'Viewed the scan' can trigger the next touch". A pending (not pushed) stall-bump
  // draft for someone who opened their scan on 2+ distinct days goes to the top; everything else keeps
  // the newest-first order, and the lift ends the moment the draft is sent, discarded or pushed.
  return threads.sort(threadOrder)
}

// The email row `Outreach - Send Messages` inserts after it mails a DM's
// email_mirror_text (or a scan link). It rides along with a LinkedIn DM.
export function isSenderMirrorEmail(m: InboxMessage): boolean {
  return m.channel === 'email' && /(_email_mirror_v1|scan_email_delivery)/.test(m.ai_model ?? '')
}

// Every pending leg of the thread's draft: the main box and, on a pair, the
// other channel's row. EVERY verb (discard, later, bring back, compose, spam,
// delete, swipe, bulk, stale bar) goes through the legs, never t.draft alone.
export function draftLegs(t: Pick<Thread, 'draft' | 'companionDraft'>): InboxMessage[] {
  return [t.draft, t.companionDraft].filter((m): m is InboxMessage => m != null)
}

// What kind of thread this really is, judged by its message mix rather than
// just the last row's channel (an InMail thread often ends in a dm-typed reply).
export function threadKind(t: Thread): 'email' | 'inmail' | 'linkedin' {
  if (t.messages.some(m => m.channel === 'email')) return 'email'
  if (t.messages.some(m => m.message_type === 'inmail' || m.channel === 'linkedin_inmail')) return 'inmail'
  return 'linkedin'
}

// Which channel ONE message actually rode. The thread header answers this for a
// single-channel thread, but a RISE lead now gets a LinkedIn DM *and* an email
// mirror in the same stream, and the reply underneath is answering one of the two
// (Ivan, 2026-08-19: "hard to see which one is email which one dm... its a bit
// confuse if their last msg is responding to our email or to the dm"). Live check
// on George Gazzard: his question landed 20 minutes after our email as
// channel='linkedin' — a DM, not an email reply. Nothing in the thread said so.
export type MsgChannel = 'email' | 'inmail' | 'dm' | 'invite'

export function messageChannel(m: InboxMessage): MsgChannel {
  if (m.channel === 'email') return 'email'
  if (m.message_type === 'connection_note') return 'invite'
  if (m.message_type === 'inmail' || m.channel === 'linkedin_inmail') return 'inmail'
  return 'dm'
}

// An invite and a DM both arrive in the same LinkedIn chat, so a thread carrying
// both is NOT mixed — there is nothing to disambiguate. Only a real second surface
// (email, or an InMail that opened a separate LinkedIn conversation) is.
export const CHANNEL_FAMILY: Record<MsgChannel, 'email' | 'inmail' | 'linkedin'> = {
  email: 'email', inmail: 'inmail', dm: 'linkedin', invite: 'linkedin',
}

export function channelFamilies(ms: InboxMessage[]): ('email' | 'inmail' | 'linkedin')[] {
  const seen = new Set(ms.map(m => CHANNEL_FAMILY[messageChannel(m)]))
  return (['linkedin', 'inmail', 'email'] as const).filter(f => seen.has(f))
}

export function isMixedChannel(ms: InboxMessage[]): boolean {
  return channelFamilies(ms).length > 1
}

// A thread is a CONVERSATION only if the other person exists in it (or the
// system says they do): real inbound, a pending draft to approve, or the reply
// detector's needs_manual_reply flag. Everything else is a send echo — we
// wrote, they never did — and lives in Sends, not here.
//
// DIAGNOSIS, live DB 2026-08-03 (inbox_messages_v, read-only), which is why
// this predicate replaced the old "hide only stage=connection_sent" rule:
//   2,220 rows -> 1,413 threads. Direction: 2,062 outbound / 158 inbound.
//   Outbound mix: 1,333 connection_note · 407 dm · 223 inmail · 97 email.
//   Old rule showed 1,169 threads, of which 1,072 (91.7%) were OUTBOUND-ONLY
//   send echoes — Ivan's "it just seems to be logs from sends".
//   Real conversations: 97 threads with inbound + 38 flagged-only + 0 drafts
//   = 135. The Eric Osman connection_sent case (117 invites in the void) is a
//   strict subset of what this hides.
// 2026-08-03, second pass: `needsManualReply` LEFT this predicate. Measured on
// the live DB, the flag does not mean what its name says — of 52 flagged
// prospects only FIVE have a single inbound message between them (risedtc 1/14,
// ivan 4/38); the rest sit at `enriched` / `inmail_ready` / `dm_sent` with
// reply_count 0. Something upstream uses the column for "a human has to act",
// not "a human wrote back". Admitting 38 of those into the DM list is what kept
// putting rows there with nothing to reply to.
// A lead-magnet delivery: the comment gate DM'd them the resource they asked for
// by commenting the keyword. Written by the gate handler with ai_model='lm_gate_v1'.
// These are outbound-only until the person writes back, so the send-echo rule below
// hid every one of them (Ivan, 2026-08-15: "i dont see them on inbox history").
// They are exempt because the person DID initiate — they commented first — which is
// exactly the thing the echo rule is trying to require.
export function isLeadMagnet(t: Thread): boolean {
  return t.messages.some(m => m.ai_model === 'lm_gate_v1')
}

// Exported for lib/filterTokens.ts (E2): applyThreadTokens has to apply the two
// rules filterThreads applies BEFORE any token narrows, or a chip shortcut
// stops selecting the rows its chip did.
export function isConversation(t: Thread): boolean {
  return Boolean(t.ownerConfirmation) || t.draft !== null || t.messages.some(m => m.direction === 'inbound' || m.ai_model === 'arch_referral_package_v1' || m.ai_model?.startsWith('swishdm_referral_v1')) || isLeadMagnet(t)
}

// Nobody has answered their last message: unread inbound exists and no real
// outbound send is newer than it. Same two clocks as draftStale (eventTime for
// inbound, sent_at for sends) — mixing them is the backfilled-reply bug.
//
// Diagnosis (2026-08-03): 56 threads carried unread inbound — THAT was the 56
// on the bubble — but in 28 of them a later outbound already answered it
// (replied in the LinkedIn app; the mirror writes the outbound row, nothing
// stamps read_at). Genuinely unanswered: 28 (17 replied / 9 archived /
// 2 skipped — archived stays counted: a real reply never read is real).
// THE rule, restated 2026-08-03: the ball is with Ivan when THEIR message is the
// last one in the thread. Unread is no longer part of it.
//
// The unread test was hiding real work on Mattan's seat, where all 22 inbound
// messages carry a read_at (he reads them in the LinkedIn app) — every genuinely
// unanswered reply there would have scored zero. Reading a message is not
// answering it. What answers it is a send that comes after it, which is exactly
// what this compares.
// ...but "their message is last" is not the same as "Ivan owes a reply", and the
// gap between those two is 43 rows (measured 2026-08-03, Ivan: "in theory i have
// 0 dms to reply to rn"). What was in there: 11 out-of-office autoreplies, a
// column of explicit noes ("No thanks", "I am retired", "I quit", "please remove
// our details", "never text me again"), LinkedIn reactions rendered as messages
// ("Nico reacted 👍"), sign-offs ("Thanks, you too" · "You're welcome, Ivan"),
// and 15 threads on prospects he had already archived or skipped. Nothing there
// is owed an answer.
//
// 🔴 THE UPSTREAM GAP THIS PAPERS OVER: a prospect who declines stays at
// `prospect_stage='replied'` forever — the engine never closes the conversation.
// Every decline older than the classifier is therefore indistinguishable, in the
// data, from an open thread. The tags below are the classifier's own vocabulary;
// the phrase list only catches what predates it. Fix the stage transition and
// most of this becomes unnecessary.

// The classifier's markers, written into message_text upstream. Same vocabulary
// as the OOO gate — do not invent new spellings here.
const DEAD_TAG = /^\s*\[(ooo_autoreply|negative|negative_optout|unsubscribe|auto_reply)/i
// An out-of-office judged by its WORDS, not its tag. Two of the survivors were
// stamped `[positive]` by the classifier and read "Thank you for your message.
// I'm on holiday until…" — a positive-sounding robot is still a robot.
const OOO_TEXT = /\b(out of (the )?office|on holiday|on annual leave|on leave until|currently away|away from my desk|i am ooo|back in the office)\b/i
// A closing pleasantry: gratitude and nothing else. "Thanks Ivan." ends a
// conversation; "Thanks Ivan, can you send the deck?" does not, which is why
// this only matches when the whole message IS the thank-you.
const SIGNOFF = /^[\s\p{P}]*(many )?(thanks?|thank you|thx|cheers|no worries|you'?re welcome|ok(ay)?|got it|sounds good|will do|appreciate it)[\s\p{P}\p{Extended_Pictographic}]*(ivan|iv[áa]n|mattan|matt)?[\s\p{P}\p{Extended_Pictographic}]*$/iu
// A LinkedIn reaction arrives as a message ("Nico reacted 👍"), and so does a
// bare emoji. Neither is a question.
const REACTION = /^\s*\S+\s+reacted\b|^[\s\p{Extended_Pictographic}\p{Emoji_Presentation}]+$/u
// Declines the classifier never saw. Deliberately narrow: each phrase ends a
// conversation on its own, and a false positive here HIDES a real lead, so
// nothing ambiguous ("maybe later", "busy right now") belongs in this list.
const DECLINE = /\b(no thanks|not interested|i'?m retired|i am retired|i quit|please remove|remove our details|do not (send|contact|text)|never text me again|unsubscribe|not at that stage)\b/i
// A conversation nobody has touched in two weeks is backlog, not an inbox. It
// stays reachable (search, and the 'waiting' bucket) and stops driving a badge
// that is supposed to mean "today".
const STALE_DAYS = 14

// Closed by Ivan's own hand. He archived or skipped these; re-offering them as
// work is the app arguing with him.
export const CLOSED_STAGES = new Set(['archived', 'skipped', 'disqualified', 'unsubscribed', 'blacklisted'])

function isRealReply(m: InboxMessage): boolean {
  const text = (m.message_text ?? '').trim()
  if (!text) return false
  // The detector already judged it a decline: its verdict outranks the phrase list.
  if (m.reply_intent === 'negative') return false
  return !DEAD_TAG.test(text) && !OOO_TEXT.test(text) && !REACTION.test(text)
    && !DECLINE.test(text) && !SIGNOFF.test(text)
}

// 🔴 A REACTION IS A RESPONSE (Ivan, ruled 4+ times, last 2026-09-25: "when he
// reacts, it is basically a response on any kind of fucking line"). Any emoji,
// on any line, on every seat. The drafters already treat it as their turn; the
// badge used to drop it with the sign-offs, so a reaction with no draft yet
// owed nothing here. A reaction the detector judged negative still doesn't.
export function isOwedInbound(m: InboxMessage, needsManualReply = false): boolean {
  if (isRealReply(m)) return true
  if (m.reply_intent === 'negative') return false
  const text = (m.message_text ?? '').trim()
  // Lis Anderson, 2026-09-29: the detector flagged her thank-you while the writer
  // built her plan. Keep that turn visible until a send or saved no-reply decision.
  return REACTION.test(text) || (needsManualReply && SIGNOFF.test(text))
}

// The core "does this thread owe a reply" test, with no staleness cutoff.
// Extracted so needsAnswer (the badge/list predicate, which DOES cut off at
// STALE_DAYS so the badge does not ring forever on something that will never
// be answered) and unansweredWaitSince (Today's work queue, which wants
// exactly the old ones the badge hides) share one definition of "waiting" and
// cannot drift apart. Returns the inbound message's own timestamp, the
// moment the wait began, or null when the thread does not owe a reply at all.
function unansweredSince(t: Thread): string | null {
  if (CLOSED_STAGES.has(t.stage) || t.blacklisted) return null
  // PUSHING A DRAFT IS AN ANSWER TO "does this need a reply TODAY" — the same
  // move as the discard rule below, with a return date on it. Ivan read the
  // thread, the person said they were travelling, and he said "not yet". A
  // thread that kept ringing the badge after that would be the app arguing with
  // him. It rings again the moment the push expires, and instantly if they
  // write back (which voids draftSnoozedUntil in groupThreads).
  if (t.draftSnoozedUntil !== null) return null
  const lastInbound = t.messages.filter(m => m.direction === 'inbound' && isOwedInbound(m, t.needsManualReply))
    .map(eventTime).sort().at(-1) ?? null
  if (t.ownerConfirmation) {
    const heldAt = eventTime(t.ownerConfirmation)
    if (isSettledBySolve(t.solvedAt, heldAt) && (lastInbound === null || isSettledBySolve(t.solvedAt, lastInbound))) return null
    return lastInbound !== null && Date.parse(lastInbound) > Date.parse(heldAt) ? lastInbound : heldAt
  }
  if (lastInbound === null) return null
  // MARK AS SOLVED (2026-09-27) is the same kind of ruling, made by hand with no draft needed.
  if (isSettledBySolve(t.solvedAt, lastInbound)) return null
  // DISCARDING A DRAFT IS AN ANSWER TO THE QUESTION "does this need a reply".
  // Gabriel Amarazeanu (2026-08-03): Mattan replied on LinkedIn by hand and
  // binned the drafted reply, so the thread's newest outbound row is a discard
  // and the mirror never captured his manual send. Ivan: "gabriel was handled
  // manually by mattan as you can see". A human already ruled on this thread;
  // re-listing it is the app overruling him.
  // The writer's own "no reply is needed" ruling (model_meta_no_reply /
  // writer_no_reply, 2026-09-25: reactions to OUR sign-off, Michal Mroz and
  // Saskia von Stamm) is the same kind of decision, made by the drafter.
  const discarded = t.messages
    .filter(m => m.direction === 'outbound' && !m.sent_at
      // "Discard, I'll reply myself" (decision 12) threw the draft away WITHOUT answering the
      // question, so the reply is still owed and the thread stays under Needs your reply.
      && !(m.send_blocked_reason === DISCARD_REASON && m.discard_mode === REPLY_MYSELF)
      && (m.send_blocked_reason === DISCARD_REASON || /^(model_meta_no_reply|writer_no_reply)/.test(m.send_blocked_reason ?? '')))
    .map(eventTime).sort().at(-1) ?? null
  if (discarded !== null && discarded > lastInbound) return null
  // APPROVED IS ANSWERED (Ivan 2026-10-08: "when i approve something it takes a while to leave
  // needs you"). An approved reply waiting in the dispatcher queue (approved_at, no sent_at, no
  // block) is Ivan's answer; the thread leaves Needs you at the approval, not at the send minutes
  // later. A queued send that then fails gets send_blocked_at and the thread owes a reply again.
  const lastSent = t.messages
    .filter(m => m.direction === 'outbound' && (m.sent_at || (m.approved_at && !m.send_blocked_at)))
    .map(m => m.sent_at ?? m.approved_at!)
    // As instants: a just-approved local patch ('Z') and PostgREST ('+00:00') do not sort alike as text.
    .reduce<string | null>((max, x) => (max === null || Date.parse(x) > Date.parse(max) ? x : max), null)
  return (lastSent === null || Date.parse(lastSent) <= Date.parse(lastInbound)) ? lastInbound : null
}

/** solved_at settles the thread while it is not older than the last owed inbound. Compared as
 *  instants: PostgREST ('+00:00') and client ISO ('Z') strings do not sort alike. */
export function isSettledBySolve(solvedAt: string | null | undefined, lastOwedInbound: string): boolean {
  if (!solvedAt) return false
  const s = Date.parse(solvedAt), i = Date.parse(lastOwedInbound)
  return !Number.isNaN(s) && !Number.isNaN(i) && s >= i
}

export function needsAnswer(t: Thread, now: number = Date.now()): boolean {
  const since = unansweredSince(t)
  return since !== null && (Boolean(t.ownerConfirmation) || now - Date.parse(since) <= STALE_DAYS * 86_400_000)
}

// Same "does this owe a reply" test as needsAnswer, but with no STALE_DAYS
// cutoff. Today's work queue (workQueue.ts) wants exactly the threads
// needsAnswer stops counting past 14 days, because those are the oldest and
// most neglected ones in the whole app (median 22.9 days, oldest 133.6 days,
// measured usage-evidence.md 2.7). Returns when the wait started, or null
// when the thread does not owe a reply.
export function unansweredWaitSince(t: Thread): string | null {
  return unansweredSince(t)
}

// What is genuinely waiting on Ivan, as non-overlapping buckets (each thread
// counts once, priority answer > approve > flagged) so the badge is exactly
// their sum and the InboxHead breakdown can never disagree with it.
//
// Live values at diagnosis time: answer 28 · approve 0 · flagged 43 -> badge
// 71, versus the old badge's 56 (raw unread-thread count, half of it already
// handled). Bigger where it is honest, smaller where it was noise.
export type InboxBreakdown = { answer: number; approve: number; flagged: number; waiting: number }

export type ThreadBucket = keyof InboxBreakdown

// The single place a conversation is assigned its bucket. The breakdown bar, the
// badge and (since the Inbox job was removed) the DMs status filter all read
// THIS — so the bar Ivan clicks and the list he gets back cannot disagree, which
// was the failure mode the old raw-unread badge had.
export function threadBucket(t: Thread, now: number = Date.now()): ThreadBucket {
  if (needsAnswer(t, now)) return 'answer'
  // A pushed draft is not work waiting on him, so it does not count as one.
  // It stays reachable in 'all' / 'Waiting on them' wearing its return date —
  // parked, never disappeared.
  // A draft nobody approved in STALE_DAYS is backlog on the same clock an
  // unanswered reply is (Fin Dittimi, 2026-09-22: a 12-day-old cold pitch in
  // "Needs your reply"). Still in 'all', still sendable from the thread.
  if (t.draft !== null && t.draftSnoozedUntil === null
      && now - Date.parse(eventTime(t.draft)) <= STALE_DAYS * 86_400_000) return 'approve'
  // 'flagged' is a MARKER now, never a bucket of its own. Live proof it had to
  // stop counting: Nour Siakir Oglou's thread ends with Ivan's own "either way
  // not my lane, all the best" and still rendered as NEEDS REPLY, because a
  // stale detector flag outranked the answer sitting right there. If a thread
  // genuinely owes a reply, needsAnswer above already says so.
  return 'waiting'
}

export function inboxBreakdown(threads: Thread[]): InboxBreakdown {
  const out: InboxBreakdown = { answer: 0, approve: 0, flagged: 0, waiting: 0 }
  for (const t of threads) {
    // A filed cold pitch owes nobody a reply; counting it would ring the badge
    // for exactly the message the folder exists to keep quiet.
    if (!isConversation(t) || t.spam) continue
    out[threadBucket(t)] += 1
  }
  return out
}

// The status axis of the DMs surface. 'needs' is the default view — everything
// waiting on Ivan, which is exactly what the badge counts — and 'all' is the
// escape hatch that still shows the conversations where the ball is with them.
export type Status = 'needs' | 'all' | ThreadBucket

export const STATUS_LABEL: Record<Status, string> = {
  needs: 'Needs you',
  answer: 'To answer',
  approve: 'Draft ready',
  flagged: 'Flagged',
  waiting: 'Waiting on them',
  all: 'All',
}

// 'all' means all PENDING now, never the send side. Ivan, 2026-08-03: "dms
// section doesnt need to show sent stuff only receiveds pending response". The
// 'waiting' rows are conversations he already answered — they live in Sends,
// and a search still reaches them (InboxScreen bypasses this filter when a
// query is typed), so nothing became unreachable.
//
// Checked before cutting, because a starved lane looks identical to a dead one:
// Mattan's seat carries 14 flagged replies and ZERO unread inbound, so on that
// seat `needsAnswer` never fires and the detector's flag is the ONLY thing that
// surfaces a pending reply. 'flagged' therefore has to stay in every pending
// view, on both seats.
// Lead-magnet deliveries ride in 'all' even though the ball is with them: Ivan wants to
// see who asked for a magnet without hunting through Sends. 'needs' stays clean, so the
// badge still counts only work he owes.
export function filterByStatus(threads: Thread[], s: Status): Thread[] {
  if (s === 'needs') return threads.filter(t => threadBucket(t) !== 'waiting')
  if (s === 'all') return threads.filter(t => threadBucket(t) !== 'waiting' || isLeadMagnet(t))
  return threads.filter(t => threadBucket(t) === s)
}

// The DMs browse order. Ivan, 2026-09-21: one recency run mixed the rows that
// owe him a reply with his own sends ("I don't know what is actually pending on
// my response"). Everything the badge counts goes FIRST, drafted or not, then
// the conversations where the ball is with them. Newest first inside each.
// A thread whose newest message is their robot: an out-of-office or an auto-reply (tag or words).
// Nothing to answer, nothing to wait on; it gets its own quiet fold (blueprint v3).
const AUTO_TAG = /^\s*\[(ooo_autoreply|auto_reply)/i
export function isAutoReplyThread(t: Thread): boolean {
  if (t.last.direction !== 'inbound') return false
  const text = (t.last.message_text ?? '').trim()
  return AUTO_TAG.test(text) || OOO_TEXT.test(text)
}

// Owed but past the STALE_DAYS clock: a reply still owed after 14 days, or a draft nobody approved in
// 14 days. The badge already stopped counting them; before the rebuild they were filed under "Sent,
// waiting on them", which says the ball is with the other person when it is with Ivan.
export function isOlderOwed(t: Thread, now: number = Date.now()): boolean {
  if (threadBucket(t, now) !== 'waiting') return false
  const cut = STALE_DAYS * 86_400_000
  const since = unansweredSince(t)
  if (since !== null && now - Date.parse(since) > cut) return true
  return t.draft !== null && t.draftSnoozedUntil === null && now - Date.parse(eventTime(t.draft)) > cut
}

// The browsable DMs list: what needs him, then what waits on them, then two closed folds.
export function browseOrder(threads: Thread[], now: number = Date.now()): {
  pending: Thread[]; rest: Thread[]; older: Thread[]; auto: Thread[]
} {
  const convs = threads.filter(isConversation)
  const pending: Thread[] = [], rest: Thread[] = [], older: Thread[] = [], auto: Thread[] = []
  for (const t of convs) {
    if (threadBucket(t, now) !== 'waiting') pending.push(t)
    else if (isOlderOwed(t, now)) older.push(t)
    else if (isAutoReplyThread(t)) auto.push(t)
    else rest.push(t)
  }
  return { pending: pending.sort(threadOrder), rest: rest.sort(threadOrder), older: older.sort(threadOrder), auto: auto.sort(threadOrder) }
}

// THE badge number. Every surface that says "N waiting in the inbox" derives
// it from here — rail bubble, mobile tab, the All-chip suffix — so they cannot
// drift apart.
export function inboxWaitingCount(threads: Thread[]): number {
  const b = inboxBreakdown(threads)
  return b.answer + b.approve + b.flagged
}

// Free-text search over everything already loaded: person, company, and the
// full message text of the thread ("that guy who mentioned Shopify"). Multiple
// words must ALL match somewhere in the thread, so "shopify agency" narrows.
export function searchThreads(threads: Thread[], query: string): Thread[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return threads
  return threads.filter(t => {
    const hay = [
      t.prospect_name, t.prospect_company ?? '',
      t.messages.map(m => m.message_text).join('\n'),
    ].join('\n').toLowerCase()
    return words.every(w => hay.includes(w))
  })
}

export function filterThreads(threads: Thread[], f: Filter): Thread[] {
  const convos = threads.filter(isConversation)
  // The spam folder is its own lane: a filed pitch appears there and nowhere
  // else, so 'all' stays what he actually reads and the folder stays complete.
  if (f === 'spam') return convos.filter(t => t.spam)
  const live = convos.filter(t => !t.spam)
  if (f === 'all') return live
  if (f === 'email') return live.filter(t => t.channel === 'email')
  return live.filter(t => t.client_id === f)
}

// File a conversation as a cold pitch by hand. Same row the detector's vendor verdict writes
// (closed stage + blacklisted + the marker), so the engine's closedBl catches every later
// message from this person, no reply drafter picks the stage, and the push trigger stays
// quiet. Pending drafts are discarded: a draft answering a pitch is a reply slot spent.
export async function markSpam(t: Thread): Promise<void> {
  const { error } = await supabase.from('outreach_prospects')
    .update({ stage: 'disqualified', blacklisted: true, needs_manual_reply: false,
              skip_reason: SPAM_REASON, updated_at: new Date().toISOString() })
    .eq('id', t.prospect_id)
  if (error) throw error
  await discardLegs(draftLegs(t))
}

// Deletes the conversation from the seat's LinkedIn inbox (Unipile) and closes the
// person for every lane. The edge fn only reports success once a re-read proves the chat
// is gone; pending drafts are discarded so nothing sends into a deleted thread.
export async function deleteThread(t: Thread): Promise<void> {
  const { data: sess } = await supabase.auth.getSession()
  const token = sess.session?.access_token
  if (!token) throw new Error('not signed in')
  const res = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/inbox-delete-thread`,
    {
      method: 'POST',
      headers: {
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prospect_id: t.prospect_id }),
    },
  )
  const out = await res.json().catch(() => ({}))
  if (!res.ok || out?.ok === false) throw new Error(out?.detail ?? out?.error ?? `delete failed (${res.status})`)
  await discardLegs(draftLegs(t))
}

// The way back. Reopens the thread as a reply owed, which is exactly what the detector
// would have written had it judged BUYER, so the reply drafter picks it up on its next pass.
export async function markNotSpam(t: Thread): Promise<void> {
  const { error } = await supabase.from('outreach_prospects')
    .update({ stage: 'replied', blacklisted: false, needs_manual_reply: true,
              skip_reason: null, updated_at: new Date().toISOString() })
    .eq('id', t.prospect_id).eq('skip_reason', SPAM_REASON)
  if (error) throw error
}

/**
 * N3b-2. `knownRows` is how many conversations the caller already has on screen
 * (from the saved copy or the last good read). It exists because a SHORT page
 * and an EMPTY page are not the same event and this loop used to treat them as
 * one: `data.length < page` ends the pagination, which is right for a short
 * page and wrong for a first page of zero on an inbox that had 3,571 threads a
 * moment ago. Zero rows there is not a state the data can be in; it is a proxy,
 * an RLS lapse or a filter fault arriving as a 200, which is the one shape
 * okToCache cannot catch. Thrown rather than returned, so the failure travels
 * the same path a 500 does: the rows stay, the cache is not written, and
 * nothing stamps the screen as checked.
 */
/* R4c · THE PAGES GO OUT TOGETHER (2026-09-12).

   PostgREST caps a single response at 1000 rows regardless of `.limit()`, so
   this view has to be paged; the id tiebreak keeps the pages stable.

   IT USED TO PAGE ONE AT A TIME, AND EVERY SURFACE IN THE APP WAITED FOR IT.
   Measured on a cold profile against a local preview: seven pages, ~850ms each,
   6.1 SECONDS of strictly serial round trips, and `Shell` holds the whole app on
   one skeleton until this resolves (Spine §1.7) — so Today's own reads did not
   even START until 6,643ms, and the morning brief that takes 1.4s landed at
   8.1s. Content, Sales, Ops and Sends paid the same toll for a corpus none of
   them reads.

   Four pages go out at once now. Seven pages is two round trips instead of
   seven, and the last batch is the one that discovers the end. The order is
   unchanged (offsets are pushed in order, inside a batch and across batches),
   and the consistency is slightly BETTER than before rather than worse: every
   page in a batch is issued in the same instant, so there is less wall-clock
   room for an insert to shift the window under it than there was between seven
   sequential requests. `dedupeMessages` still runs on the result. */
/* PERF-COLD · NEWEST PAGE FIRST, NO PAGE PAST THE END (2026-10-08).

   Measured on the live site with a fresh profile: 24.8 s to the first DMs row.
   The view is ~12,000 rows (13 pages, ~1.3 MB each); four pages at a time in
   lockstep batches meant every batch waited for its slowest page (3.3 s - 6.9 s
   under the frame's other cold reads), the newest conversations arrived in the
   LAST batch, and the end was found by three extra pages past it that each
   cost a full read of the view (6.6 s apiece) for zero rows.

   Now:
   - pages are read NEWEST FIRST (created_at desc, id desc). Page 0 alone is the
     last ~3 days, and `onNewest` hands it to the caller the moment it lands so
     a cold screen can paint something while the rest fills in (the rest waits
     for that paint, at most EARLY_PAINT_WAIT_MS). The caller
     decides whether that paint is allowed (useInbox: only over an empty
     screen, never cached, never stamped as a live read);
   - a head count (cheap: ids only, no rows) rides alongside page 0, so exactly
     the pages that exist are asked for; if the last counted page still comes
     back full (rows arrived meanwhile, or the count failed), the read goes on
     one page at a time until a short page, the old end rule;
   - the remaining pages go through a pool of MSG_BATCH (the same load on the
     database as R4c's four at once), a new page starting as each one lands.

   THE RESULT IS THE SAME LIST IN THE SAME ORDER. The desc pages, concatenated
   and reversed, are exactly the old created_at asc, id asc order (id is unique,
   so the order is total). A row inserted mid-read shifts the desc offsets by
   one, which can only repeat a row at a page edge, never skip one; repeated ids
   are dropped before dedupeMessages runs, as before, over the asc rows. */
const MSG_PAGE = 1000
const MSG_BATCH = 4
const MSG_MAX_PAGES = 20
const EARLY_PAINT_WAIT_MS = 2500

export async function fetchMessages(knownRows = 0, onNewest?: (rows: InboxMessage[]) => void | Promise<unknown>): Promise<InboxMessage[]> {
  const read = async (i: number): Promise<InboxMessage[]> => {
    // Keep the first archive page on the original GET view: it remains a
    // directly observable live-history read for clients and existing smoke
    // checks. Priority histories already painted separately. Later pages
    // choose rows before deriving ARCH routes, using the read-only GET RPC.
    if (i > 0) {
      const quick = await supabase.rpc('inbox_phone_messages_page_r2', { p_offset: i * MSG_PAGE, p_limit: MSG_PAGE }, { get: true })
      if (!quick.error) {
        if (!Array.isArray(quick.data)) throw new Error('Could not read the inbox page')
        return quick.data as InboxMessage[]
      }
      if (quick.error.code !== 'PGRST202') throw quick.error
    }
    const { data, error } = await supabase.from('inbox_messages_v')
      .select('*').order('created_at', { ascending: false }).order('id', { ascending: false })
      .range(i * MSG_PAGE, i * MSG_PAGE + MSG_PAGE - 1)
    if (error) throw error
    return (data ?? []) as InboxMessage[]
  }
  // A failed count is not a failed read: it only costs the old discover-the-end behaviour.
  const counted = Promise.resolve(supabase.from('inbox_messages_v').select('id', { count: 'exact', head: true }))
    .then(({ count, error }) => (error || typeof count !== 'number' ? null : count), () => null)
  const pages: InboxMessage[][] = [await read(0)]
  if (pages[0].length === MSG_PAGE) {
    // The early paint goes first: its side probes would otherwise queue behind four heavy pages
    // (measured: 2.9 s instead of 0.4 s on a busy database). Capped, so a probe that never
    // answers can only delay the rest of the read, never stall it.
    const painted = onNewest?.(dedupeMessages([...pages[0]].reverse()))
    if (painted) {
      let timer: ReturnType<typeof setTimeout> | undefined
      await Promise.race([painted, new Promise(r => { timer = setTimeout(r, EARLY_PAINT_WAIT_MS) })]).catch(() => {})
      clearTimeout(timer)
    }
    const total = await counted
    let planned = total === null ? MSG_MAX_PAGES : Math.min(MSG_MAX_PAGES, Math.max(1, Math.ceil(total / MSG_PAGE)))
    let next = 1
    let end = Infinity // the first short page: the end of the view is inside it
    let failed = false // one failed page fails the read: the other workers stop asking
    const worker = async () => {
      while (!failed && next < Math.min(planned, end)) {
        const i = next++
        const rows = await read(i).catch((e: unknown) => { failed = true; throw e })
        pages[i] = rows
        if (rows.length < MSG_PAGE) end = Math.min(end, i)
      }
    }
    await Promise.all(Array.from({ length: MSG_BATCH }, worker))
    // Every counted page came back full: rows arrived since the count. Read on until a short page.
    while (end === Infinity && next < MSG_MAX_PAGES) { planned = next + 1; await worker() }
    pages.length = Math.min(pages.length, end + 1)
  }
  const seen = new Set<string>()
  const all: InboxMessage[] = []
  for (const page of pages) for (const m of page) if (!seen.has(m.id)) { seen.add(m.id); all.push(m) }
  all.reverse()
  if (all.length === 0 && knownRows > 0) throw new Error('The inbox read came back empty')
  return dedupeMessages(all)
}

// The prospects the reply detector flagged as needing a human answer. Read-only,
// tiny (45 rows live on 2026-08-03), and the ONLY way those threads surface at
// all — see the Thread.needsManualReply comment. `.eq(..., true)` on purpose:
// we want exactly the true rows, and NULL means not flagged (`is.false` vs NULL
// traps don't apply to a positive probe).
export async function fetchManualReplyIds(): Promise<Set<string>> {
  const { data, error } = await supabase.from('outreach_prospects')
    .select('id')
    .eq('needs_manual_reply', true)
    .limit(1000)
  if (error) throw error
  return new Set(((data ?? []) as { id: string }[]).map(r => r.id))
}

// Pending drafts whose approval ALSO fires an email (scan deliveries where the
// prospect gave their address in-thread — the RISE drafter stamps recipient_email
// on the draft row, the dispatcher emails the scan after the LinkedIn send).
// The view doesn't expose recipient_email, so this reads the base table directly
// (authed role already reads outreach_prospects the same way). Tiny by
// construction: only unsent, unapproved, unblocked drafts with a stamp.
export type DraftSendVia = 'dm' | 'email' | 'both'

export function draftSendVia(m: Pick<InboxMessage, 'channel' | 'recipient_email' | 'email_mirror_text' | 'ai_model' | 'draft_evidence' | 'send_via'>): DraftSendVia {
  if (m.channel === 'email') return 'email'
  return m.send_via ?? m.draft_evidence?.send_via ?? (m.recipient_email && (m.email_mirror_text || m.ai_model === 'rise_dm2_scan_delivery_v1') ? 'both' : 'dm')
}

export type DraftEmailStamp = { send_via?: DraftSendVia | null; recipient_email: string | null; email_delivery_recipient?: string | null; email_mirror_text: string | null; email_cc?: string[] | null }

// Answerability gate: the drafter answered something rise-company-facts does not cover.
// Same probe shape as the email stamps below (the view doesn't expose context_gap either),
// and the same degrade rule: a failed read only loses the warning, never the inbox.
// chat_url comes from outreach_prospects.linkedin_url — the PROFILE, which is a weaker link
// than this escalation deserves.
//
// 🔴 THE CLAIM THAT USED TO SIT HERE ("no linkedin.com thread URL is derivable, so the
// profile is the only real link we hold") WAS WRONG, and cost a whole shipped pass on
// 2026-08-24 because it was read as a constraint instead of checked. unipile_chat_id is
// indeed a Unipile id, but the chat object BEHIND it carries `provider_id`, LinkedIn's own
// conversation id. db/045 mirrors that map into `unipile_chats`; CopyChatLink builds the
// real thread URL from it. This escalation should move onto the same link — it has not yet.
export type DraftContextGap = { question: string | null; why: string | null; chat_url: string | null }

export type DraftEvidenceFact = { id: string; fact: string; topic: string; at: string; from: string | null }
export type DraftEvidenceExemplar = { they: string | null; reply: string | null; at: string | null; prospect: string | null }
export type DraftEvidence = {
  scheduled_send?: { at: string; timezone: string; state?: string }
  // SwishDM senders (n8n): which seat/lane wrote the row, the DM1 queue state after an accept,
  // and the stop marker a sender leaves when it deliberately did not send.
  client?: string | null
  lane?: string | null
  dm_queue?: { state?: string | null } | null
  stopped?: unknown
  email_subject?: string | null
  email_headers?: Record<string, string> | null
  email_cc?: string[] | null
  email_delivery_recipient?: string | null
  send_via?: DraftSendVia | null
  // Stall Bump (2026-09-24): the prospect opened the scan on this many distinct days and has not
  // replied since. 2+ floats the thread to the top of the list while the draft waits (groupThreads).
  scan_open_days?: number | null
  facts?: { slug: string; version: number | null; updated_at?: string | null } | string[] | null
  retry_after?: string | null
  generated_text?: string | null
  // Mirror email's exact full body (including Subject:), never the DM snapshot.
  email?: EmailMetadata | null
  brief?: {
    they_mean?: string | null; the_move?: string | null; limits_to_name?: string | null; unresolved?: string[] | null
    // The planner's read of whether THIS inbound asked to be contacted again later
    // ("remind me in a few weeks", "back mid October"). A suggestion, never a stamp:
    // the inbox offers the date, the operator sets it. See followUpSuggestion.
    follow_up?: { asked?: boolean | null; when?: string | null; why?: string | null } | null
  } | null
  research?: { hits?: { title?: string | null; url?: string | null }[] | null }[] | null
  learned?: DraftEvidenceFact[] | null
  exemplars?: DraftEvidenceExemplar[] | null
  store_fact?: string | null
  anchor?: string | null
  scan_finding?: string | null
  operator_note?: string | null
}

/** Read only the current displayable draft IDs, including companion and held drafts.
 *  Unordered historical/discarded rows must not crowd them out of a global limit. */
export async function fetchDraftEvidence(draftIds: string[]): Promise<Map<string, DraftEvidence>> {
  const m = new Map<string, DraftEvidence>()
  const ids = [...new Set(draftIds)]
  for (let start = 0; start < ids.length; start += 100) {
    const { data, error } = await supabase.from('outreach_messages')
      .select('id,draft_evidence')
      .in('id', ids.slice(start, start + 100))
    if (error) throw error
    for (const r of (data ?? []) as { id: string; draft_evidence: DraftEvidence | null }[]) {
      if (r.draft_evidence) m.set(r.id, r.draft_evidence)
    }
  }
  return m
}

export async function fetchDraftContextGaps(draftIds: string[]): Promise<Map<string, DraftContextGap>> {
  const rows: { id: string; prospect_id: string; context_gap: { question?: string; why?: string } | null }[] = []
  const ids = Array.from(new Set(draftIds))
  for (let start = 0; start < ids.length; start += 100) {
    const { data, error } = await supabase.from('outreach_messages')
      .select('id,prospect_id,context_gap').in('id', ids.slice(start, start + 100))
    if (error) throw error
    rows.push(...(data ?? []) as typeof rows)
  }
  const m = new Map<string, DraftContextGap>()
  if (!rows.length) return m
  const urls = new Map<string, string | null>()
  const prospectIds = Array.from(new Set(rows.map(r => r.prospect_id)))
  for (let start = 0; start < prospectIds.length; start += 100) {
    const { data: props } = await supabase.from('outreach_prospects')
      .select('id,linkedin_url').in('id', prospectIds.slice(start, start + 100))
    for (const p of (props ?? []) as { id: string; linkedin_url: string | null }[]) urls.set(p.id, p.linkedin_url)
  }
  for (const r of rows) {
    if (!r.context_gap) continue
    m.set(r.id, {
      question: r.context_gap.question ?? null,
      why: r.context_gap.why ?? null,
      chat_url: urls.get(r.prospect_id) ?? null,
    })
  }
  return m
}

/** Who answers a question the notes do not cover, per client seat. Null on Ivan's own seat: there
    is nobody to ask, so the "Ask" control is not drawn. The route itself is decided in SQL by the
    prospect's tenant (db/098); this only words the button. 2026-09-18: every thread said "Mattan"
    and "RISE notes", including Davorin's. */
export function clientOwner(clientId: string): { owner: string; notes: string } | null {
  if (clientId === 'risedtc') return { owner: 'Mattan', notes: 'RISE' }
  if (clientId === 'swishdm') return { owner: 'Jonathan', notes: 'SwishDM' }
  if (clientId === 'arch') return { owner: 'Davorin', notes: 'ARCH' }
  return null
}

export async function escalateDraftToClient(messageId: string): Promise<string> {
  const { data, error } = await supabase.rpc('operator_escalate_rise_draft', {
    p_gate: 'clientops', p_message_id: messageId,
  })
  if (error) throw error
  const r = (data ?? {}) as { ok?: boolean; note?: string; error?: string }
  if (!r.ok) throw new Error(r.error || 'could not queue that')
  return 'Question prepared. Review it in this conversation before sending.'
}

export async function fetchDraftEmailStamps(): Promise<Map<string, DraftEmailStamp>> {
  const { data, error } = await supabase.from('outreach_messages')
    .select('id,recipient_email,email_mirror_text,email_cc:draft_evidence->email_cc,email_delivery_recipient:draft_evidence->>email_delivery_recipient,send_via:draft_evidence->>send_via')
    .eq('direction', 'outbound')
    .is('sent_at', null).is('approved_at', null)
    // A race- or lint-held row is a pending draft again (isDraft), and approving
    // it still mails the mirror. Skipping held rows here dropped its email line
    // and editor while the email still went out (check3-drafts E1.5).
    .or('send_blocked_at.is.null,send_blocked_reason.like.post_approval_race*,send_blocked_reason.like.lint*,and(send_blocked_reason.eq.awaiting_client_review,ai_model.like.swishdm_reply_*)')
    .or('recipient_email.not.is.null,draft_evidence->>email_delivery_recipient.not.is.null')
    .order('created_at', { ascending: false })
    .limit(500)
  if (error) throw error
  const m = new Map<string, DraftEmailStamp>()
  for (const r of (data ?? []) as { id: string; recipient_email: string | null; email_mirror_text: string | null; email_cc?: string[] | null; email_delivery_recipient?: string | null; send_via?: DraftSendVia | null }[]) {
    if (r.recipient_email || r.email_delivery_recipient) m.set(r.id, { recipient_email: r.recipient_email, email_mirror_text: r.email_mirror_text, email_cc: r.email_cc ?? [], email_delivery_recipient: r.email_delivery_recipient, send_via: r.send_via })
  }
  return m
}

// Who a SENT email actually went to. The view carries prospect_email only, so a
// mirror mailed to a colleague (Heather Sloan's went to philip@) printed no
// recipient, or the wrong one. Newest 1000 email rows, enough for every thread
// the list shows.
export async function fetchEmailRecipients(): Promise<Map<string, { recipient_email: string; email_cc: string[] }>> {
  const { data, error } = await supabase.from('outreach_messages')
    .select('id,recipient_email,email_cc:draft_evidence->email_cc')
    .eq('channel', 'email')
    .not('recipient_email', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1000)
  if (error) throw error
  const m = new Map<string, { recipient_email: string; email_cc: string[] }>()
  for (const r of (data ?? []) as { id: string; recipient_email: string | null; email_cc?: string[] }[]) {
    if (r.recipient_email) m.set(r.id, { recipient_email: r.recipient_email, email_cc: r.email_cc ?? [] })
  }
  return m
}

// The chat this thread already lives in on LinkedIn (InMail threads carry it on
// both the sent InMail and the inbound reply). Stamping it on the approved row
// lets the sender append to the existing chat instead of creating a new one —
// creating fails with 422 for non-connections (Anthony + Alex, 2026-07-22).
export function threadChatId(t: Thread): string | null {
  return t.messages.filter(m => m.unipile_chat_id).at(-1)?.unipile_chat_id ?? null
}

// U1: the guard used to be `.is('sent_at', null)` alone, so a stale view could
// re-approve a row Ivan had already discarded — discardDraft only stamps
// send_blocked_reason, and the dispatcher's real predicate is `approved_at NOT
// NULL AND sent_at IS NULL` with no block check at all
// (docs/send-path-verification.md). Any surface showing a cached or aggregated
// draft list makes the replay reachable, so discard is now permanent AT THE
// WRITE, not by UI convention: a stale approve becomes a zero-row no-op instead
// of a message going out.
// A race-held row (send_blocked_reason 'post_approval_race:*') is the one
// blocked state approve accepts: the dispatcher bounced it because the thread
// moved after approval, and re-approving after reading the thread is the whole
// recovery path. Approving clears the block so the row leaves the ops failed
// list and a later bounce starts clean.
export function reviewedEmailMirror(draft: Pick<InboxMessage, 'email_mirror_text'>, editedEmail: string): string | null {
  return draft.email_mirror_text == null ? null : editedEmail
}

export async function approveDraft(id: string, editedText: string, chatId?: string | null,
  snapshot?: Pick<InboxMessage, 'email_mirror_text' | 'recipient_email' | 'email_cc' | 'draft_evidence' | 'send_via'>): Promise<void> {
  const { data: draft, error: readError } = await supabase.from('outreach_messages')
    .select('ai_model,draft_evidence').eq('id', id).single()
  if (readError) throw readError
  if (draft?.ai_model === 'inbox_on_demand_reply') {
    const { error } = await supabase.rpc('approve_inbox_on_demand_reply', {
      p_message_id: id, p_text: editedText, p_chat_id: chatId ?? null,
    })
    if (error) throw error
    return
  }
  // SwishDM reply drafts carry a review hold the shared RPC refuses. This RPC checks the lane, the hold,
  // that the draft still answers their newest message and that a page link was kept, then approves and
  // clears the hold on this ONE row. Publishing the page and sending are separate steps with their own switches.
  if (SWISHDM_REPLY_MODEL.test(draft?.ai_model ?? '')) {
    const { error } = await supabase.rpc('approve_swishdm_reply_draft', {
      p_message_id: id, p_text: editedText, p_expected_evidence: {
        ...draft?.draft_evidence,
        _reviewed_email: { recipient_email: snapshot?.recipient_email ?? null, email_mirror_text: snapshot?.email_mirror_text ?? null },
      },
    })
    if (error) throw error
    return
  }
  if (snapshot && (draft?.draft_evidence?.send_via ?? null) !== (snapshot.send_via ?? snapshot.draft_evidence?.send_via ?? null)) {
    throw new Error('The send channel changed. Refresh before sending.')
  }
  // Research evidence can exceed the proxy's URL limit. The RPC compares it
  // atomically in the request body and records the reviewed copy server-side.
  const { error } = await supabase.rpc('approve_inbox_pipeline_draft', {
    p_message_id: id, p_text: editedText,
    p_expected_evidence: draft?.draft_evidence ?? null, p_chat_id: chatId ?? null,
    p_expected_email_mirror_text: snapshot?.email_mirror_text ?? null,
    p_expected_recipient_email: snapshot?.recipient_email ?? null,
    p_expected_email_subject: snapshot?.draft_evidence?.email_subject ?? null,
    p_expected_email_cc: snapshot?.email_cc ?? snapshot?.draft_evidence?.email_cc ?? null,
    p_expected_send_via: snapshot?.send_via ?? snapshot?.draft_evidence?.send_via ?? null,
  })
  if (error) throw error
}

// The presets on the card. Ivan named "one more week" and "a custom time"; the
// rest bracket the two reasons a DM gets pushed — "back next week" and "not this
// quarter" — without turning a two-tap decision into a menu.
export const SNOOZE_PRESETS: { key: string; label: string; days: number }[] = [
  { key: '3d', label: '3 days', days: 3 },
  { key: '1w', label: '1 week', days: 7 },
  { key: '2w', label: '2 weeks', days: 14 },
  { key: '1mo', label: '1 month', days: 30 },
]

// A preset lands at 08:00 LOCAL on the target day, not at the same clock time
// as the tap. Pushing "1 week" at 23:40 would otherwise bring the draft back at
// 23:40 — technically a week, practically a day late, since he would next see
// it the following morning anyway. An exact time is what the custom picker is for.
export const SNOOZE_HOUR = 8

export function snoozeTarget(days: number, from: Date = new Date()): string {
  const d = new Date(from)
  d.setDate(d.getDate() + days)
  d.setHours(SNOOZE_HOUR, 0, 0, 0)
  // Guard the same-day edge: pushing "3 days" at 04:00 must not resolve to a
  // moment already inside the window it is trying to skip.
  if (d.getTime() <= from.getTime()) d.setDate(d.getDate() + 1)
  return d.toISOString()
}

// Persist an edit WITHOUT approving. Until pushing existed, the only way to
// save edited copy was to approve it, which also sent it — fine when the two
// decisions always happened together, wrong now that a draft can be edited
// today and sent in a fortnight.
export async function saveDraftText(id: string, text: string): Promise<void> {
  const { error } = await supabase.from('outreach_messages')
    .update({ message_text: text })
    .eq('id', id).is('sent_at', null).is('approved_at', null)
    .or(`send_blocked_reason.is.null,send_blocked_reason.like.${RACE_HOLD_PREFIX}*,send_blocked_reason.like.${LINT_HOLD_PREFIX}*,and(send_blocked_reason.eq.${SWISHDM_REPLY_HOLD},ai_model.like.swishdm_reply_*)`)
  if (error) throw error
}

// The email leg was render-only until now (Ivan, 2026-08-26): the DM could be
// fixed in the box while the email that ships alongside it could not, so a bad
// line in the inbox copy could only be fixed by rewriting the row by hand. Same
// guards as saveDraftText — an approved or sent row is not editable, and a stale
// view asking to edit one is a zero-row no-op.
export async function saveDraftEmail(id: string, text: string): Promise<void> {
  const { error } = await supabase.from('outreach_messages')
    .update({ email_mirror_text: text })
    .eq('id', id).is('sent_at', null).is('approved_at', null)
    .or(`send_blocked_reason.is.null,send_blocked_reason.like.${RACE_HOLD_PREFIX}*,send_blocked_reason.like.${LINT_HOLD_PREFIX}*,and(send_blocked_reason.eq.${SWISHDM_REPLY_HOLD},ai_model.like.swishdm_reply_*)`)
  if (error) throw error
}

/** Persist the selected channels while both draft texts remain editable. */
export async function setDraftSendVia(id: string, mode: DraftSendVia): Promise<Pick<InboxMessage, 'recipient_email' | 'email_delivery_recipient' | 'send_via' | 'draft_evidence' | 'email_cc'>> {
  const { data: row, error: readError } = await supabase.from('outreach_messages')
    .select('recipient_email,draft_evidence').eq('id', id).single()
  if (readError) throw readError
  if (!row) throw new Error('The draft changed. Refresh before approving.')
  const { data, error } = await supabase.rpc('set_inbox_draft_send_via', {
    p_message_id: id, p_send_via: mode,
    p_expected_evidence: row.draft_evidence ?? null, p_expected_recipient: row.recipient_email ?? null,
  })
  if (error) throw error
  if (!data) throw new Error('The channel choice was not saved. Refresh and try again.')
  return data
}

/** A saved delivery choice never approves a message or changes its copy. */
export async function setDraftEmailDelivery(id: string, enabled: boolean): Promise<Pick<InboxMessage, 'recipient_email' | 'email_delivery_recipient' | 'draft_evidence' | 'email_cc'>> {
  const { data: row, error: readError } = await supabase.from('outreach_messages')
    .select('recipient_email,draft_evidence').eq('id', id).single()
  if (readError) throw readError
  if (!row) throw new Error('The draft changed. Refresh before approving.')
  const { data, error } = await supabase.rpc('set_inbox_draft_email_delivery', {
    p_message_id: id, p_enabled: enabled,
    p_expected_evidence: row.draft_evidence ?? null, p_expected_recipient: row.recipient_email ?? null,
  })
  if (error) throw error
  if (!data) throw new Error('The email choice was not saved. Refresh and try again.')
  return data
}

/** Preserve evidence and fail closed if the draft or its evidence changed while editing. */
export async function saveDraftEmailCc(id: string, value: unknown): Promise<string[]> {
  const cc = parseEmailCc(value)
  const { data: row, error: readError } = await supabase.from('outreach_messages')
    .select('draft_evidence').eq('id', id).single()
  if (readError) throw readError
  if (!row) throw new Error('The draft changed. Refresh before approving.')
  // Research evidence can exceed the proxy's URL limit. Compare it in the
  // RPC body, just as approval does, while keeping the save atomic.
  const { error } = await supabase.rpc('save_inbox_draft_email_cc', {
    p_message_id: id, p_cc: cc, p_expected_evidence: row.draft_evidence ?? null,
  })
  if (error) throw error
  return cc
}

// Push a pending draft to later. Same staleness guard as approveDraft: a row
// that has already gone out, been approved or been discarded is not pushable,
// and a stale view asking to push one is a zero-row no-op rather than a write
// that resurrects it.
export async function snoozeDraft(id: string, until: string): Promise<void> {
  const { error } = await supabase.from('outreach_messages')
    .update({ snoozed_until: until, snoozed_at: new Date().toISOString() })
    .eq('id', id).is('sent_at', null).is('approved_at', null)
    .or(`send_blocked_reason.is.null,send_blocked_reason.like.${RACE_HOLD_PREFIX}*,send_blocked_reason.like.${LINT_HOLD_PREFIX}*`)
  if (error) throw error
}

/** Bring a pushed draft back now. */
export async function unsnoozeDraft(id: string): Promise<void> {
  const { error } = await supabase.from('outreach_messages')
    .update({ snoozed_until: null, snoozed_at: null })
    .eq('id', id).is('sent_at', null).is('approved_at', null)
    .or(`send_blocked_reason.is.null,send_blocked_reason.like.${RACE_HOLD_PREFIX}*,send_blocked_reason.like.${LINT_HOLD_PREFIX}*`)
  if (error) throw error
}

// ---- discard and restore: the guards, declared once ------------------------
//
// These two writes sit on the send path, so their filters are declared as DATA
// and applied by applyDraftGuard below. The write and its test then read the
// same guard instead of two copies that can drift, which is the only way a
// guard-shape test proves anything about the real query.
//
// 'is' means IS NULL. 'eq' is an exact string match.
export type DraftGuard = { op: 'is'; column: string } | { op: 'eq'; column: string; value: string }

// Discard. `sent_at IS NULL` was always here; `approved_at IS NULL` is the fix
// for a live fail-open. The dispatcher's pickup predicate is `approved_at IS
// NOT NULL AND sent_at IS NULL` with NO filter on the block columns
// (docs/send-path-verification.md, "Poll + Send"), so discarding an APPROVED
// row used to write two columns the dispatcher never reads: the row vanished
// from the inbox and the message still went out. A guarded discard now affects
// zero rows and reports false, so the caller can say the send is already gone
// rather than pretend it was stopped.
//
// This does NOT block the race-hold discard the plan worried about. A
// dispatcher bounce writes `sent_at=null, approved_at=null,
// send_blocked_reason='post_approval_race:*'` (memory
// dispatcher-post-approval-race-guard-2026-08-20; the same shape as the
// preSendGate block quoted in docs/send-path-verification.md), which is why
// isDraft above can return true for a race-held row at all: it requires
// `!m.approved_at`. A race-held row therefore passes `approved_at IS NULL` and
// stays discardable.
export const DISCARD_GUARD: readonly DraftGuard[] = [
  { op: 'is', column: 'sent_at' },
  { op: 'is', column: 'approved_at' },
]

// Restore. Deliberately narrower than "has a block": `send_blocked_at IS NOT
// NULL` would also match `send_failed_verified:*` rows (which may have landed
// on the platform) and `geo_gate_v2:*` rows (still queued upstream), and
// clearing either would be a live defect. Only a row this app discarded, still
// unsent and still unapproved, comes back.
export const RESTORE_GUARD: readonly DraftGuard[] = [
  { op: 'is', column: 'sent_at' },
  { op: 'is', column: 'approved_at' },
  { op: 'eq', column: 'send_blocked_reason', value: DISCARD_REASON },
]

type GuardedQuery<Q> = {
  eq(column: string, value: string): Q
  is(column: string, value: null): Q
}

export function applyDraftGuard<Q extends GuardedQuery<Q>>(
  q: Q, id: string, guard: readonly DraftGuard[],
): Q {
  let out = q.eq('id', id)
  for (const g of guard) out = g.op === 'is' ? out.is(g.column, null) : out.eq(g.column, g.value)
  return out
}

// Both writes below return whether a row was ACTUALLY affected. PostgREST
// reports no error for a zero-row update, so without this a stale view asking
// to discard an already-approved row would look identical to a successful
// discard. A silent no-op on the send path is its own bug.
// Decision 12's marker value (db/216). The reason stays DISCARD_REASON, so no drafter redrafts.
export const REPLY_MYSELF = 'reply_myself'

// Offered only where it means something: a REPLY draft on a thread that owes an answer. A follow-up
// or bump owes nothing, so "I'll reply myself" would leave the thread anyway.
export function offersReplyMyself(t: Thread): boolean {
  return t.draft !== null && !isFollowUp(t.draft) && unansweredSince(t) !== null
}
export type DiscardMode = typeof REPLY_MYSELF | null

export async function discardDraft(id: string, mode: DiscardMode = null): Promise<boolean> {
  const { data, error } = await applyDraftGuard(
    supabase.from('outreach_messages')
      .update({ send_blocked_reason: DISCARD_REASON, send_blocked_at: new Date().toISOString(), discard_mode: mode }),
    id, DISCARD_GUARD,
  ).select('id')
  if (error) throw error
  return (data ?? []).length > 0
}

// Discard every leg of a draft. Each leg is its own row with its own guard, so
// each is tried even when another refuses; what did NOT stop is returned with
// the reason (null = the guard refused it: already approved or sent) and every
// caller says so. The companion's result used to be swallowed (`.catch(() =>
// {})`), so an approved email leg looked discarded while it went out.
export type LegFailure = { leg: InboxMessage; error: string | null }

export async function discardLegs(legs: readonly (InboxMessage | null | undefined)[], mode: DiscardMode = null): Promise<LegFailure[]> {
  const out: LegFailure[] = []
  for (const leg of legs) {
    if (!leg) continue
    try {
      if (!(await discardDraft(leg.id, mode))) out.push({ leg, error: null })
    } catch (e) {
      out.push({ leg, error: e instanceof Error ? e.message : String(e) })
    }
  }
  return out
}

/** One sentence per leg that did not stop, for a banner or a bulk error line. */
export function legFailureText(f: LegFailure): string {
  const what = messageChannel(f.leg) === 'email' ? 'The email' : 'The LinkedIn message'
  return f.error === null
    ? `${what} was already approved and is in the send queue, so the discard did not stop it.`
    : `${what} could not be discarded: ${f.error}`
}

// Retire an internal hold by hand. Søren Gleie (2026-09-22): the drafter hit its
// retry ceiling, wrote "Confirm with Davorin ... write this one by hand", and
// the card's ONLY verb was "add a note" — a question Ivan had already answered
// (the "no" was a no) kept the thread in "Needs your reply" with nothing to
// press. The hold is retired the same way the drafter retires its own
// superseded holds, so every reader that already hides
// `owner_confirmation_superseded` (bubbles, the failed-send log, sends.ts)
// hides this one too. It is NOT a discard: a restored hold would come back as
// an empty draft, so it never wears the discard reason.
export const DISMISS_HOLD_GUARD: readonly DraftGuard[] = [
  { op: 'is', column: 'sent_at' },
  { op: 'is', column: 'approved_at' },
  { op: 'eq', column: 'send_blocked_reason', value: 'owner_confirmation' },
]

export async function dismissConfirmation(id: string, reason: 'owner_confirmation' | 'reply_retry_pending' = 'owner_confirmation', at = new Date().toISOString()): Promise<boolean> {
  const { data, error } = await applyDraftGuard(
    supabase.from('outreach_messages')
      .update({ send_blocked_reason: 'owner_confirmation_superseded', send_blocked_at: at }),
    id, reason === 'owner_confirmation' ? DISMISS_HOLD_GUARD : [
      { op: 'is', column: 'sent_at' }, { op: 'is', column: 'approved_at' },
      { op: 'eq', column: 'send_blocked_reason', value: 'reply_retry_pending' },
    ],
  ).select('id')
  if (error) throw error
  return (data ?? []).length > 0
}

/** Undo only the specific internal hold retired by Mark as solved. */
export async function restoreConfirmation(id: string, reason: 'owner_confirmation' | 'reply_retry_pending', retiredAt: string, previousAt: string | null): Promise<boolean> {
  const { data, error } = await applyDraftGuard(
    supabase.from('outreach_messages').update({ send_blocked_reason: reason, send_blocked_at: previousAt }),
    id, [
      { op: 'is', column: 'sent_at' }, { op: 'is', column: 'approved_at' },
      { op: 'eq', column: 'send_blocked_reason', value: 'owner_confirmation_superseded' },
      { op: 'eq', column: 'send_blocked_at', value: retiredAt },
    ],
  ).select('id')
  if (error) throw error
  return (data ?? []).length > 0
}

// Undo a discard. The write clears the two block columns and NOTHING else, so
// the row lands back in exactly the state isDraft describes (outbound, unsent,
// unapproved, unblocked) and re-enters the pending queue as a draft.
//
// It never writes approved_at, and it only matches rows where approved_at is
// already NULL, so a restored row cannot be picked up by the dispatcher: its
// predicate needs `approved_at IS NOT NULL`. Sending still takes a separate,
// explicit approve. Full trace:
// goal-runs/workbench-2026-plan-2026-08-21/phase4a-restore.md
export async function restoreDraft(id: string, prospectId?: string): Promise<boolean> {
  // Quick Undo can outlive another reply. Check current outbound history before reviving this row.
  if (prospectId) {
    const { data, error } = await supabase.from('outreach_messages').select('*')
      .eq('prospect_id', prospectId).eq('direction', 'outbound')
    if (error) throw error
    const messages = (data ?? []) as InboxMessage[]
    const row = messages.find(m => m.id === id)
    if (!row || !canRestore({ messages }, row)) return false
  }
  // A SwishDM reply keeps its review hold when it comes back (the shared drafters and the WhatsApp reminder
  // key on send_blocked_at IS NULL). Only the reply writer's rows; every other draft is restored as before.
  const { data: kind } = await supabase.from('outreach_messages').select('ai_model').eq('id', id).maybeSingle()
  const swish = SWISHDM_REPLY_MODEL.test((kind as { ai_model?: string | null } | null)?.ai_model ?? '')
  const { data, error } = await applyDraftGuard(
    supabase.from('outreach_messages')
      .update(swish
        ? { send_blocked_reason: SWISHDM_REPLY_HOLD, send_blocked_at: new Date().toISOString(), discard_mode: null }
        : { send_blocked_reason: null, send_blocked_at: null, discard_mode: null }),
    id, RESTORE_GUARD,
  ).select('id')
  if (error) throw error
  return (data ?? []).length > 0
}

// A row THIS app discarded, as opposed to any other reason the send path
// blocked it. The state test restoreDraft's guard makes in SQL.
export function isDiscarded(m: InboxMessage): boolean {
  return m.direction === 'outbound' && !m.sent_at && !m.approved_at
    && m.send_blocked_reason === DISCARD_REASON && m.send_blocked_at !== null
}

// May this discard be offered back? Only when it is still the newest outbound
// event on its thread.
//
// 🔴 WHY THE FRESHNESS TEST IS LOAD-BEARING: composeReply discards the pending
// AI draft the moment Ivan hand-types his own reply. That discarded draft
// answers a message a human has ALREADY answered, so restoring and approving it
// would send a second reply to a real person. Any outbound row newer than the
// discard means someone spoke after the ruling, whether that row was sent, is
// still pending or is approved and waiting in the queue.
//
// Restoring also reverses the ruling encoded in needsAnswer above (a discard
// newer than the last inbound suppresses the thread, because a human already
// decided this one needed no reply). The thread re-enters the answer bucket.
// That is correct and it is exactly why restore has to be an explicit act.
//
// 🔴 SECOND HAZARD, not in the plan: composeReply INSERTS the hand-typed reply
// (approved_at stamped, sent_at null) and only THEN discards the draft, so for
// the couple of minutes before the dispatcher picks it up the human answer is
// OLDER than the discard and the time test above would wave the restore
// through. An approved unsent outbound row IS the dispatcher's queue
// (docs/send-path-verification.md), so any row in that state on this thread
// holds the restore regardless of ordering.
//
// Timestamps are parsed rather than string-compared: send_blocked_at is written
// by this app as an ISO Z string while sent_at comes back from PostgREST with a
// +00:00 offset, and those two spellings only sort correctly by luck. Anything
// unparseable holds the restore rather than allowing it.
export function canRestore(t: Pick<Thread, 'messages'>, m: InboxMessage): boolean {
  const at = m.send_blocked_at
  if (at === null || !isDiscarded(m)) return false
  const blockedAt = Date.parse(at)
  if (Number.isNaN(blockedAt)) return false
  if (t.messages.some(o => o.direction === 'outbound' && !o.sent_at && o.approved_at !== null)) return false
  return !t.messages.some(o => {
    if (o.id === m.id || o.direction !== 'outbound') return false
    const when = Date.parse(eventTime(o))
    return Number.isNaN(when) || when > blockedAt
  })
}

type ConversationAgentRpcError = { code?: unknown; message?: unknown; status?: unknown }

function missingConversationAgentRpc(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const e = error as ConversationAgentRpcError
  return e.code === 'PGRST202' || (e.status === 404 && typeof e.message === 'string' && e.message.includes('conversation_agent_'))
}

/** The compatibility exception is deliberately narrow: both the takeover RPC
    and the read feed must be absent. If cards exist but takeover does not, the
    migration is partial and a manual send cannot prove it owns the thread. */
export function missingManualGuardMeansPreMigration(beforeError: unknown, cardsError: unknown): boolean {
  return missingConversationAgentRpc(beforeError) && missingConversationAgentRpc(cardsError)
}

async function takeOwnershipBeforeManualReply(prospectId: string): Promise<number | null> {
  const guarded = await supabase.rpc('conversation_agent_before_manual_send', { p_prospect_id: prospectId })
  if (guarded.error) {
    if (missingConversationAgentRpc(guarded.error)) {
      const readiness = await supabase.rpc('conversation_agent_cards')
      if (missingManualGuardMeansPreMigration(guarded.error, readiness.error)) return null
    }
    throw new Error('Conversation ownership could not be verified. The manual reply was not queued.')
  }
  const result = (guarded.data ?? {}) as { ok?: boolean; allow_send?: boolean; reason?: string; in_flight?: boolean; revision?: number }
  if (!result.ok || !result.allow_send) {
    throw new Error(`Manual reply blocked: ${(result.reason ?? 'ownership_unverified').replaceAll('_', ' ')}.`)
  }
  if (result.in_flight) {
    throw new Error('An agent message is already in flight. Wait for delivery reconciliation before replying.')
  }
  return result.revision ?? null
}

// ARCH email threads (madebyarch.com inbound, 2026-09-24) can be answered from the composer.
// Other clients' email threads stay draft-approval only.
export function canComposeEmail(t: Thread): boolean {
  return t.client_id === 'arch'
}

export type EmailReplyTarget = { recipient_email: string; message_text_prefix: string; email_headers?: Record<string, string>; subject?: string; source_message_id?: string }

// The reply goes to whoever last emailed us on this thread, as "Re: <their subject>", with
// In-Reply-To/References so it lands under their message. Send Messages sends it from the
// client identity (Davorin from ARCH <davorin@madebyarch.com>).
export async function emailReplyTarget(prospectId: string): Promise<EmailReplyTarget> {
  const { data, error } = await supabase.from('outreach_messages')
    .select('id,direction,recipient_email,draft_evidence,message_text')
    .eq('prospect_id', prospectId).eq('channel', 'email').not('recipient_email', 'is', null)
    .order('sent_at', { ascending: false, nullsFirst: false }).limit(10)
  if (error) throw error
  const rows = (data ?? []) as { id: string; direction: string; recipient_email: string; draft_evidence: { email_subject?: string; email?: { subject?: string; message_id?: string; references?: string } } | null; message_text: string }[]
  const inbound = rows.find(r => r.direction === 'inbound')
  const row = inbound ?? rows[0]
  if (!row) throw new Error('No email address on this thread, so the reply was not queued.')
  const em = inbound?.draft_evidence?.email ?? {}
  const firstLine = (row.message_text ?? '').split('\n')[0] ?? ''
  const baseSubject = (em.subject || row.draft_evidence?.email_subject || (/^subject:/i.test(firstLine) ? firstLine.replace(/^subject:\s*/i, '') : '') || 'Following up').replace(/[\r\n]+/g, ' ').trim()
  const subject = /^re:/i.test(baseSubject) ? baseSubject : `Re: ${baseSubject}`
  const mid = (em.message_id ?? '').trim()
  return {
    recipient_email: String(row.recipient_email).split(/[,;\s]+/).filter(Boolean)[0],
    subject, source_message_id: row.id,
    message_text_prefix: `Subject: ${subject}\n\n`,
    ...(mid ? { email_headers: { 'In-Reply-To': mid, References: `${(em.references ?? '').trim()} ${mid}`.trim() } } : {}),
  }
}

export async function composeReply(t: Thread, text: string, expectedEmail?: EmailReplyTarget): Promise<LegFailure[]> {
  const isEmail = t.channel === 'email'
  if (isEmail && !canComposeEmail(t)) throw new Error('Email compose is only on for ARCH threads.')
  const target = isEmail ? await emailReplyTarget(t.prospect_id) : null
  if (target && expectedEmail && (target.recipient_email !== expectedEmail.recipient_email
    || target.message_text_prefix !== expectedEmail.message_text_prefix
    || JSON.stringify(target.email_headers ?? {}) !== JSON.stringify(expectedEmail.email_headers ?? {})
    || (expectedEmail.source_message_id && target.source_message_id !== expectedEmail.source_message_id))) {
    throw new Error('The email conversation changed. Refresh email details and review the reply before sending.')
  }
  const manualRevision = await takeOwnershipBeforeManualReply(t.prospect_id)
  const evidence = {
    ...(manualRevision === null ? {} : { conversation_agent_manual_revision: manualRevision }),
    ...(target?.email_headers ? { email_headers: target.email_headers } : {}),
    ...(target ? { email_subject: target.subject, email_reply_to_message_id: target.source_message_id } : {}),
  }
  const { error } = await supabase.from('outreach_messages').insert({
    prospect_id: t.prospect_id, direction: 'outbound',
    message_text: target ? target.message_text_prefix + text : text,
    message_type: 'manual_reply', channel: isEmail ? 'email' : 'linkedin',
    ...(target ? { recipient_email: target.recipient_email } : {}),
    approved_at: new Date().toISOString(),
    // sent_at defaults to now() at the column level; explicit null keeps the
    // row pickable by the dispatcher (approved_at NOT NULL AND sent_at IS NULL).
    sent_at: null,
    ...(Object.keys(evidence).length ? { draft_evidence: evidence } : {}),
  })
  if (error) throw error
  // Ivan just answered this thread himself, so the pending AI draft is now
  // stale: discard it, EVERY leg. Discarding t.draft alone left a paired email
  // pending and approvable, and it became the thread's lone draft
  // (check3-drafts E1.1). His reply is already queued, so a leg that would not
  // stop is returned for the thread to report, never thrown as if the reply failed.
  return discardLegs(draftLegs(t))
}

/* ==========================================================================
   AFTER NO ANSWER (Ivan 2026-10-21, Diane O'Brien). A write that timed out may
   still have landed. Before the thread offers the key again it reads the rows:
   a send that landed is shown as queued and never sent twice.
   ========================================================================== */
export type SendState = Pick<InboxMessage, 'id' | 'direction' | 'message_text' | 'message_type' | 'channel' | 'sent_at' | 'approved_at'
  | 'send_blocked_reason' | 'send_blocked_at' | 'unipile_message_id' | 'created_at' | 'draft_evidence'>
const SEND_STATE = 'id,direction,message_text,message_type,channel,sent_at,approved_at,send_blocked_reason,send_blocked_at,unipile_message_id,created_at,stopped:draft_evidence->stopped'
/** Its own short clock: a check after silence must not wait out the read backstop. */
export const CHECK_MS = 10_000

/** The send fields of these rows, as the database has them now. */
export async function readSendState(ids: string[], ms = CHECK_MS): Promise<SendState[]> {
  if (!ids.length) return []
  const { data, error } = await bounded(signal => supabase.from('outreach_messages').select(SEND_STATE).in('id', ids).abortSignal(signal), ms)
  if (error) throw error
  return ((data ?? []) as unknown as (Omit<SendState, 'draft_evidence'> & { stopped?: unknown })[])
    .map(({ stopped, ...r }) => ({ ...r, draft_evidence: stopped === undefined || stopped === null ? null : { stopped } }))
}

/** A hand reply with these words that already landed on the thread in the last `withinMs` (a compose whose
 *  insert got no answer). Matches the stored text, with or without an email Subject prefix. */
export async function findLandedReply(prospectId: string, text: string, withinMs = 15 * 60_000, ms = CHECK_MS): Promise<SendState | null> {
  const body = text.trim()
  if (!body) return null
  const since = new Date(Date.now() - withinMs).toISOString()
  const { data, error } = await bounded(signal => supabase.from('outreach_messages').select(SEND_STATE)
    .eq('prospect_id', prospectId).eq('direction', 'outbound').eq('message_type', 'manual_reply').gte('created_at', since)
    .order('created_at', { ascending: false }).limit(10).abortSignal(signal), ms)
  if (error) throw error
  const rows = (data ?? []) as unknown as SendState[]
  return rows.find(r => r.send_blocked_reason !== 'discarded_in_inbox' && ((r.message_text ?? '').trim() === body || (r.message_text ?? '').endsWith(`\n\n${body}`))) ?? null
}

export async function markThreadRead(prospect_id: string): Promise<void> {
  const { error } = await supabase.from('outreach_messages')
    .update({ read_at: new Date().toISOString() })
    .eq('prospect_id', prospect_id).eq('direction', 'inbound').is('read_at', null)
  if (error) throw error
}

// The identity a draft's email leg actually goes out as. 2026-09-04: the badge used to
// read "Approving also emails the scan to X (from itsmattan@risedtc.com)" on EVERY stamped
// draft — hardcoded RISE wording that was a plain falsehood on an ARCH row, and "the scan"
// was wrong for any non-scan delivery (the mirror stopped being scan-only on 08-19).
// Sender resolution now lives in integration_config.outreach_email_identities, which is what
// `Outreach - Send Messages` > Poll + Send reads. KEEP THIS MAP IN SYNC WITH THAT ROW.
// An unknown client names no sender rather than guessing one.
export function emailSenderLabel(clientId: string | null | undefined): string {
  const senders: Record<string, string> = {
    risedtc: 'itsmattan@risedtc.com',
    arch: 'davorin@madebyarch.com',
    swishdm: 'john@madebyswishdm.com',
  }
  const from = senders[String(clientId ?? '')]
  return from ? ` (from ${from})` : ''
}

// A channel='email' ROW is a different pipe from the mirror above. Ivan's own rows
// are handed to the dispatcher's Gmail node, whose credential is his mailbox, so
// they leave im@ivanmanfredi.com. Since 2026-09-11 (Send Messages > Poll + Send,
// "CLIENT-TENANT NATIVE EMAIL") a CLIENT row goes out through Resend on the same
// client identity the mirror uses, and is HELD with a reason when no identity
// exists, never mailed as Ivan. Named on the card because "which address does
// this arrive from" is the operator's whole question. KEEP emailRowSender IN SYNC
// WITH integration_config.outreach_email_identities.
export const NATIVE_EMAIL_SENDER = 'im@ivanmanfredi.com'

export function emailRowSender(clientId: string | null | undefined): string {
  const senders: Record<string, string> = {
    risedtc: 'itsmattan@risedtc.com',
    arch: 'davorin@madebyarch.com',
    swishdm: 'john@madebyswishdm.com',
  }
  return senders[String(clientId ?? '')] ?? NATIVE_EMAIL_SENDER
}
