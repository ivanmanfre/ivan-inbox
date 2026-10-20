// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { msg, threads } from './fixtures'
import { SwishReferral, referralStatus } from './SwishReferral'
import { isConversation } from '../../lib/inbox'

const rows = vi.hoisted(() => ({ prospect: {} as Record<string, unknown>, messages: [] as unknown[] }))
vi.mock('../../lib/supabase', () => ({ supabase: { from: (table: string) => ({ select: () => {
  if (table === 'outreach_prospects') return { eq: () => ({ single: async () => ({ data: { enrichment_data: rows.prospect }, error: null }) }) }
  return { eq: () => ({ eq: async () => ({ data: rows.messages, error: null }) }) }
} }) } }))

const NISHA = '8183f553-51cc-4fae-acf6-2b8ca436df6d'
const junior = () => threads([msg({ prospect_id: 'junior', prospect_name: 'Junior Scott Pence', client_id: 'swishdm', direction: 'inbound', message_text: 'I have left Peace Out. You can reach out to Nisha Shah our marketing manager.', sent_at: '2026-10-19T23:27:44Z' })])[0]
const staged = { status: 'found', name: 'Nisha Shah', person: { name: 'Nisha Shah', title: 'Senior Director, Brand Marketing' }, result: `staged ${NISHA}` }

beforeEach(() => { cleanup(); rows.prospect = {}; rows.messages = [] })
describe('SwishDM referral card', () => {
  it('shows on the referrer thread that the referred person was messaged, with a link to their thread', async () => {
    rows.prospect = { swishdm_referral: staged }
    rows.messages = [
      { message_type: 'inmail', sent_at: '2026-10-20T09:40:10Z', approved_at: '2026-10-20T09:27:08Z', send_blocked_reason: null },
      { message_type: 'connection_note', sent_at: null, approved_at: '2026-10-20T09:27:08Z', send_blocked_reason: null },
    ]
    render(<SwishReferral t={junior()} />)
    expect(await screen.findByRole('link', { name: 'Nisha Shah' })).toHaveAttribute('href', `#exp/d/dms?thread=${NISHA}`)
    expect(screen.getByRole('heading')).toHaveTextContent('Referred to Nisha Shah, Senior Director, Brand Marketing')
    expect(screen.getByRole('status')).toHaveTextContent('InMail sent 20 Oct, 10:40')
  })
  it('shows the referrer on the referred person’s thread', async () => {
    rows.prospect = { referral: { from_prospect_id: 'junior', from_name: 'Junior Scott Pence' } }
    render(<SwishReferral t={junior()} />)
    expect(await screen.findByRole('link', { name: 'Junior Scott Pence' })).toHaveAttribute('href', '#exp/d/dms?thread=junior')
  })
  it('says plainly when nobody was contacted', () => {
    expect(referralStatus({ kind: 'to', name: 'Nisha Shah', title: null, leadId: null, status: 'not_found', result: 'not_found', rows: [] })).toMatch(/Nobody was contacted/)
    expect(referralStatus({ kind: 'to', name: 'Nisha Shah', title: null, leadId: NISHA, status: 'found', result: `staged ${NISHA}`, rows: [] })).toBe('Waiting for the seat check before anything is sent.')
    expect(referralStatus({ kind: 'to', name: 'Nisha Shah', title: null, leadId: NISHA, status: 'found', result: `staged ${NISHA}`, rows: [{ message_type: 'inmail', sent_at: null, approved_at: '2026-10-20T09:27:08Z', send_blocked_reason: null }] })).toBe('Passed the seat check. Queued to send.')
  })
  it('renders nothing on a SwishDM thread without a referral', async () => {
    const { container } = render(<SwishReferral t={junior()} />)
    await new Promise(r => setTimeout(r, 0))
    expect(container).toBeEmptyDOMElement()
  })
  it('keeps the referred lead in the inbox after the first outreach, before any reply', () => {
    const t = threads([msg({ prospect_id: NISHA, client_id: 'swishdm', direction: 'outbound', ai_model: 'swishdm_referral_v1 (template + referrer test)', message_type: 'connection_note', message_text: 'Hey Nisha', sent_at: null })])[0]
    expect(isConversation(t)).toBe(true)
  })
})
