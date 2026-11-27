// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import { msg, threads } from './fixtures'
import { ReferralCard } from './ReferralCard'
import { referralWaitText } from '../../lib/dmReferral'

const readWait = vi.hoisted(() => vi.fn())
const eq = vi.hoisted(() => vi.fn())
vi.mock('../../lib/supabase', () => ({ supabase: { from: (table: string) => ({ select: () => ({ eq: (col: string, v: string) => { eq(table, col, v); return { maybeSingle: readWait } } }) }) } }))

// Invented people only (public repo).
const lead = (p: Record<string, unknown> = {}) => threads([msg({ id: 'note1', prospect_id: 'dana', prospect_name: 'Dana Example', client_id: 'risedtc', direction: 'outbound', message_type: 'connection_note',
  ai_model: 'inbox_referral_lead_v1', message_text: 'Hey Dana', sent_at: null, approved_at: '2026-11-27T10:00:00Z',
  draft_evidence: { referrer_prospect_id: 'rory', referrer_name: 'Rory Sample' } as never, ...p })])[0]

beforeEach(() => { cleanup(); vi.clearAllMocks() })
describe('referral invite note waiting on the seat limit', () => {
  it('says in plain words that the note waits for the invite limit on the seat', async () => {
    readWait.mockResolvedValue({ data: { reason: 'primary_share_floor', detail: { approved_at: '2026-11-27T10:00:00Z', primary_sent: 3, secondary_reserved: 1 }, seen_at: '2026-11-27T10:04:00Z' }, error: null })
    render(<ReferralCard t={lead()} />)
    expect(await screen.findByRole('status')).toHaveTextContent("Waiting for today's invite limit on Mattan's seat.")
    expect(eq).toHaveBeenCalledWith('inbox_referral_send_waits', 'message_id', 'note1')
  })
  it('stays silent for a wait decided for another approval, even when stamped after this one', async () => {
    readWait.mockResolvedValue({ data: { reason: 'daily_cap', detail: { approved_at: '2026-11-27T09:59:00Z' }, seen_at: '2026-11-27T10:01:02Z' }, error: null })
    render(<ReferralCard t={lead()} />)
    await waitFor(() => expect(readWait).toHaveBeenCalled())
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
  it('does not read a wait for a note that is unapproved, sent or held', () => {
    render(<ReferralCard t={lead({ approved_at: null })} />)
    cleanup()
    render(<ReferralCard t={lead({ sent_at: '2026-11-27T11:00:00Z' })} />)
    cleanup()
    render(<ReferralCard t={lead({ send_blocked_at: '2026-11-27T11:00:00Z', send_blocked_reason: 'rise_prior_invitation' })} />)
    expect(readWait).not.toHaveBeenCalled()
  })
  it('a failed read shows nothing and breaks nothing', async () => {
    readWait.mockRejectedValue(new Error('offline'))
    render(<ReferralCard t={lead()} />)
    await waitFor(() => expect(readWait).toHaveBeenCalled())
    expect(screen.getByRole('link', { name: 'Rory Sample' })).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
  it('words each sender reason plainly', () => {
    const w = (reason: string) => referralWaitText({ reason, detail: { approved_at: '2026-11-27T10:00:00.000Z' }, seen_at: '2026-11-27T10:05:00Z' }, '2026-11-27T10:00:00Z', 'Mattan', 'Dana')
    expect(w('daily_cap')).toMatch(/today's invites are used up/)
    expect(w('outside_warsaw_window')).toMatch(/invite hours on Mattan's seat/)
    expect(w('rise_invite_refused_cooldown')).toMatch(/refused an invite to Dana recently/)
    expect(w('something_new')).toMatch(/waiting to send \(something_new\)/)
    expect(w('daily_cap')).toMatch(/Last checked \d\d:\d\d\.$/)
    expect(referralWaitText(null, '2026-11-27T10:00:00Z', 'Mattan', 'Dana')).toBeNull()
    expect(referralWaitText({ reason: 'daily_cap', detail: null, seen_at: '2026-11-27T10:05:00Z' }, '2026-11-27T10:00:00Z', 'Mattan', 'Dana')).toBeNull()
  })
  it('picks up a wait the sender records after the card opened', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      readWait.mockResolvedValueOnce({ data: null, error: null })
        .mockResolvedValue({ data: { reason: 'daily_cap', detail: { approved_at: '2026-11-27T10:00:00Z' }, seen_at: '2026-11-27T10:03:00Z' }, error: null })
      render(<ReferralCard t={lead()} />)
      await waitFor(() => expect(readWait).toHaveBeenCalledTimes(1))
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
      await vi.advanceTimersByTimeAsync(60000)
      expect(await screen.findByRole('status')).toHaveTextContent("today's invites are used up")
    } finally { vi.useRealTimers() }
  })
})
