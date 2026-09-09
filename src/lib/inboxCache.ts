/* ==========================================================================
   src/lib/inboxCache.ts: the DMs first screen, kept on the device.

   What is cached: the RECONCILED thread list the DMs screen is rendering, plus
   the two numbers its chips print (waiting, spam) taken from that same array so
   a chip can never disagree with the rows under it.

   What is NEVER cached: a failed read (useInbox only calls the writer after a
   fetch resolved), a capability link (lib/swr.ts refuses the write), and the
   per-draft evidence blob, which is a probe annotation the list never draws and
   is the single largest field on the row.

   WHY IT IS NOT THE WHOLE LIST. Measured on Ivan's live inbox, 2026-09-09:
   3,561 threads, 14,124,761 bytes of JSON. That is three times the whole
   localStorage budget for the origin, so "cache everything" is not a design, it
   is a refused write. What is kept instead:

     · EVERY row any COUNT or BAR on the screen reads. `keepWhole` below is the
       union of the buckets inboxBreakdown counts, the spam folder, the pushed
       and the stale strips. So the chip that says 18, the badge that says 18 and
       the strip that says "1 draft pushed to later" are computed over a set that
       contains all of their rows. A cached count is the same number the live
       count will be, not a number derived from a partial list.
     · then the newest ordinary conversations, in the order the list draws them,
       until the size cap. Those are rows the fold shows and the ball is with the
       other person on every one of them: nothing on the screen counts them.

   So the list under a cached paint is short, and the numbers on it are true.
   ========================================================================== */
import type { InboxMessage, Thread } from './inbox'
import { eventTime, inboxWaitingCount, filterThreads, threadBucket } from './inbox'
import { readSwr, writeSwr, type SwrWriteResult } from './swr'

// The byte budget for the ROWS. Well under lib/swr.ts's own 2 MB cap, so a
// payload built here is never refused for size by the layer below it, and well
// under the origin's own quota, which localStorage counts in UTF-16 code units
// (so this is ~1.4 MB of a ~5 MB budget the Supabase session and Today's brief
// also live in). It is ~170 conversations on Ivan's live data against a fold
// that shows nine, so the number is not the constraint the screen feels.
export const ROWS_BUDGET_BYTES = 700_000

export const INBOX_QUERY = 'dms/threads'

export type InboxCache = {
  threads: Thread[]
  waiting: number
  spam: number
  // How many conversations the live read had, against how many are stored. The
  // screen does not print it; it is here so a later reader (and the skeptic
  // seat) can see the cache never claimed to be the whole list.
  total: number
}

/**
 * A row some number or strip on the DMs screen reads. Every one of these is
 * kept whatever the budget says, which is what makes a cached count true.
 */
export function keepWhole(t: Thread): boolean {
  return t.spam
    || t.draftSnoozedUntil !== null
    || t.draftStale
    || threadBucket(t) !== 'waiting'
}

/** Work rows first, then the newest ordinary conversations. */
export function orderForCache(threads: Thread[]): Thread[] {
  const work: Thread[] = []
  const rest: Thread[] = []
  for (const t of threads) (keepWhole(t) ? work : rest).push(t)
  rest.sort((a, b) => eventTime(b.last).localeCompare(eventTime(a.last)))
  return [...work, ...rest]
}

// The projection is a WHITELIST typed as InboxMessage, so a column the view
// grows and a screen starts reading is a compile error here rather than a field
// that silently vanishes from the cached copy.
function projectMessage(m: InboxMessage): InboxMessage {
  return {
    id: m.id, prospect_id: m.prospect_id, direction: m.direction,
    message_text: m.message_text, message_type: m.message_type, channel: m.channel,
    sent_at: m.sent_at, approved_at: m.approved_at, read_at: m.read_at,
    created_at: m.created_at, send_blocked_at: m.send_blocked_at,
    send_blocked_reason: m.send_blocked_reason, unipile_chat_id: m.unipile_chat_id,
    ai_model: m.ai_model, prospect_name: m.prospect_name,
    prospect_company: m.prospect_company, prospect_headline: m.prospect_headline,
    prospect_stage: m.prospect_stage, prospect_email: m.prospect_email,
    profile_photo_url: m.profile_photo_url, prospect_linkedin_url: m.prospect_linkedin_url,
    chat_provider_id: m.chat_provider_id, campaign_name: m.campaign_name,
    client_id: m.client_id, prospect_skip_reason: m.prospect_skip_reason ?? null,
    recipient_email: m.recipient_email ?? null,
    email_mirror_text: m.email_mirror_text ?? null,
    context_gap: m.context_gap ?? null,
    // draft_evidence is deliberately dropped (see the header). The card that
    // draws it re-reads it live; a missing blob renders the same "not recorded"
    // branch it already has for a draft the probe never covered.
    snoozed_until: m.snoozed_until, snoozed_at: m.snoozed_at,
  }
}

export function projectThread(t: Thread): Thread {
  return {
    prospect_id: t.prospect_id, prospect_name: t.prospect_name,
    prospect_company: t.prospect_company, client_id: t.client_id, channel: t.channel,
    stage: t.stage, linkedin_url: t.linkedin_url, chat_provider_id: t.chat_provider_id,
    last: projectMessage(t.last), unread: t.unread,
    draft: t.draft ? projectMessage(t.draft) : null,
    messages: t.messages.map(projectMessage),
    spam: t.spam,
    companionDraft: t.companionDraft ? projectMessage(t.companionDraft) : null,
    ownerConfirmation: t.ownerConfirmation ? projectMessage(t.ownerConfirmation) : null,
    draftStale: t.draftStale, draftSnoozedUntil: t.draftSnoozedUntil,
    needsManualReply: t.needsManualReply,
  }
}

/**
 * The payload, built from the array the screen is rendering. The counts come
 * from the FULL array, the rows from as much of it as fits.
 */
export function buildInboxCache(threads: Thread[], budget = ROWS_BUDGET_BYTES): InboxCache {
  const kept: Thread[] = []
  let bytes = 0
  for (const t of orderForCache(threads)) {
    const p = projectThread(t)
    const size = JSON.stringify(p).length
    // A work row is kept even if it is the one that crosses the line: dropping
    // it would be dropping a row a count on the screen is about to state.
    if (bytes + size > budget && !keepWhole(t)) break
    kept.push(p)
    bytes += size
  }
  return {
    threads: kept,
    waiting: inboxWaitingCount(threads),
    spam: filterThreads(threads, 'spam').length,
    total: threads.length,
  }
}

export function writeInboxCache(threads: Thread[]): SwrWriteResult {
  return writeSwr(INBOX_QUERY, buildInboxCache(threads))
}

export function readInboxCache(): { savedAt: string; cache: InboxCache } | null {
  const e = readSwr<InboxCache>(INBOX_QUERY)
  if (!e || !e.payload || !Array.isArray(e.payload.threads)) return null
  // A stored shape that lost its `last` message would crash the row renderer.
  // A cache that cannot be trusted whole is a miss, never a partial paint.
  for (const t of e.payload.threads) {
    if (!t || typeof t.prospect_id !== 'string' || !t.last || !Array.isArray(t.messages)) return null
  }
  return { savedAt: e.savedAt, cache: e.payload }
}
