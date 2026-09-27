import { describe, expect, it } from 'vitest'
import { DISCARD_REASON, SPAM_REASON, type InboxMessage } from '../../lib/inbox'
import { seatFilter } from '../seats'
import { countDmSeatFromRows } from './dmDrafts'

// The frame's DM number runs TODAY's rule (groupThreads + threadBucket) on the
// complete threads of the candidates. These fixtures pin what the panel counts.
const NOW = Date.parse('2026-09-27T10:00:00Z')
const H = 3_600_000
const D = 24 * H
const at = (ago: number) => new Date(NOW - ago).toISOString()

let n = 0
function m(p: Partial<InboxMessage> & { prospect_id: string }): InboxMessage {
  n += 1
  return {
    id: `m${n}`, direction: 'outbound', message_text: `text ${n}`, message_type: 'dm', channel: 'linkedin',
    sent_at: null, approved_at: null, read_at: null, created_at: at(2 * H), send_blocked_at: null,
    send_blocked_reason: null, unipile_chat_id: null, ai_model: 'reply_v1', prospect_name: p.prospect_id,
    prospect_company: null, prospect_headline: null, prospect_stage: 'replied', prospect_email: null,
    profile_photo_url: null, campaign_name: 'c', client_id: 'ivan', prospect_linkedin_url: null,
    chat_provider_id: null, snoozed_until: null, snoozed_at: null, ...p,
  }
}
/** A thread where they wrote `replyAgo` ago, after our sent opener. */
function replied(pid: string, replyAgo: number, extra: Partial<InboxMessage> = {}): InboxMessage[] {
  return [
    m({ prospect_id: pid, sent_at: at(replyAgo + D), created_at: at(replyAgo + D), ...extra }),
    m({ prospect_id: pid, direction: 'inbound', message_text: 'Sounds interesting, tell me more about pricing', sent_at: at(replyAgo), created_at: at(replyAgo), ...extra }),
  ]
}

describe('countDmSeatFromRows', () => {
  it('a reply with a fresh draft is a draft for you (and needs you)', () => {
    const rows = [...replied('a', 5 * H), m({ prospect_id: 'a', created_at: at(4 * H) })]
    expect(countDmSeatFromRows(rows, 'ivan', NOW)).toEqual({ drafts: 1, needs: 1 })
  })

  it('an owed reply with no draft needs you but is not a draft', () => {
    expect(countDmSeatFromRows(replied('b', 3 * H), 'ivan', NOW)).toEqual({ drafts: 0, needs: 1 })
  })

  it('a discarded draft is not a draft for you, and the discard answers the thread', () => {
    const rows = [...replied('c', 5 * H), m({ prospect_id: 'c', created_at: at(4 * H), send_blocked_at: at(3 * H), send_blocked_reason: DISCARD_REASON })]
    expect(countDmSeatFromRows(rows, 'ivan', NOW)).toEqual({ drafts: 0, needs: 0 })
  })

  it('a pushed (snoozed) draft stops counting until its date', () => {
    const rows = [...replied('d', 5 * H), m({ prospect_id: 'd', created_at: at(4 * H), snoozed_until: new Date(NOW + 3 * D).toISOString(), snoozed_at: at(H) })]
    expect(countDmSeatFromRows(rows, 'ivan', NOW)).toEqual({ drafts: 0, needs: 0 })
  })

  it('a follow-up draft older than 14 days with nothing owed is backlog, not work', () => {
    const rows = [m({ prospect_id: 'e', sent_at: at(40 * D), created_at: at(40 * D) }), m({ prospect_id: 'e', created_at: at(20 * D), ai_model: 'stall_bump_v2' })]
    expect(countDmSeatFromRows(rows, 'ivan', NOW)).toEqual({ drafts: 0, needs: 0 })
  })

  it('a thread filed as spam never counts', () => {
    const rows = [...replied('f', 5 * H, { prospect_skip_reason: SPAM_REASON }), m({ prospect_id: 'f', created_at: at(4 * H), prospect_skip_reason: SPAM_REASON })]
    expect(countDmSeatFromRows(rows, 'risedtc', NOW)).toEqual({ drafts: 0, needs: 0 })
    expect(countDmSeatFromRows(rows, 'ivan', NOW)).toEqual({ drafts: 0, needs: 0 })
  })

  it('seats are never mixed: a Rise thread counts on Rise only; NULL client is Ivan', () => {
    const rise = [...replied('g', 5 * H, { client_id: 'risedtc' }), m({ prospect_id: 'g', created_at: at(4 * H), client_id: 'risedtc' })]
    const legacy = [...replied('h', 5 * H, { client_id: null as unknown as string }), m({ prospect_id: 'h', created_at: at(4 * H), client_id: null as unknown as string })]
    const rows = [...rise, ...legacy]
    expect(countDmSeatFromRows(rows, 'risedtc', NOW)).toEqual({ drafts: 1, needs: 1 })
    expect(countDmSeatFromRows(rows, 'ivan', NOW)).toEqual({ drafts: 1, needs: 1 })
    expect(countDmSeatFromRows(rows, 'arch', NOW)).toEqual({ drafts: 0, needs: 0 })
  })

  it('an owner question is under Needs you, not a draft', () => {
    const rows = [...replied('i', 5 * H, { client_id: 'arch' }), m({ prospect_id: 'i', client_id: 'arch', created_at: at(4 * H), send_blocked_reason: 'owner_confirmation' })]
    expect(countDmSeatFromRows(rows, 'arch', NOW)).toEqual({ drafts: 0, needs: 1 })
  })

  it('duplicated phantom rows (same text, same instant) count once', () => {
    const d = m({ prospect_id: 'j', created_at: at(4 * H) })
    const rows = [...replied('j', 5 * H), d, { ...d, id: 'dup' }]
    expect(countDmSeatFromRows(rows, 'ivan', NOW)).toEqual({ drafts: 1, needs: 1 })
  })
})

describe('seatFilter', () => {
  it('scopes each seat to its own client ids', () => {
    expect(seatFilter('ivan')).toBe('client_id.is.null,client_id.eq.ivan')
    expect(seatFilter('risedtc')).toBe('client_id.eq.risedtc,client_id.eq.rise')
    expect(seatFilter('arch')).toBe('client_id.eq.arch')
  })
})
