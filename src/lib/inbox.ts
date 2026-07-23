import { supabase } from './supabase'

export type InboxMessage = {
  id: string; prospect_id: string; direction: 'inbound' | 'outbound';
  message_text: string; message_type: string | null;
  channel: 'linkedin' | 'linkedin_inmail' | 'email';
  sent_at: string | null; approved_at: string | null; read_at: string | null;
  created_at: string; send_blocked_at: string | null; send_blocked_reason: string | null;
  unipile_chat_id: string | null;
  prospect_name: string; prospect_company: string | null; prospect_headline: string | null;
  prospect_stage: string; prospect_email: string | null; profile_photo_url: string | null;
  campaign_name: string; client_id: string;
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
}

export type Filter = 'all' | 'ivan' | 'risedtc' | 'email'

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

export function groupThreads(rows: InboxMessage[]): Thread[] {
  const map = new Map<string, InboxMessage[]>()
  for (const m of rows) {
    if (!map.has(m.prospect_id)) map.set(m.prospect_id, [])
    map.get(m.prospect_id)!.push(m)
  }
  const threads: Thread[] = []
  for (const messages of map.values()) {
    messages.sort((a, b) => a.created_at.localeCompare(b.created_at))
    const last = messages[messages.length - 1]
    const drafts = messages.filter(isDraft)
    // Archived prospects are dead lanes (e.g. ~76 April cold-email drafts from
    // a retired campaign) — their leftover drafts don't belong in the queue.
    const draft = last.prospect_stage === 'archived'
      ? null
      : drafts.length ? drafts[drafts.length - 1] : null
    const lastInbound = messages.filter(m => m.direction === 'inbound').at(-1)?.created_at ?? null
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
      messages,
    })
  }
  return threads.sort((a, b) => b.last.created_at.localeCompare(a.last.created_at))
}

// An invite that nobody accepted is a send, not a conversation (Eric Osman case:
// 117 of 1125 threads were connection notes sitting in the void). They live in
// Sends -> Log; the Inbox shows them only once the prospect accepts (stage flips
// off connection_sent when accept detection runs) or anything inbound lands.
function isConversation(t: Thread): boolean {
  if (t.stage !== 'connection_sent') return true
  return t.draft !== null || t.messages.some(m => m.direction === 'inbound')
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

// The chat this thread already lives in on LinkedIn (InMail threads carry it on
// both the sent InMail and the inbound reply). Stamping it on the approved row
// lets the sender append to the existing chat instead of creating a new one —
// creating fails with 422 for non-connections (Anthony + Alex, 2026-07-22).
export function threadChatId(t: Thread): string | null {
  return t.messages.filter(m => m.unipile_chat_id).at(-1)?.unipile_chat_id ?? null
}

export async function approveDraft(id: string, editedText: string, chatId?: string | null): Promise<void> {
  const patch: Record<string, unknown> = {
    message_text: editedText, approved_at: new Date().toISOString(),
  }
  if (chatId) patch.unipile_chat_id = chatId
  const { error } = await supabase.from('outreach_messages')
    .update(patch)
    .eq('id', id).is('sent_at', null)
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
