// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react'
import { msg, threads } from './fixtures'
import { ReferralCard } from './ReferralCard'
import { isConversation } from '../../lib/inbox'

const readLead = vi.hoisted(() => vi.fn())
vi.mock('../../lib/supabase', () => ({ supabase: { from: () => ({ select: () => ({ eq: () => ({ single: readLead }) }) }), auth: { getSession: async () => ({ data: { session: { access_token: 'owner-token' } } }) } } }))
const fetch = vi.fn()
const referral = { status: 'verified', input_message_id: 'handoff', name: 'Ben Patton', company: 'Saint Spritz', role: 'CEO', summary: 'CEO at Saint Spritz.', linkedin_url: 'https://www.linkedin.com/in/ben-patton-9834411aa', draft: 'Hey Ben, Mallory said you handle paid growth at Saint Spritz. Want me to send you the growth scan?', reason: null, sources: [{ title: 'Saint Spritz', url: 'https://www.linkedin.com/company/saint-spritz' }] }
const thread = () => threads([msg({ id: 'handoff', prospect_id: 'mallory', prospect_name: 'Mallory Vaughan Patton', prospect_company: 'Saint Spritz', client_id: 'risedtc', direction: 'inbound', message_text: 'ben Patton does that side of biz', sent_at: '2026-10-05T22:45:00Z' })])[0]

beforeEach(() => { cleanup(); vi.clearAllMocks(); vi.stubGlobal('fetch', fetch); window.fetch = fetch })
describe('referral card', () => {
  it('keeps an explicitly created referral lead in the inbox after its first outbound send', () => {
    const t = threads([msg({ prospect_id: 'alicia', direction: 'outbound', ai_model: 'arch_referral_package_v1', message_type: 'inmail', message_text: 'Sent introduction', sent_at: '2026-10-12T01:00:00Z', created_at: '2026-10-12T01:00:00Z' })])[0]
    expect(isConversation(t)).toBe(true)
    const ordinary = threads([msg({ prospect_id: 'ordinary', direction: 'outbound', ai_model: 'campaign', message_text: 'Sent cold DM', sent_at: '2026-10-12T01:00:00Z', created_at: '2026-10-12T01:00:00Z' })])[0]
    expect(isConversation(ordinary)).toBe(false)
  })
  it('shows the actual sent InMail and no repeat-copy action for that introduction', async () => {
    const t = threads([msg({ prospect_id: 'alicia', direction: 'outbound', ai_model: 'arch_referral_package_v1', message_type: 'inmail', message_text: 'The introduction actually sent.', sent_at: '2026-10-12T01:00:00Z', created_at: '2026-10-12T01:00:00Z' })])[0]
    readLead.mockResolvedValue({ data: { email: null, enrichment_data: { channel_drafts: { inmail: { subject: 'Intro', body: 'Older draft.' } }, referral_followup: { status: 'waiting_due', due_at: '2026-10-15T01:00:00Z' } } }, error: null })
    render(<ReferralCard t={t} />)
    expect(await screen.findByRole('textbox', { name: 'InMail sent message' })).toHaveValue('The introduction actually sent.')
    expect(screen.queryByRole('button', { name: 'Copy InMail' })).not.toBeInTheDocument()
    expect(screen.getByText(/Due/)).toHaveTextContent('15/10/2026')
  })
  it('shows the full channel package in the referred person’s own thread without an inbound or send action', async () => {
    const t = threads([msg({ prospect_id: 'alicia', prospect_name: 'Alicia Yingru WANG', client_id: 'arch', direction: 'outbound', ai_model: 'arch_referral_package_v1', message_text: 'Invite draft', sent_at: null })])[0]
    readLead.mockResolvedValue({ data: { email: null, enrichment_data: {
      referral: { referrer_name: 'Ismail Görkem Yeni', referrer_prospect_id: '6dabd628-8b85-403d-88c1-40b61a1dcd4c', identity_warning: 'Ismail named Alicia Yang; the profile says WANG.' },
      channel_drafts: { connection_request: { note: 'Ismail suggested I connect.' }, inmail: { subject: 'Intro', body: 'Creator campaigns for MWM.' }, email: { subject: 'ARCH. x MWM', body: 'Full introduction with case studies.' } },
      referral_followup: { status: 'waiting_first_send', delay_days: 3 },
    } }, error: null })
    render(<ReferralCard t={t} />)
    expect(await screen.findByRole('textbox', { name: 'Connection request draft' })).toHaveValue('Ismail suggested I connect.')
    expect(screen.getByRole('textbox', { name: 'InMail draft' })).toHaveValue('Subject: Intro\n\nCreator campaigns for MWM.')
    expect(screen.getByRole('textbox', { name: 'Email draft' })).toHaveValue('Subject: ARCH. x MWM\n\nFull introduction with case studies.')
    expect(screen.getByText(/Ismail named Alicia Yang/)).toBeInTheDocument()
    expect(screen.getByText(/3 days after the first sent touch/)).toBeInTheDocument()
    expect(screen.getByText('Email address pending verification.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ismail Görkem Yeni' })).toHaveAttribute('href', '#exp/d/dms?thread=6dabd628-8b85-403d-88c1-40b61a1dcd4c')
    expect(screen.queryByRole('button', { name: /^send|^approve/i })).not.toBeInTheDocument()
    expect(fetch).not.toHaveBeenCalled()
  })
  it('links the referrer’s research to the referred person’s own lead', async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => ({ referral: { ...referral, lead_prospect_id: '5913d09d-5112-403f-b8c5-dcae3ff8caf0' } }) })
    render(<ReferralCard t={thread()} />)
    expect(await screen.findByRole('link', { name: 'Open referred lead' })).toHaveAttribute('href', '#exp/d/dms?thread=5913d09d-5112-403f-b8c5-dcae3ff8caf0')
    expect(screen.queryByRole('textbox', { name: 'DM draft for Ben Patton' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Copy DM' })).not.toBeInTheDocument()
  })
  it('does not offer the acknowledgement again after an actual reply was sent to the referrer', async () => {
    const t = thread()
    t.messages.push(msg({ prospect_id: 'mallory', direction: 'outbound', message_text: "Thanks, I'll reach out.", sent_at: '2026-10-06T10:00:00Z', created_at: '2026-10-06T10:00:00Z' }))
    fetch.mockResolvedValue({ ok: true, json: async () => ({ referral: { ...referral, acknowledgement: "Thanks Mallory, I'll reach out to Ben.", lead_prospect_id: '5913d09d-5112-403f-b8c5-dcae3ff8caf0' } }) })
    render(<ReferralCard t={t} />)
    await screen.findByRole('link', { name: 'Open referred lead' })
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Use acknowledgement' })).not.toBeInTheDocument()
  })
  it('keeps one acknowledgement when the referrer already has a pending reply in the normal draft box', async () => {
    const t = threads([...thread().messages, msg({ prospect_id: 'mallory', direction: 'outbound', message_text: "Thanks, I'll reach out to Ben.", sent_at: null, created_at: '2026-10-06T10:00:00Z' })])[0]
    fetch.mockResolvedValue({ ok: true, json: async () => ({ referral: { ...referral, acknowledgement: "Thanks Mallory, I'll reach out to Ben.", lead_prospect_id: '5913d09d-5112-403f-b8c5-dcae3ff8caf0' } }) })
    render(<ReferralCard t={t} />)
    await screen.findByRole('link', { name: 'Open referred lead' })
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })
  it('shows Ismail’s acknowledgement even while Alicia’s profile is unresolved', async () => {
    const t = thread(); t.prospect_name = 'Ismail Görkem Yeni'; t.client_id = 'arch'
    t.messages[0].message_text = 'Would you mind reaching out to Alicia Yang, she is running the UGC marketing on our side.'
    const acknowledgement = "Thanks Ismail, I'll reach out to Alicia."
    fetch.mockResolvedValue({ ok: true, json: async () => ({ referral: { ...referral, status: 'unresolved', name: 'Alicia Yang', draft: null, linkedin_url: null, acknowledgement, reason: 'Profile could not be verified.' } }) })
    const useAcknowledgement = vi.fn()
    render(<ReferralCard t={t} onUseAcknowledgement={useAcknowledgement} />)
    expect(await screen.findByRole('textbox', { name: 'Acknowledgement draft for Ismail Görkem Yeni' })).toHaveValue(acknowledgement)
    fireEvent.click(screen.getByRole('button', { name: 'Use acknowledgement' }))
    expect(useAcknowledgement).toHaveBeenCalledWith(acknowledgement)
    expect(screen.queryByRole('link', { name: 'Open LinkedIn profile' })).not.toBeInTheDocument()
  })
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
  it('shows a researched candidate as tentative with a draft for review', async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => ({ referral: { ...referral, status: 'unresolved', draft: null, linkedin_url: null, reason: 'The surname differs. Check the contact.', candidate: { name: 'Alicia Yingru WANG', linkedin_url: 'https://www.linkedin.com/in/wang-alicia-yingru', summary: 'UGC Manager at MWM.', draft: 'Hey Alicia, Ismail said you handle UGC marketing at MWM. Would you be open to discussing your creator campaigns?', sources: [] } } }) })
    render(<ReferralCard t={thread()} />)
    expect((await screen.findByRole('textbox', { name: 'DM draft for Alicia Yingru WANG' }) as HTMLTextAreaElement).value).toContain('Hey Alicia')
    expect(screen.getByText('Possible match: Alicia Yingru WANG')).toBeInTheDocument()
    expect(screen.getByText('The surname differs. Check the contact.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^send/i })).not.toBeInTheDocument()
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
