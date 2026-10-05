// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react'
import { msg, threads } from './fixtures'
import { ReferralCard } from './ReferralCard'

vi.mock('../../lib/supabase', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'owner-token' } } }) } } }))
const fetch = vi.fn()
const referral = { status: 'verified', input_message_id: 'handoff', name: 'Ben Patton', company: 'Saint Spritz', role: 'CEO', summary: 'CEO at Saint Spritz.', linkedin_url: 'https://www.linkedin.com/in/ben-patton-9834411aa', draft: 'Hey Ben, Mallory said you handle paid growth at Saint Spritz. Want me to send you the growth scan?', reason: null, sources: [{ title: 'Saint Spritz', url: 'https://www.linkedin.com/company/saint-spritz' }] }
const thread = () => threads([msg({ id: 'handoff', prospect_id: 'mallory', prospect_name: 'Mallory Vaughan Patton', prospect_company: 'Saint Spritz', client_id: 'risedtc', direction: 'inbound', message_text: 'ben Patton does that side of biz', sent_at: '2026-10-05T22:45:00Z' })])[0]

beforeEach(() => { cleanup(); vi.clearAllMocks(); vi.stubGlobal('fetch', fetch); window.fetch = fetch })
describe('referral card', () => {
  it('automatically researches a named handoff and keeps its DM addressed to Ben', async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => ({ referral }) })
    render(<ReferralCard t={thread()} />)
    expect(screen.getByRole('status')).toHaveTextContent(/researching/i)
    expect(await screen.findByRole('textbox', { name: 'DM draft for Ben Patton' })).toHaveValue(referral.draft)
    expect(screen.getByRole('link', { name: 'Open LinkedIn profile' })).toHaveAttribute('href', referral.linkedin_url)
    expect(screen.getByRole('link', { name: 'Saint Spritz' })).toHaveAttribute('href', referral.sources[0].url)
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ prospect_id: 'mallory', mode: 'referral', retry: false })
    expect(screen.queryByRole('button', { name: /^send/i })).not.toBeInTheDocument()
  })
  it('surfaces an uncertain match with no DM or profile action', async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => ({ referral: { ...referral, status: 'unresolved', draft: null, linkedin_url: null, reason: 'Several Ben Pattons match.' } }) })
    render(<ReferralCard t={thread()} />)
    expect(await screen.findByText('Several Ben Pattons match.')).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Open LinkedIn profile' })).not.toBeInTheDocument()
  })
  it('offers a retry when search fails', async () => {
    fetch.mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'Research timed out.' }) }).mockResolvedValueOnce({ ok: true, json: async () => ({ referral }) })
    render(<ReferralCard t={thread()} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Research timed out.')
    fireEvent.click(screen.getByRole('button', { name: 'Retry research' }))
    await screen.findByRole('textbox')
    expect(JSON.parse(fetch.mock.calls[1][1].body).retry).toBe(true)
  })
  it('does not research a closed or spam thread', async () => {
    render(<ReferralCard t={{ ...thread(), blacklisted: true }} />)
    await waitFor(() => expect(fetch).not.toHaveBeenCalled())
  })
  it('ignores ordinary inbound replies', async () => {
    const t = thread(); t.messages[0].message_text = 'No thanks'
    render(<ReferralCard t={t} />)
    await waitFor(() => expect(fetch).not.toHaveBeenCalled())
  })
})
