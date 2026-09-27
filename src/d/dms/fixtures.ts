// Test fixtures for the DMs page: real InboxMessage rows grouped by TODAY'S groupThreads,
// so every test exercises the same rules the page runs on live data.
import { groupThreads, type InboxMessage, type Thread } from '../../lib/inbox'

export const NOW = Date.parse('2026-09-27T09:15:00Z')

let seq = 0
export function msg(p: Partial<InboxMessage> & { prospect_id: string }): InboxMessage {
  seq += 1
  return {
    id: `m${seq}`, direction: 'outbound', message_text: 'hello', message_type: 'dm', channel: 'linkedin',
    sent_at: null, approved_at: null, read_at: null, created_at: '2026-09-26T10:00:00Z',
    send_blocked_at: null, send_blocked_reason: null, unipile_chat_id: null, ai_model: null,
    prospect_name: 'Person', prospect_company: 'Co', prospect_headline: null, prospect_stage: 'replied',
    prospect_email: null, profile_photo_url: null, prospect_linkedin_url: null, chat_provider_id: null,
    campaign_name: 'c', client_id: 'ivan', snoozed_until: null, snoozed_at: null,
    ...p,
  }
}

const H = 3_600_000
export const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString()

/** A thread whose person wrote last `hoursAgo` and carries a pending draft. */
export function drafted(pid: string, who: Partial<InboxMessage>, hoursAgo = 5): InboxMessage[] {
  return [
    msg({ prospect_id: pid, ...who, direction: 'outbound', sent_at: iso((hoursAgo + 24) * H), created_at: iso((hoursAgo + 24) * H), message_text: 'Hi there' }),
    msg({ prospect_id: pid, ...who, direction: 'inbound', sent_at: iso(hoursAgo * H), created_at: iso(hoursAgo * H), message_text: 'Sounds good, tell me more about pricing?' }),
    msg({ prospect_id: pid, ...who, direction: 'outbound', created_at: iso((hoursAgo - 1) * H), message_text: 'Happy to.\n\nHere is how it works.' }),
  ]
}

/** Owed with no draft. */
export function owedNoDraft(pid: string, who: Partial<InboxMessage>, hoursAgo = 30): InboxMessage[] {
  return drafted(pid, who, hoursAgo).slice(0, 2)
}

/** We wrote last; nothing owed. */
export function waiting(pid: string, who: Partial<InboxMessage>, hoursAgo = 10): InboxMessage[] {
  return [
    msg({ prospect_id: pid, ...who, direction: 'inbound', sent_at: iso((hoursAgo + 20) * H), created_at: iso((hoursAgo + 20) * H), message_text: 'What is this about?' }),
    msg({ prospect_id: pid, ...who, direction: 'outbound', sent_at: iso(hoursAgo * H), created_at: iso(hoursAgo * H), message_text: 'Here you go' }),
  ]
}

export function threads(rows: InboxMessage[]): Thread[] {
  return groupThreads(rows, new Set(), NOW)
}
