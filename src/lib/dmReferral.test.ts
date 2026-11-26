import { describe, expect, it } from 'vitest'
import { referralCandidate, verifyReferral } from '../../supabase/functions/inbox-dm-draft/referral'

const input = { id: 'inbound-1', text: 'ben Patton does that side of biz ', company: 'Saint Spritz' }
const profile = 'https://www.linkedin.com/in/ben-patton-9834411aa'
const sources = [{ url: profile, title: 'Ben Patton - Saint Spritz' }, { url: 'https://www.linkedin.com/company/saint-spritz', title: 'Saint Spritz' }]
const found = { status: 'verified', name: 'Ben Patton', company: 'Saint Spritz', role: 'CEO', linkedin_url: profile, summary: 'Ben is the CEO of Saint Spritz.', draft: 'Hey Ben, Mallory pointed me your way about paid growth at Saint Spritz. Want me to send you the growth scan?', sources }

describe('referral research guard', () => {
  it.each(['ben Patton does that side of biz', 'Speak to Jane Smith about marketing', 'John Doe handles our paid ads', 'Please contact Anna on our team', 'Reach out to Jane Smith at jane@example.com'])('recognizes a handoff: %s', text => {
    expect(referralCandidate(text)).toBe(true)
  })
  it.each(['Reach out to bob@example.com', 'We are, feel free to reach out to\u00a0creators@avalanchestudios.com to share details.', 'Contact support@example.com'])('keeps an email handoff out of named-person research: %s', text => {
    expect(referralCandidate(text)).toBe(false)
  })
  it.each(['No thanks', 'Thanks Ben, I handle our ads myself', 'Do you handle paid ads?', 'I do that side of the business', 'We are happy with our current agency', 'Hi there! Happy to check out :)', 'Happy to connect!', 'Happy to connect with you', 'Sure, talk to you soon', 'Feel free to contact me'])('leaves ordinary replies alone: %s', text => {
    expect(referralCandidate(text)).toBe(false)
  })
  it('accepts a researched profile belonging to the named referral and the same company', () => {
    expect(verifyReferral(found, sources, input)).toMatchObject({ status: 'verified', name: 'Ben Patton', input_message_id: 'inbound-1', draft: found.draft })
  })
  it('refuses a guessed profile absent from search sources', () => {
    expect(verifyReferral(found, sources.slice(1), input).status).toBe('unresolved')
  })
  it('refuses a namesake at another company', () => {
    expect(verifyReferral({ ...found, company: 'Ashurst' }, sources, input).status).toBe('unresolved')
  })
  it('refuses a wrong-company profile even when the model asserts the expected company and a separate company page exists', () => {
    expect(verifyReferral(found, [{ url: profile, title: 'Ben Patton - Ashurst | LinkedIn' }, sources[1]], input).status).toBe('unresolved')
  })
  it('refuses a person the message never named', () => {
    expect(verifyReferral({ ...found, name: 'Jane Doe' }, sources, input).status).toBe('unresolved')
  })
  it('keeps uncertain identity out of a prospect-facing DM', () => {
    const r = verifyReferral({ ...found, status: 'unresolved', reason: 'Several namesakes.' }, sources, input)
    expect(r.status).toBe('unresolved')
    expect(r.draft).toBeNull()
  })
  it.each(['Hey Ben, Mallory referred me—want a scan?', 'Curious if you want a scan?', 'We only get paid when you grow.', 'Hey Ben! Want a scan?'])('keeps banned copy out of the saved referral: %s', draft => {
    expect(verifyReferral({ ...found, draft }, sources, input).draft).toBeNull()
  })
  it('accepts regional LinkedIn URLs only when the exact public profile was researched', () => {
    const regional = 'https://pr.linkedin.com/in/ben-patton-9834411aa'
    expect(verifyReferral({ ...found, linkedin_url: regional }, [{ url: regional, title: 'Ben Patton - Saint Spritz | LinkedIn' }], input).status).toBe('verified')
  })
  it.each(['javascript:alert(1)', 'https://linkedin.com.evil.test/in/ben', 'https://www.linkedin.com/company/saint-spritz'])('rejects a non-person profile URL: %s', linkedin_url => {
    expect(verifyReferral({ ...found, linkedin_url }, [{ url: linkedin_url, title: 'fake' }], input).status).toBe('unresolved')
  })
})
