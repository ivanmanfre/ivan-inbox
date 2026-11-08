// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, cleanup } from '@testing-library/react'
import { msg, threads } from './fixtures'

const stage = vi.hoisted(() => vi.fn())
vi.mock('../../lib/supabase', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'owner-token' } } }) } } }))
vi.mock('../../lib/dmReferral', async importOriginal => ({ ...(await importOriginal<typeof import('../../lib/dmReferral')>()), stageReferralEmail: stage }))
import { ReferralCard } from './ReferralCard'
import { REFERRAL_EMAIL_MODEL } from '../../lib/dmReferral'

const fetch = vi.fn()
const text = "Yes, it's handled by the Gambit team. You can contact Guillaume or Laurène for any inquiries. :) guillaume@gambitdigital.ca laurene@gambitdigital.ca"
const handoff = msg({ id: 'handoff', prospect_id: 'elea', prospect_name: 'Éléa G.', prospect_company: 'Panache Jeux Numériques', client_id: 'arch', direction: 'inbound', message_text: text, sent_at: '2026-11-05T17:13:25Z', created_at: '2026-11-05T17:15:29Z' })
const email = { to: 'guillaume@gambitdigital.ca', cc: ['laurene@gambitdigital.ca'], subject: 'Éléa from Panache pointed me your way', body: 'Hi Guillaume\n\nÉléa said you handle creator work for Panache.\n\nDavorin' }
const referral = { status: 'unresolved', input_message_id: 'handoff', name: 'Guillaume', company: 'Gambit Digital', role: null, linkedin_url: null, summary: null, draft: null, sources: [], revision: 8,
  reason: 'No single LinkedIn profile named Guillaume with a current Gambit Digital role was found.', acknowledgement: "Thanks Éléa, I'll reach out to Guillaume.", email, email_reason: null }

beforeEach(() => { cleanup(); vi.clearAllMocks(); window.fetch = fetch; fetch.mockResolvedValue({ ok: true, json: async () => ({ referral }) }) })
describe('referral email on the card (Éléa G. -> Gambit)', () => {
  it('shows the editable email from the seat sender and stages the reviewed copy', async () => {
    const onStaged = vi.fn()
    stage.mockResolvedValue(undefined)
    render(<ReferralCard t={threads([handoff])[0]} onStaged={onStaged} />)
    expect(await screen.findByRole('textbox', { name: 'Referral email To' })).toHaveValue('guillaume@gambitdigital.ca')
    expect(screen.getByRole('textbox', { name: 'Referral email Cc' })).toHaveValue('laurene@gambitdigital.ca')
    expect(screen.getByText(/From davorin@madebyarch.com/)).toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox', { name: 'Email draft for Guillaume' }), { target: { value: 'Hi Guillaume\n\nEdited.\n\nDavorin' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Referral email Cc' }), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add email to draft' }))
    expect(await screen.findByText(/is in the draft below/)).toBeInTheDocument()
    expect(stage).toHaveBeenCalledWith(expect.objectContaining({ prospect_id: 'elea' }), expect.objectContaining({ id: 'handoff' }),
      { to: 'guillaume@gambitdigital.ca', cc: [], subject: email.subject, body: 'Hi Guillaume\n\nEdited.\n\nDavorin' }, 'Guillaume', 'Gambit Digital')
    expect(onStaged).toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: /^send|^approve/i })).not.toBeInTheDocument()
  })
  it('does not offer the email again once it is staged', async () => {
    const staged = msg({ prospect_id: 'elea', client_id: 'arch', direction: 'outbound', channel: 'email', ai_model: REFERRAL_EMAIL_MODEL, recipient_email: 'guillaume@gambitdigital.ca', message_text: 'Subject: x\n\nHi', sent_at: null, approved_at: null, created_at: '2026-11-05T19:30:00Z' })
    render(<ReferralCard t={threads([handoff, staged])[0]} />)
    expect(await screen.findByText(/The email to Guillaume is in the draft below/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add email to draft' })).not.toBeInTheDocument()
  })
  it('does not offer a second email when the lane reply draft already emails that address (Yossi -> miad@, 2026-11-08)', async () => {
    const reply = msg({ prospect_id: 'elea', client_id: 'arch', direction: 'outbound', channel: 'linkedin', ai_model: 'arch_reply_draft_v2', recipient_email: 'Guillaume@gambitdigital.ca', message_text: "Thanks Éléa, I'll reach out to Guillaume.", sent_at: null, approved_at: null, created_at: '2026-11-05T17:20:00Z' })
    render(<ReferralCard t={threads([handoff, reply])[0]} />)
    expect(await screen.findByText('The reply draft below already emails guillaume@gambitdigital.ca.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add email to draft' })).not.toBeInTheDocument()
  })
  it('offers the email when the lane reply draft that emailed them was discarded', async () => {
    const reply = msg({ prospect_id: 'elea', client_id: 'arch', direction: 'outbound', channel: 'linkedin', ai_model: 'arch_reply_draft_v2', recipient_email: 'guillaume@gambitdigital.ca', message_text: 'x', sent_at: null, approved_at: null, send_blocked_reason: 'discarded_in_inbox', send_blocked_at: '2026-11-05T17:30:00Z', created_at: '2026-11-05T17:20:00Z' })
    render(<ReferralCard t={threads([handoff, reply])[0]} />)
    expect(await screen.findByRole('button', { name: 'Add email to draft' })).toBeInTheDocument()
  })
  it('offers it again after the staged copy was discarded', async () => {
    const gone = msg({ prospect_id: 'elea', client_id: 'arch', direction: 'outbound', channel: 'email', ai_model: REFERRAL_EMAIL_MODEL, recipient_email: 'guillaume@gambitdigital.ca', message_text: 'Subject: x\n\nHi', sent_at: null, approved_at: null, send_blocked_reason: 'discarded_in_inbox', send_blocked_at: '2026-11-05T19:35:00Z', created_at: '2026-11-05T19:30:00Z' })
    render(<ReferralCard t={threads([handoff, gone])[0]} />)
    expect(await screen.findByRole('button', { name: 'Add email to draft' })).toBeInTheDocument()
  })
  it('brings the form back on the same card after the staged email is discarded', async () => {
    stage.mockResolvedValue(undefined)
    const staged = msg({ id: 'em', prospect_id: 'elea', client_id: 'arch', direction: 'outbound', channel: 'email', ai_model: REFERRAL_EMAIL_MODEL, recipient_email: 'guillaume@gambitdigital.ca', message_text: 'Subject: x\n\nHi', sent_at: null, approved_at: null, created_at: '2026-11-05T19:30:00Z' })
    const view = render(<ReferralCard t={threads([handoff])[0]} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Add email to draft' }))
    await screen.findByText(/is in the draft below/)
    view.rerender(<ReferralCard t={threads([handoff, staged])[0]} />)
    view.rerender(<ReferralCard t={threads([handoff, { ...staged, send_blocked_reason: 'discarded_in_inbox', send_blocked_at: '2026-11-05T19:35:00Z' }])[0]} />)
    expect(await screen.findByRole('button', { name: 'Add email to draft' })).toBeInTheDocument()
  })
  it('shows a stage failure and keeps the button', async () => {
    stage.mockRejectedValue(new Error('This email is already in the draft. Refresh the conversation.'))
    render(<ReferralCard t={threads([handoff])[0]} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Add email to draft' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('already in the draft')
    expect(screen.getByRole('button', { name: 'Add email to draft' })).toBeInTheDocument()
  })
})
