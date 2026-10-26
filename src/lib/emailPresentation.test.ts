import { expect, it } from 'vitest'
import { msg, threads } from '../d/dms/fixtures'
import { emailDetails, emailPreview, hydrateEmailDetails } from './emailPresentation'

it('shows a received subject separately from the exact body and preserves sender and recipients', () => {
  const m = msg({ prospect_id: 'liza', client_id: 'arch', direction: 'inbound', channel: 'email', recipient_email: 'elizaveta.savenkova@zimad.com', message_text: 'Wednesday works.\n\nBest,\nLiza', draft_evidence: { email: { subject: 'Re: Creator campaigns for ZiMAD', from: '"Elizaveta Savenkova" <elizaveta.savenkova@zimad.com>', to: ['davorin@madebyarch.com', 'davorin@madebyarch.com'], cc: ['team@zimad.com'], message_id: '<reply@zimad.com>', references: '<intro@arch.com>' } } })
  expect(emailDetails(m)).toMatchObject({ subject: 'Re: Creator campaigns for ZiMAD', body: 'Wednesday works.\n\nBest,\nLiza', from: 'elizaveta.savenkova@zimad.com', fromName: 'Elizaveta Savenkova', to: ['davorin@madebyarch.com'], cc: ['team@zimad.com'], messageId: '<reply@zimad.com>', references: '<intro@arch.com>' })
})

it('recovers an outgoing subject only from its exact sent mirror body and recipient', () => {
  const mirror = msg({ id: 'dm', prospect_id: 'p', client_id: 'arch', recipient_email: 'liza@zimad.com', email_mirror_text: 'Subject: Creator campaigns for ZiMAD - Arch Intro\n\nHi Liza,\n\nExact sent body.\nDavorin', sent_at: '2026-10-23T13:12:40Z' })
  const sent = msg({ id: 'mail', prospect_id: 'p', client_id: 'arch', channel: 'email', recipient_email: 'liza@zimad.com', message_text: 'Hi Liza,\n\nExact sent body.\nDavorin', sent_at: '2026-10-23T13:12:52Z' })
  const [t] = threads([mirror, sent])
  expect(emailDetails(sent, t)).toMatchObject({ subject: 'Creator campaigns for ZiMAD - Arch Intro', from: 'davorin@madebyarch.com', to: ['liza@zimad.com'], body: 'Hi Liza,\n\nExact sent body.\nDavorin' })
  expect(emailDetails({ ...sent, message_text: 'Another email' }, t).subject).toBeNull()
  expect(emailDetails({ ...sent, recipient_email: 'other@zimad.com' }, t).subject).toBeNull()
})

it('does not infer a historical subject from a different email in the conversation', () => {
  const earlier = msg({ prospect_id: 'p', channel: 'email', message_text: 'Unrelated old mail', sent_at: '2026-10-22T00:00:00Z' })
  const later = msg({ prospect_id: 'p', channel: 'email', direction: 'inbound', message_text: 'New subject', draft_evidence: { email: { subject: 'Re: New campaign' } } })
  expect(emailDetails(earlier, threads([earlier, later])[0]).subject).toBeNull()
})

it('previews the current edited Subject line and preserves the reply headers', () => {
  expect(emailPreview('Subject: Re: Updated title\n\nHi Liza,\n\nWednesday works.\n\nDavorin', { subject: 'Old title', from: 'davorin@madebyarch.com', to: ['liza@zimad.com'], replyToMessageId: '<reply@zimad.com>' })).toMatchObject({ subject: 'Re: Updated title', body: 'Hi Liza,\n\nWednesday works.\n\nCheers,\nDavorin Šmit\nARCH\narch.agency', replyToMessageId: '<reply@zimad.com>' })
})

it('hydrates only matching row identities and uses persisted envelope metadata without replacing edited text', () => {
  const original = msg({ id: 'mail', prospect_id: 'p', channel: 'email', direction: 'inbound', message_text: 'Original reply' })
  const [t] = threads([original])
  const hydrated = hydrateEmailDetails(t, [{ id: 'mail', prospect_id: 'p', recipient_email: 'liza@zimad.com', email_metadata: { subject: 'Re: Intro', from: 'liza@zimad.com' }, email_mirror_text: null }])
  expect(hydrated.messages[0].email_details).toMatchObject({ subject: 'Re: Intro', from: 'liza@zimad.com', body: 'Original reply' })
  expect(t.messages[0].email_details).toBeUndefined()
  expect(hydrateEmailDetails(t, [{ id: 'mail', prospect_id: 'other', email_metadata: { subject: 'Wrong tenant/person' } }]).messages[0].email_details?.subject).not.toBe('Wrong tenant/person')
})

it('previews the actual ARCH signature and email formatting while escaping message HTML', () => {
  const result = emailPreview('Subject: Re: Intro\n\nHello <script>bad()</script>,\n---\n**Wednesday works.**\n\nBest,\nDavorin\nARCH\narch.agency', { from: 'davorin@madebyarch.com' })
  expect(result.body).toBe('Hello <script>bad()</script>,\n\nWednesday works.\n\nCheers,\nDavorin Šmit\nARCH\narch.agency')
  expect(result.html).toContain('border-left:2px solid #222')
  expect(result.html).toContain('Davorin Šmit')
  expect(result.html).toContain('&lt;script&gt;bad()&lt;/script&gt;')
  expect(result.html).not.toContain('<script>')
})

it('matches native dispatch when the subject follows an initial blank line', () => {
  expect(emailPreview('\nSubject: Re: Intro\n\nHello', { subject: 'Quick question' })).toMatchObject({ subject: 'Re: Intro', body: 'Hello' })
})

it('keeps a bold Subject line in a mirror body because mirror dispatch accepts only plain headers', () => {
  expect(emailPreview('**Subject: Intro**\n\nHello', { transport: 'mirror', subject: 'Your ZiMAD growth scan' })).toMatchObject({ subject: 'Your ZiMAD growth scan', body: '**Subject: Intro**\n\nHello' })
})
