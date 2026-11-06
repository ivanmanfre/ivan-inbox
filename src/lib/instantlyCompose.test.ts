import { describe, expect, it } from 'vitest'
import { canComposeEmail, instantlyMailbox, threadEmailSender, type InboxMessage, type Thread } from './inbox'
import { defaultEmailSignature, stripLegacyEmailSignature, renderEmailDocument } from './emailRichText'

const row = (over: Partial<InboxMessage>): InboxMessage => ({ id: 'x', prospect_id: 'p', direction: 'inbound', channel: 'email', message_text: 'hi', sent_at: '2026-11-06T14:48:46Z', created_at: '2026-11-06T14:48:46Z', client_id: 'ivan', ...over } as InboxMessage)
const thread = (client_id: string, messages: InboxMessage[]) => ({ client_id, messages } as unknown as Thread)
const instantly = { source: 'instantly', our_mailbox: 'ivan@inboundonsteroidshq.com', instantly_email_id: '01a1b155-95c7-7999-9c8e-3d938b17cad0', campaign_id: '5f5e6641-bd10-4f41-be99-9281628320c4' }

describe('Ivan Instantly email threads (Mark Woodcock, 2026-11-06)', () => {
  it('compose opens and replies leave from the Instantly mailbox', () => {
    const t = thread('ivan', [row({ draft_evidence: { email: instantly } as InboxMessage['draft_evidence'] })])
    expect(instantlyMailbox(t)).toBe('ivan@inboundonsteroidshq.com')
    expect(canComposeEmail(t)).toBe(true)
    expect(threadEmailSender(t)).toBe('ivan@inboundonsteroidshq.com')
  })
  it('a Gmail-era Ivan email thread stays draft-approval only', () => {
    const t = thread('ivan', [row({ draft_evidence: { email: { from: 'a@b.com' } } as InboxMessage['draft_evidence'] })])
    expect(canComposeEmail(t)).toBe(false)
    expect(threadEmailSender(t)).toBe('im@ivanmanfredi.com')
  })
  it('never for another seat, even with an Instantly row', () => {
    expect(canComposeEmail(thread('risedtc', [row({ client_id: 'risedtc', draft_evidence: { email: instantly } as InboxMessage['draft_evidence'] })]))).toBe(false)
  })
  it('signs off "Iván" like the campaign email, and never twice', () => {
    expect(renderEmailDocument(defaultEmailSignature('ivan@inboundonsteroidshq.com')!).text.trim()).toBe('Iván')
    expect(stripLegacyEmailSignature('Hey Mark\n\nHere it is.\n\nIvan', 'ivan@tryinboundonsteroids.com')).toBe('Hey Mark\n\nHere it is.')
    expect(defaultEmailSignature('im@ivanmanfredi.com')).toBeNull()
  })
})

describe('sol r1 fixes', () => {
  it('an Instantly row outside the sender allowlist does not open compose', () => {
    const t = thread('ivan', [row({ draft_evidence: { email: { ...instantly, campaign_id: '00000000-0000-0000-0000-000000000000' } } as InboxMessage['draft_evidence'] })])
    expect(canComposeEmail(t)).toBe(false)
  })
})

describe('sol r2 fix', () => {
  it('a drafter Instantly reply shows its mailbox as From, so the editor signs "Iván"', async () => {
    const { emailDetails } = await import('./emailPresentation')
    const draft = row({ direction: 'outbound', sent_at: null, recipient_email: 'mark@bigfootdigital.co.uk', message_text: 'Hey Mark',
      draft_evidence: { instantly_reply: { eaccount: 'ivan@inboundonsteroidshq.com' } } as InboxMessage['draft_evidence'] })
    expect(emailDetails(draft).from).toBe('ivan@inboundonsteroidshq.com')
    expect(renderEmailDocument(defaultEmailSignature(emailDetails(draft).from!)!).text.trim()).toBe('Iván')
  })
})
