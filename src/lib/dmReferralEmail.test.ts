import { beforeEach, describe, expect, it, vi } from 'vitest'

const rows = vi.hoisted(() => ({ existing: [] as unknown[], inserted: [] as Record<string, unknown>[] }))
vi.mock('./supabase', () => ({ supabase: { from: (table: string) => {
  // Staging touches outreach_messages only; any other table is a side effect this change must not have.
  if (table !== 'outreach_messages') throw new Error(`unexpected table ${table}`)
  return {
    select: () => ({ eq: () => ({ eq: async () => ({ data: rows.existing, error: null }) }) }),
    insert: async (row: Record<string, unknown>) => { rows.inserted.push(row); return { error: null } },
  }
} } }))
import { REFERRAL_EMAIL_MODEL, referralEmailRow, stageReferralEmail } from './dmReferral'
import type { Thread } from './inbox'

const t = { prospect_id: 'elea', prospect_name: 'Éléa G.', client_id: 'arch', messages: [] } as unknown as Thread
const inbound = { id: 'handoff', sent_at: '2026-11-05T17:13:25Z', created_at: '2026-11-05T17:15:29Z' }
const email = { to: 'guillaume@gambitdigital.ca', cc: ['laurene@gambitdigital.ca'], subject: 'Éléa from Panache pointed me your way', body: 'Hi Guillaume\n\nÉléa said you handle creator work for Panache.\n\nDavorin' }

beforeEach(() => { rows.existing = []; rows.inserted = [] })
describe('referral email staging', () => {
  it('writes one unapproved email draft on the referrer thread, addressed to the referred person', async () => {
    await stageReferralEmail(t, inbound, email, 'Guillaume')
    expect(rows.inserted).toHaveLength(1)
    expect(rows.inserted[0]).toMatchObject({ prospect_id: 'elea', direction: 'outbound', channel: 'email', message_type: 'email', ai_model: REFERRAL_EMAIL_MODEL,
      recipient_email: 'guillaume@gambitdigital.ca', approved_at: null, sent_at: null,
      message_text: `Subject: ${email.subject}\n\n${email.body}`,
      draft_evidence: { email_subject: email.subject, email_cc: ['laurene@gambitdigital.ca'], referral_input_message_id: 'handoff' } })
  })
  it('an expired or failed copy no longer blocks staging again', async () => {
    rows.existing = [{ ai_model: REFERRAL_EMAIL_MODEL, direction: 'outbound', sent_at: null, approved_at: null, created_at: '2026-11-05T19:30:00Z', send_blocked_reason: 'stale_draft_expired_3d', send_blocked_at: '2026-11-08T19:30:00Z' }]
    await stageReferralEmail(t, inbound, email, 'Guillaume')
    expect(rows.inserted).toHaveLength(1)
  })
  it('refuses a second copy for the same handoff, and allows one again after a discard', async () => {
    rows.existing = [{ ai_model: REFERRAL_EMAIL_MODEL, direction: 'outbound', sent_at: null, created_at: '2026-11-05T19:30:00Z', send_blocked_reason: null }]
    await expect(stageReferralEmail(t, inbound, email, 'Guillaume')).rejects.toThrow(/already in the draft/)
    rows.existing = [{ ai_model: REFERRAL_EMAIL_MODEL, direction: 'outbound', sent_at: null, created_at: '2026-11-05T19:30:00Z', send_blocked_reason: 'discarded_in_inbox', send_blocked_at: '2026-11-05T19:35:00Z' }]
    await stageReferralEmail(t, inbound, email, 'Guillaume')
    expect(rows.inserted).toHaveLength(1)
  })
  it('an email from an older handoff does not count for a newer one', () => {
    expect(referralEmailRow([{ ai_model: REFERRAL_EMAIL_MODEL, direction: 'outbound', sent_at: '2026-10-01T00:00:00Z', created_at: '2026-10-01T00:00:00Z', send_blocked_reason: null, send_blocked_at: null, approved_at: null }], inbound)).toBeNull()
  })
  it('rejects a bad address, a To repeated on Cc, and an empty subject before writing anything', async () => {
    await expect(stageReferralEmail(t, inbound, { ...email, to: 'guillaume@' }, 'Guillaume')).rejects.toThrow(/To address/)
    await expect(stageReferralEmail(t, inbound, { ...email, cc: ['Guillaume@gambitdigital.ca'] }, 'Guillaume')).rejects.toThrow(/also on Cc/)
    await expect(stageReferralEmail(t, inbound, { ...email, subject: ' ' }, 'Guillaume')).rejects.toThrow(/subject/)
    await expect(stageReferralEmail({ ...t, client_id: 'swishdm' } as Thread, inbound, email, 'Guillaume')).rejects.toThrow(/unavailable/)
    expect(rows.inserted).toHaveLength(0)
  })
})
