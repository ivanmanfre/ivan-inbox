// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { act, render, screen, waitFor, cleanup } from '@testing-library/react'
import { msg, threads } from './fixtures'
import { ReferralCard } from './ReferralCard'

const readLead = vi.hoisted(() => vi.fn())
vi.mock('../../lib/supabase', () => ({ supabase: { from: () => ({ select: () => ({ eq: () => ({ single: readLead }) }) }), auth: { getSession: async () => ({ data: { session: { access_token: 'owner-token' } } }) } } }))
const fetch = vi.fn()

beforeEach(() => { cleanup(); vi.clearAllMocks(); vi.stubGlobal('fetch', fetch); window.fetch = fetch })
// Invented fixtures (public repo): a referrer at a made-up studio points the author to a made-up colleague.
describe('a referral card that moves seats', () => {
  const HANDOFF = '0b5a3d0e-1111-4c2a-9a55-000000000001'
  const base = { prospect_id: 'priya', prospect_name: 'Priya Example', prospect_company: 'Northwind Games', client_id: 'arch' }
  const rows = () => threads([
    msg({ ...base, id: 'pitch', direction: 'outbound', message_text: 'Are you running creator campaigns?', sent_at: '2026-11-05T12:00:00Z', created_at: '2026-11-05T12:00:00Z' }),
    msg({ ...base, id: HANDOFF, direction: 'inbound', message_text: 'You could contact Tomas Weller, he is the influencer manager here', sent_at: '2026-11-05T12:10:00Z', created_at: '2026-11-05T12:10:00Z' }),
    msg({ ...base, id: 'ack', direction: 'outbound', message_text: "Thanks Priya, I'll reach out to Tomas.", sent_at: '2026-11-05T12:20:00Z', created_at: '2026-11-05T12:20:00Z' }),
    msg({ ...base, id: 'later-1', direction: 'inbound', message_text: 'You too!', sent_at: '2026-11-05T12:30:00Z', created_at: '2026-11-05T12:30:00Z' }),
  ])[0]
  const stored = { status: 'verified', input_message_id: HANDOFF, name: 'Tomas Weller', company: 'Northwind Games', role: 'Influencer Manager', summary: 'Influencer Manager at Northwind Games.',
    linkedin_url: 'https://www.linkedin.com/in/tomas-weller-test', draft: 'Hey Tomas\n\nPriya said you run creator campaigns at Northwind.\n\nWhat do you measure them on?', reason: null, sources: [],
    revision: 13, seat: 'arch', story_key: 'story-v1', later: { through_message_id: 'later-1', message_ids: ['later-1'], verdict: 'go', quote: null, checked_at: '2026-11-05T12:31:00Z' } }
  const inmailStored = { ...stored, inmail: { subject: 'ARCH x Northwind', body: "Hey Tomas\n\nPriya pointed me to you for creator campaigns.\n\nI'm Davorin, founder of ARCH.\n\nAre you open to an intro chat next Monday?" },
    inmail_route: { channel: 'inmail', credits: 12, open_profile: null, why: "Davorin's seat has 12 Sales Navigator InMail credits.", checked_at: '2026-11-05T12:31:00Z' } }
  it('a lookup still running for ARCH never answers the card after the thread moves to RISE (Sol r4)', async () => {
    let finishArch!: (response: unknown) => void
    const waitingArch = new Promise(resolve => { finishArch = resolve })
    const riseDraft = { ...stored, seat: 'risedtc' }
    readLead.mockResolvedValueOnce({ data: { referral: inmailStored }, error: null })
      .mockResolvedValueOnce({ data: { referral: riseDraft }, error: null })
    fetch.mockReturnValueOnce(waitingArch)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ referral: riseDraft }) })
    const view = render(<ReferralCard t={rows()} />)
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    const rise = rows()
    rise.client_id = 'risedtc'
    await act(async () => { view.rerender(<ReferralCard t={rise} />) })
    expect(readLead).toHaveBeenCalledTimes(2)
    await act(async () => finishArch({ ok: true, json: async () => ({ referral: inmailStored }) }))
    // The RISE card runs its own lookup and shows the RISE draft (a note), never the ARCH InMail.
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    expect(await screen.findByRole('textbox', { name: 'DM draft for Tomas Weller' })).toHaveValue(riseDraft.draft)
    expect(screen.queryByRole('textbox', { name: 'InMail draft for Tomas Weller' })).not.toBeInTheDocument()
    expect(screen.queryByText(/Davorin's seat/)).not.toBeInTheDocument()
  })
})
