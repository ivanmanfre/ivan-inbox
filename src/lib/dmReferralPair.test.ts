import { afterEach, describe, expect, it, vi } from 'vitest'
import { apify, claude, db, item } from './referralTestEnv'
import { researchReferral } from '../../supabase/functions/inbox-dm-draft/research'
import { referralCandidate } from '../../supabase/functions/inbox-dm-draft/referral'

const input = { id: 'ismail-inbound', referrer: 'Ismail Görkem Yeni', company: 'MWM', text: 'Would you mind reaching out to Alicia Yang, she is running the UGC marketing on our side.' }
const profile = 'https://www.linkedin.com/in/alicia-test'
const extraction = () => claude(JSON.stringify({ name: 'Alicia Yang' }))
afterEach(() => vi.unstubAllGlobals())

describe('referral draft pair', () => {
  it('recognizes the reaching-out wording in Ismail’s actual handoff', () => {
    expect(referralCandidate(input.text)).toBe(true)
  })
  it('retains a reviewable acknowledgement when the referred profile cannot be verified', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(extraction())
      .mockResolvedValueOnce(apify([item('Alicia', 'Yang', 'a1', [['Ashurst', 'Lawyer', true]]), item('Alicia', 'Yang', 'a2', [['MWM', 'Intern', false]])])))
    const result = await researchReferral(db, input, 'Davorin', [], [])
    expect(result).toMatchObject({ status: 'unresolved', name: 'Alicia Yang', input_message_id: 'ismail-inbound', draft: null, linkedin_url: null })
    expect(result.acknowledgement).toMatch(/Ismail.*Alicia/)
    expect(result.acknowledgement).not.toMatch(/UGC|ARCH|campaign/i)
  })
  it('retains the acknowledgement when the lookup service fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(extraction()).mockRejectedValueOnce(new Error('network')))
    const result = await researchReferral(db, input, 'Davorin', [], [])
    expect(result.status).toBe('unresolved')
    expect(result.acknowledgement).toContain('Alicia')
    expect(result.draft).toBeNull()
  })
  it('returns separate drafts addressed to the referrer and verified referred person', async () => {
    const draft = 'Hey Alicia\n\nIsmail said you handle UGC marketing at MWM.\n\nI run ARCH. Are you running your creator campaigns in-house?'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(extraction())
      .mockResolvedValueOnce(apify([item('Alicia', 'Yang', 'alicia-test', [['MWM', 'UGC marketing', true]])]))
      .mockResolvedValueOnce(claude(JSON.stringify({ draft }))))
    const result = await researchReferral(db, input, 'Davorin', [], [])
    expect(result).toMatchObject({ status: 'verified', draft, linkedin_url: profile })
    expect(result.acknowledgement).toMatch(/Ismail.*Alicia/)
  })
  it('keeps a same-company profile with a different surname as a reviewable candidate', async () => {
    const draft = 'Hey Alicia\n\nIsmail said you handle UGC marketing at MWM.\n\nAre you running your creator campaigns in-house?'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(extraction())
      .mockResolvedValueOnce(apify([item('Alicia Yingru', 'WANG', 'alicia-test', [['MWM', 'UGC Manager', true]])]))
      .mockResolvedValueOnce(claude(JSON.stringify({ draft }))))
    const result = await researchReferral(db, input, 'Davorin', [], [])
    expect(result.status).toBe('unresolved')
    expect(result.draft).toBeNull()
    expect(result.candidate).toMatchObject({ name: 'Alicia Yingru WANG', draft, linkedin_url: profile })
    expect(result.reason).toMatch(/Yang.*WANG/)
  })
})
