import { afterEach, describe, expect, it, vi } from 'vitest'
import { researchReferral } from '../../supabase/functions/inbox-dm-draft/research'
import { referralCandidate } from '../../supabase/functions/inbox-dm-draft/referral'

const input = { id: 'ismail-inbound', referrer: 'Ismail Görkem Yeni', company: 'MWM', text: 'Would you mind reaching out to Alicia Yang, she is running the UGC marketing on our side.' }
const profile = 'https://www.linkedin.com/in/alicia-test'
const response = (body: unknown) => ({ ok: true, json: async () => body })
const extraction = response({ choices: [{ message: { content: JSON.stringify({ name: 'Alicia Yang' }) } }] })
const person = { status: 'verified', name: 'Alicia Yang', company: 'MWM', role: 'UGC marketing', linkedin_url: profile, summary: 'Alicia works at MWM.' }
afterEach(() => vi.unstubAllGlobals())

describe('referral draft pair', () => {
  it('recognizes the reaching-out wording in Ismail’s actual handoff', () => {
    expect(referralCandidate(input.text)).toBe(true)
  })
  it('retains a reviewable acknowledgement when the referred profile cannot be verified', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(extraction).mockResolvedValueOnce(response({ output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ status: 'unresolved', reason: 'Several namesakes.' }) }] }] })))
    const result = await researchReferral('test', input, 'Davorin', [], [])
    expect(result).toMatchObject({ status: 'unresolved', name: 'Alicia Yang', input_message_id: 'ismail-inbound', draft: null, linkedin_url: null })
    expect(result.acknowledgement).toMatch(/Ismail.*Alicia/)
    expect(result.acknowledgement).not.toMatch(/UGC|ARCH|campaign/i)
  })
  it('retains the acknowledgement when the web service fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(extraction).mockRejectedValueOnce(new Error('network')))
    const result = await researchReferral('test', input, 'Davorin', [], [])
    expect(result.status).toBe('unresolved')
    expect(result.acknowledgement).toContain('Alicia')
    expect(result.draft).toBeNull()
  })
  it('returns separate drafts addressed to the referrer and verified referred person', async () => {
    const draft = 'Hey Alicia, Ismail said you handle UGC marketing at MWM. I run ARCH. Would you be open to discussing your creator campaigns?'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(extraction).mockResolvedValueOnce(response({ output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(person), annotations: [{ type: 'url_citation', url: profile, title: 'Alicia Yang - MWM | LinkedIn' }] }] }] })).mockResolvedValueOnce(response({ choices: [{ message: { content: JSON.stringify({ draft }) } }] })))
    const result = await researchReferral('test', input, 'Davorin', [], [])
    expect(result).toMatchObject({ status: 'verified', draft, linkedin_url: profile })
    expect(result.acknowledgement).toMatch(/Ismail.*Alicia/)
  })
  it('keeps a same-company profile with a different surname as a reviewable candidate', async () => {
    const candidate = { ...person, status: 'candidate', name: 'Alicia Yingru WANG', reason: 'Ismail wrote Yang; the UGC manager profile says WANG.' }
    const draft = 'Hey Alicia, Ismail said you handle UGC marketing at MWM. Would you be open to discussing your creator campaigns?'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(extraction).mockResolvedValueOnce(response({ output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(candidate), annotations: [{ type: 'url_citation', url: profile, title: 'Alicia Yingru WANG - MWM | LinkedIn' }] }] }] })).mockResolvedValueOnce(response({ choices: [{ message: { content: JSON.stringify({ draft }) } }] })))
    const result = await researchReferral('test', input, 'Davorin', [], [])
    expect(result.status).toBe('unresolved')
    expect(result.draft).toBeNull()
    expect(result.candidate).toMatchObject({ name: 'Alicia Yingru WANG', draft, linkedin_url: profile })
    expect(result.reason).toMatch(/Yang.*WANG/)
  })
})
