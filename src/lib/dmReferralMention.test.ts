import { describe, expect, it } from 'vitest'
import { matchMention, mentionIdentity, pickSearchMatch, referralCandidate, type Mention } from '../../supabase/functions/inbox-dm-draft/referral'

// Real case 2026-11-02: Irina Rogachova (BP Mobile) tagged Tatiana Tabola, whose headline names the parent AIBY Group.
const text = 'Please connect with @Tatiana Tabola '
const tatiana: Mention = { label: 'Tatiana Tabola', profile: {
  provider_id: 'ACoAACecaTABBgLDHb1RLHzlbgTrrUArt05o9vU', name: 'Tatiana Tabola', headline: 'Influencer Marketing Team Lead | AIBY Group',
  public_identifier: 'tatiana-tabola-580688166', experience: [
    { company: 'BP Mobile', position: 'Lead Influencer Marketing Manager', current: true },
    { company: 'AIBY', position: 'Lead Influencer Marketing Manager', current: true },
    { company: 'Gismart', position: 'Influencer Marketing Manager', current: false },
  ] } }
const input = { id: 'c777d336', company: 'BP Mobile' }

describe('tagged referral', () => {
  it('treats the tag as a handoff', () => expect(referralCandidate(text)).toBe(true))
  it('picks the tagged profile for the extracted name', () => {
    expect(matchMention([tatiana], 'Tatiana Tabola', text)).toBe(tatiana)
    expect(matchMention([tatiana], 'Tatiana', text)).toBe(tatiana)
  })
  it('refuses a tag whose label is absent from the message or whose profile name differs', () => {
    expect(matchMention([tatiana], 'Tatiana Tabola', 'Please connect with Anna')).toBeNull()
    expect(matchMention([{ ...tatiana, profile: { ...tatiana.profile, name: 'Someone Else' } }], 'Tatiana Tabola', text)).toBeNull()
    expect(matchMention([tatiana], 'Anna Smith', text)).toBeNull()
    expect(matchMention([], 'Tatiana Tabola', text)).toBeNull()
  })
  it('verifies a current role at the referred company even when the headline names a parent company', () => {
    const { identity, atCompany } = mentionIdentity(tatiana, input)
    expect(atCompany).toBe(true)
    expect(identity).toMatchObject({ status: 'verified', name: 'Tatiana Tabola', role: 'Lead Influencer Marketing Manager',
      linkedin_url: 'https://www.linkedin.com/in/tatiana-tabola-580688166', company: 'BP Mobile' })
    expect(identity.summary).toContain('Lead Influencer Marketing Manager at BP Mobile')
  })
  it('keeps a tagged person with no current role there as a check-first match', () => {
    const left: Mention = { ...tatiana, profile: { ...tatiana.profile, experience: [{ company: 'BP Mobile', position: 'Manager', current: false }, { company: 'Gismart', position: 'Lead', current: true }] } }
    const { atCompany, identity } = mentionIdentity(left, input)
    expect(atCompany).toBe(false)
    expect(identity.summary).toContain('no current BP Mobile role')
    expect(identity.summary).toContain('Lead at Gismart')
  })
  it('does not match a company by a stray substring', () => {
    const other: Mention = { ...tatiana, profile: { ...tatiana.profile, experience: [{ company: 'BPM Mobile Ltd', position: 'Lead', current: true }] } }
    expect(mentionIdentity(other, input).atCompany).toBe(false)
  })
  it('search picks the one exact name with a current role at the company', () => {
    const namesake = { ...tatiana.profile, provider_id: 'x', public_identifier: 'tatiana-tabola-2', experience: [{ company: 'Ashurst', position: 'Lawyer', current: true }] }
    expect(pickSearchMatch([namesake, tatiana.profile], 'Tatiana Tabola', 'BP Mobile')).toEqual({ profile: tatiana.profile, exact: true })
    expect(pickSearchMatch([namesake], 'Tatiana Tabola', 'BP Mobile')).toBeNull()
  })
  it('search keeps a same-first-name profile at the company as a candidate only', () => {
    const tanya = { ...tatiana.profile, name: 'Tatiana Ivanova', provider_id: 'y' }
    expect(pickSearchMatch([tanya], 'Tatiana Tabola', 'BP Mobile')).toEqual({ profile: tanya, exact: false })
    expect(pickSearchMatch([tanya, { ...tanya, provider_id: 'z', name: 'Tatiana Petrova' }], 'Tatiana Tabola', 'BP Mobile')).toBeNull()
  })
})
