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
}

export type Thread = {
  prospect_id: string; prospect_name: string; prospect_company: string | null;
  client_id: string; channel: InboxMessage['channel']; stage: string;
  last: InboxMessage; unread: number; draft: InboxMessage | null; messages: InboxMessage[];
  // The drafter sometimes writes a reply after Ivan already answered the
  // prospect himself (5 live cases on 2026-07-22: George, Jeremy, Jonathan,
  // Antoine, Rudra). True when a real outbound send is newer than the last
  // inbound, so the pending draft is answering an already-handled message.
  draftStale: boolean;
  // outreach_prospects.needs_manual_reply — the reply detector's own "a human
  // has to answer this one" flag. It is NOT derivable from the messages: on
  // 2026-08-03, 43 of the 45 flagged prospects had ZERO inbound rows in
  // inbox_messages_v (the reply the detector saw never got mirrored into the
  // view — the reply-blindspot class of bug). Going by message rows alone would
  // make every one of them invisible, so the flag rides on the thread.
  needsManualReply: boolean;
}

export type Filter = 'all' | 'ivan' | 'risedtc' | 'arch' | 'email'

export function isDraft(m: InboxMessage): boolean {
  return m.direction === 'outbound' && !m.sent_at && !m.approved_at && !m.send_blocked_at
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

export function groupThreads(rows: InboxMessage[], manualReplyIds: ReadonlySet<string> = new Set()): Thread[] {
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
    const draft = last.prospect_stage === 'archived'
      ? null
      : drafts.length ? drafts[drafts.length - 1] : null
    // Must use the same clock as lastSent below (sent_at). Comparing an inbound created_at
    // against an outbound sent_at is two different clocks, and a backfilled reply then made
    // a live draft look stale.
    const lastInbound = messages.filter(m => m.direction === 'inbound').map(eventTime).sort().at(-1) ?? null
    const lastSent = messages
      .filter(m => m.direction === 'outbound' && m.sent_at)
      .map(m => m.sent_at!).sort().at(-1) ?? null
    threads.push({
      prospect_id: last.prospect_id, prospect_name: last.prospect_name,
      prospect_company: last.prospect_company, client_id: last.client_id,
      channel: last.channel, stage: last.prospect_stage, last,
      unread: messages.filter(m => m.direction === 'inbound' && !m.read_at).length,
      draft,
      draftStale: draft !== null && lastInbound !== null && lastSent !== null && lastSent > lastInbound,
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

export function needsAnswer(t: Thread, now: number = Date.now()): boolean {
  if (CLOSED_STAGES.has(t.stage)) return false
  const lastInbound = t.messages.filter(m => m.direction === 'inbound' && isRealReply(m))
    .map(eventTime).sort().at(-1) ?? null
  if (lastInbound === null) return false
  if (now - Date.parse(lastInbound) > STALE_DAYS * 86_400_000) return false
  // DISCARDING A DRAFT IS AN ANSWER TO THE QUESTION "does this need a reply".
  // Gabriel Amarazeanu (2026-08-03): Mattan replied on LinkedIn by hand and
  // binned the drafted reply, so the thread's newest outbound row is a discard
  // and the mirror never captured his manual send. Ivan: "gabriel was handled
  // manually by mattan as you can see". A human already ruled on this thread;
  // re-listing it is the app overruling him.
  const discarded = t.messages
    .filter(m => m.direction === 'outbound' && !m.sent_at && m.send_blocked_reason === 'discarded_in_inbox')
    .map(eventTime).sort().at(-1) ?? null
  if (discarded !== null && discarded > lastInbound) return false
  const lastSent = t.messages
    .filter(m => m.direction === 'outbound' && m.sent_at)
    .map(m => m.sent_at!).sort().at(-1) ?? null
  return lastSent === null || lastSent <= lastInbound
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
  if (t.draft !== null) return 'approve'
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
// chat_url comes from outreach_prospects.linkedin_url — unipile_chat_id is a Unipile id and
// does NOT resolve to a linkedin.com thread URL, so the profile is the only real link we hold.
export type DraftContextGap = { question: string | null; why: string | null; chat_url: string | null }

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
export async function approveDraft(id: string, editedText: string, chatId?: string | null): Promise<void> {
  const patch: Record<string, unknown> = {
    message_text: editedText, approved_at: new Date().toISOString(),
  }
  if (chatId) patch.unipile_chat_id = chatId
  const { error } = await supabase.from('outreach_messages')
    .update(patch)
    .eq('id', id).is('sent_at', null).is('send_blocked_reason', null)
  if (error) throw error
}

export async function discardDraft(id: string): Promise<void> {
  const { error } = await supabase.from('outreach_messages')
    .update({ send_blocked_reason: 'discarded_in_inbox', send_blocked_at: new Date().toISOString() })
    .eq('id', id).is('sent_at', null)
  if (error) throw error
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
