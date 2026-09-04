import { supabase } from './supabase'

export type InboxMessage = {
  id: string; prospect_id: string; direction: 'inbound' | 'outbound';
  message_text: string; message_type: string | null;
  channel: 'linkedin' | 'linkedin_inmail' | 'email';
  sent_at: string | null; approved_at: string | null; read_at: string | null;
  created_at: string; send_blocked_at: string | null; send_blocked_reason: string | null;
  unipile_chat_id: string | null;
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
  // Not in inbox_messages_v — annotated onto pending drafts by useInbox from the
  // fetchDraftEmailStamps() probe. When set on a draft, approving it makes the
  // dispatcher ALSO email the scan to this address (rise_dm2_scan_delivery_v1 rows).
  recipient_email?: string | null;
  // The exact email body the dispatcher will send (composed + stored by the
  // drafter). Shown verbatim under the badge so approval sees the real send.
  email_mirror_text?: string | null;
  // Answerability gate (Ivan 2026-08-19). Set by the RISE reply drafter when the
  // prospect asked something rise-company-facts does not cover, so the reply's
  // substance is UNVERIFIED (George Gazzard/SOLSKIN asked how the creative gets
  // produced; the drafter invented "real shoots for model and skin content").
  // ADVISORY: the draft is still editable and approvable exactly as before.
  context_gap?: DraftContextGap | null;
  // What the drafter was actually GIVEN when it wrote this (Ivan 2026-08-20: "see the draft on the
  // dm with a small context collapsed thing"). A logged input list, never the model's account of
  // what it used — asked that, a model confabulates. Probed like context_gap: not in the view.
  draft_evidence?: DraftEvidence | null;
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
}

export type Filter = 'all' | 'ivan' | 'risedtc' | 'arch' | 'email'

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

export function isRaceHold(reason: string | null): boolean {
  return reason !== null && reason.startsWith(RACE_HOLD_PREFIX)
}

// Race holds and lint holds share the recovery path: the row comes back as a
// pending draft and approving clears the block.
export function isRecoverableHold(reason: string | null): boolean {
  return isRaceHold(reason) || (reason !== null && reason.startsWith(LINT_HOLD_PREFIX))
}

export function isDraft(m: InboxMessage): boolean {
  return m.direction === 'outbound' && !m.sent_at && !m.approved_at &&
    (!m.send_blocked_at || isRecoverableHold(m.send_blocked_reason))
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
  const seen = new Set<string>()
  const out: InboxMessage[] = []
  for (const m of rows) {
    const key = `${m.prospect_id}|${m.direction}|${m.sent_at ?? m.created_at}|${m.message_text}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(m)
  }
  return out
}

// When the message actually happened, as opposed to when we stored it. A reply captured
// late (backfilled by the detector hours or days after the person wrote it) has a created_at
// far newer than its sent_at, so ordering by created_at renders it below messages it in fact
// preceded. Unsent drafts have no sent_at, so they fall back to created_at and sort last,
// which is what we want for a pending draft.
export const eventTime = (m: InboxMessage): string => m.sent_at ?? m.created_at

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
    const drafts = messages.filter(isDraft)
    // Archived prospects are dead lanes (e.g. ~76 April cold-email drafts from
    // a retired campaign) — their leftover drafts don't belong in the queue.
    const newestDraft = last.prospect_stage === 'archived'
      ? null
      : drafts.length ? drafts[drafts.length - 1] : null
    // The other leg, when there is one. See Thread.companionDraft.
    const otherLeg = newestDraft === null
      ? null
      : drafts.filter(d => d.id !== newestDraft.id
          && messageChannel(d) !== messageChannel(newestDraft)).at(-1) ?? null
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
    const lastRode = messages.filter(m => !isDraft(m)).at(-1) ?? last
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
      draft, companionDraft,
      // isFollowUp: a nudge is DEFINED by "we spoke last and they went quiet",
      // which is what this test measures — so without the exemption every
      // follow-up draft ever written scores stale. See isFollowUp.
      draftStale: draft !== null && !isFollowUp(draft)
        && lastInbound !== null && lastSent !== null && lastSent > lastInbound,
      draftSnoozedUntil: snoozedUntil,
      needsManualReply: manualReplyIds.has(last.prospect_id),
      messages,
    })
  }
  return threads.sort((a, b) => b.last.created_at.localeCompare(a.last.created_at))
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

function isConversation(t: Thread): boolean {
  return t.draft !== null || t.messages.some(m => m.direction === 'inbound') || isLeadMagnet(t)
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
const CLOSED_STAGES = new Set(['archived', 'skipped', 'disqualified', 'unsubscribed', 'blacklisted'])

function isRealReply(m: InboxMessage): boolean {
  const text = (m.message_text ?? '').trim()
  if (!text) return false
  return !DEAD_TAG.test(text) && !OOO_TEXT.test(text) && !REACTION.test(text)
    && !DECLINE.test(text) && !SIGNOFF.test(text)
}

// The core "does this thread owe a reply" test, with no staleness cutoff.
// Extracted so needsAnswer (the badge/list predicate, which DOES cut off at
// STALE_DAYS so the badge does not ring forever on something that will never
// be answered) and unansweredWaitSince (Today's work queue, which wants
// exactly the old ones the badge hides) share one definition of "waiting" and
// cannot drift apart. Returns the inbound message's own timestamp, the
// moment the wait began, or null when the thread does not owe a reply at all.
function unansweredSince(t: Thread): string | null {
  if (CLOSED_STAGES.has(t.stage)) return null
  // PUSHING A DRAFT IS AN ANSWER TO "does this need a reply TODAY" — the same
  // move as the discard rule below, with a return date on it. Ivan read the
  // thread, the person said they were travelling, and he said "not yet". A
  // thread that kept ringing the badge after that would be the app arguing with
  // him. It rings again the moment the push expires, and instantly if they
  // write back (which voids draftSnoozedUntil in groupThreads).
  if (t.draftSnoozedUntil !== null) return null
  const lastInbound = t.messages.filter(m => m.direction === 'inbound' && isRealReply(m))
    .map(eventTime).sort().at(-1) ?? null
  if (lastInbound === null) return null
  // DISCARDING A DRAFT IS AN ANSWER TO THE QUESTION "does this need a reply".
  // Gabriel Amarazeanu (2026-08-03): Mattan replied on LinkedIn by hand and
  // binned the drafted reply, so the thread's newest outbound row is a discard
  // and the mirror never captured his manual send. Ivan: "gabriel was handled
  // manually by mattan as you can see". A human already ruled on this thread;
  // re-listing it is the app overruling him.
  const discarded = t.messages
    .filter(m => m.direction === 'outbound' && !m.sent_at && m.send_blocked_reason === DISCARD_REASON)
    .map(eventTime).sort().at(-1) ?? null
  if (discarded !== null && discarded > lastInbound) return null
  const lastSent = t.messages
    .filter(m => m.direction === 'outbound' && m.sent_at)
    .map(m => m.sent_at!).sort().at(-1) ?? null
  return (lastSent === null || lastSent <= lastInbound) ? lastInbound : null
}

export function needsAnswer(t: Thread, now: number = Date.now()): boolean {
  const since = unansweredSince(t)
  return since !== null && now - Date.parse(since) <= STALE_DAYS * 86_400_000
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
export function threadBucket(t: Thread): ThreadBucket {
  if (needsAnswer(t)) return 'answer'
  // A pushed draft is not work waiting on him, so it does not count as one.
  // It stays reachable in 'all' / 'Waiting on them' wearing its return date —
  // parked, never disappeared.
  if (t.draft !== null && t.draftSnoozedUntil === null) return 'approve'
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
    if (!isConversation(t)) continue
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
  if (f === 'all') return convos
  if (f === 'email') return convos.filter(t => t.channel === 'email')
  return convos.filter(t => t.client_id === f)
}

export async function fetchMessages(): Promise<InboxMessage[]> {
  // PostgREST caps a single response at 1000 rows regardless of .limit(),
  // so page through the view; id tiebreak keeps pages stable.
  const all: InboxMessage[] = []
  const page = 1000
  for (let from = 0; from < 20000; from += page) {
    const { data, error } = await supabase.from('inbox_messages_v')
      .select('*')
      .order('created_at', { ascending: true }).order('id', { ascending: true })
      .range(from, from + page - 1)
    if (error) throw error
    all.push(...(data as InboxMessage[]))
    if (!data || data.length < page) break
  }
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
export type DraftEmailStamp = { recipient_email: string; email_mirror_text: string | null }

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
  facts?: { slug: string; version: number | null; updated_at?: string | null } | null
  learned?: DraftEvidenceFact[] | null
  exemplars?: DraftEvidenceExemplar[] | null
  store_fact?: string | null
  anchor?: string | null
  scan_finding?: string | null
  operator_note?: string | null
}

/** Same probe + same degrade rule as the gaps above: losing this only loses the Evidence
 *  collapsible, never the inbox. */
export async function fetchDraftEvidence(): Promise<Map<string, DraftEvidence>> {
  const { data, error } = await supabase.from('outreach_messages')
    .select('id,draft_evidence')
    .eq('direction', 'outbound')
    .is('sent_at', null).is('approved_at', null)
    .not('draft_evidence', 'is', null)
    .limit(500)
  if (error) throw error
  const m = new Map<string, DraftEvidence>()
  for (const r of (data ?? []) as { id: string; draft_evidence: DraftEvidence | null }[]) {
    if (r.draft_evidence) m.set(r.id, r.draft_evidence)
  }
  return m
}

export async function fetchDraftContextGaps(): Promise<Map<string, DraftContextGap>> {
  const { data, error } = await supabase.from('outreach_messages')
    .select('id,prospect_id,context_gap')
    .eq('direction', 'outbound')
    .is('sent_at', null).is('approved_at', null)
    .not('context_gap', 'is', null)
    .limit(500)
  if (error) throw error
  const rows = (data ?? []) as { id: string; prospect_id: string; context_gap: { question?: string; why?: string } | null }[]
  const m = new Map<string, DraftContextGap>()
  if (!rows.length) return m
  const urls = new Map<string, string | null>()
  const { data: props } = await supabase.from('outreach_prospects')
    .select('id,linkedin_url')
    .in('id', Array.from(new Set(rows.map(r => r.prospect_id))))
  for (const p of (props ?? []) as { id: string; linkedin_url: string | null }[]) urls.set(p.id, p.linkedin_url)
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

/** Optional: queue the "what do I tell them" question for Mattan in the Ops inbox, carrying the
 *  conversation link. Never sends anything itself, and never blocks approving the draft. */
export async function escalateDraftToClient(messageId: string): Promise<string> {
  const { data, error } = await supabase.rpc('operator_escalate_rise_draft', {
    p_gate: 'clientops', p_message_id: messageId,
  })
  if (error) throw error
  const r = (data ?? {}) as { ok?: boolean; note?: string; error?: string }
  if (!r.ok) throw new Error(r.error || 'could not queue that')
  return r.note || 'Queued for Mattan.'
}

export async function fetchDraftEmailStamps(): Promise<Map<string, DraftEmailStamp>> {
  const { data, error } = await supabase.from('outreach_messages')
    .select('id,recipient_email,email_mirror_text')
    .eq('direction', 'outbound')
    .is('sent_at', null).is('approved_at', null).is('send_blocked_at', null)
    .not('recipient_email', 'is', null)
    .limit(500)
  if (error) throw error
  const m = new Map<string, DraftEmailStamp>()
  for (const r of (data ?? []) as { id: string; recipient_email: string | null; email_mirror_text: string | null }[]) {
    if (r.recipient_email) m.set(r.id, { recipient_email: r.recipient_email, email_mirror_text: r.email_mirror_text })
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
export async function approveDraft(id: string, editedText: string, chatId?: string | null): Promise<void> {
  const patch: Record<string, unknown> = {
    message_text: editedText, approved_at: new Date().toISOString(),
    send_blocked_reason: null, send_blocked_at: null,
  }
  if (chatId) patch.unipile_chat_id = chatId
  const { error } = await supabase.from('outreach_messages')
    .update(patch)
    .eq('id', id).is('sent_at', null)
    .or(`send_blocked_reason.is.null,send_blocked_reason.like.${RACE_HOLD_PREFIX}*,send_blocked_reason.like.${LINT_HOLD_PREFIX}*`)
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
    .or(`send_blocked_reason.is.null,send_blocked_reason.like.${RACE_HOLD_PREFIX}*,send_blocked_reason.like.${LINT_HOLD_PREFIX}*`)
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
    .or(`send_blocked_reason.is.null,send_blocked_reason.like.${RACE_HOLD_PREFIX}*,send_blocked_reason.like.${LINT_HOLD_PREFIX}*`)
  if (error) throw error
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
export async function discardDraft(id: string): Promise<boolean> {
  const { data, error } = await applyDraftGuard(
    supabase.from('outreach_messages')
      .update({ send_blocked_reason: DISCARD_REASON, send_blocked_at: new Date().toISOString() }),
    id, DISCARD_GUARD,
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
export async function restoreDraft(id: string): Promise<boolean> {
  const { data, error } = await applyDraftGuard(
    supabase.from('outreach_messages')
      .update({ send_blocked_reason: null, send_blocked_at: null }),
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
export function canRestore(t: Thread, m: InboxMessage): boolean {
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

export async function composeReply(t: Thread, text: string): Promise<void> {
  const { error } = await supabase.from('outreach_messages').insert({
    prospect_id: t.prospect_id, direction: 'outbound', message_text: text,
    message_type: 'manual_reply', channel: t.channel === 'email' ? 'email' : 'linkedin',
    approved_at: new Date().toISOString(),
    // sent_at defaults to now() at the column level; explicit null keeps the
    // row pickable by the dispatcher (approved_at NOT NULL AND sent_at IS NULL).
    sent_at: null,
  })
  if (error) throw error
  // Ivan just answered this thread himself, so the pending AI draft (if any)
  // is now stale — discard it rather than leaving it to rot in the queue.
  if (t.draft) await discardDraft(t.draft.id).catch(() => {})
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
  }
  const from = senders[String(clientId ?? '')]
  return from ? ` (from ${from})` : ''
}

// A channel='email' ROW is a different pipe from the mirror above. The mirror goes
// through Resend on the client's sending domain; a native email row is handed to
// the dispatcher's Gmail node, whose credential is Ivan's own mailbox — so it
// leaves im@ivanmanfredi.com whatever lane the row belongs to. Named on the card
// because "which address does this arrive from" is the operator's whole question,
// and 🔴 because the day a client row rides this path it will go out as Ivan.
export const NATIVE_EMAIL_SENDER = 'im@ivanmanfredi.com'
