import { supabase } from './supabase'

export type InboxMessage = {
  id: string; prospect_id: string; direction: 'inbound' | 'outbound';
  message_text: string; message_type: string | null;
  channel: 'linkedin' | 'linkedin_inmail' | 'email';
  sent_at: string | null; approved_at: string | null; read_at: string | null;
  created_at: string; send_blocked_at: string | null; send_blocked_reason: string | null;
  prospect_name: string; prospect_company: string | null; prospect_headline: string | null;
  prospect_stage: string; prospect_email: string | null; profile_photo_url: string | null;
  campaign_name: string; client_id: string;
}

export type Thread = {
  prospect_id: string; prospect_name: string; prospect_company: string | null;
  client_id: string; channel: InboxMessage['channel']; stage: string;
  last: InboxMessage; unread: number; draft: InboxMessage | null; messages: InboxMessage[];
}

export type Filter = 'all' | 'ivan' | 'risedtc' | 'email'

export function isDraft(m: InboxMessage): boolean {
  return m.direction === 'outbound' && !m.sent_at && !m.approved_at && !m.send_blocked_at
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
    threads.push({
      prospect_id: last.prospect_id, prospect_name: last.prospect_name,
      prospect_company: last.prospect_company, client_id: last.client_id,
      channel: last.channel, stage: last.prospect_stage, last,
      unread: messages.filter(m => m.direction === 'inbound' && !m.read_at).length,
      draft: drafts.length ? drafts[drafts.length - 1] : null,
      messages,
    })
  }
  return threads.sort((a, b) => b.last.created_at.localeCompare(a.last.created_at))
}

export function filterThreads(threads: Thread[], f: Filter): Thread[] {
  if (f === 'all') return threads
  if (f === 'email') return threads.filter(t => t.channel === 'email')
  return threads.filter(t => t.client_id === f)
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
  return all
}

export async function approveDraft(id: string, editedText: string): Promise<void> {
  const { error } = await supabase.from('outreach_messages')
    .update({ message_text: editedText, approved_at: new Date().toISOString() })
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
}

export async function markThreadRead(prospect_id: string): Promise<void> {
  const { error } = await supabase.from('outreach_messages')
    .update({ read_at: new Date().toISOString() })
    .eq('prospect_id', prospect_id).eq('direction', 'inbound').is('read_at', null)
  if (error) throw error
}
