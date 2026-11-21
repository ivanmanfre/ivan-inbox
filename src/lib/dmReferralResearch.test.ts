import { afterEach, describe, expect, it, vi } from 'vitest'
import { apify, claude, db, item } from './referralTestEnv'
import { researchReferral } from '../../supabase/functions/inbox-dm-draft/research'

const input = { id: 'in-1', text: 'ben Patton does that side of biz', company: 'Saint Spritz' }
afterEach(() => vi.unstubAllGlobals())

describe('referral researcher', () => {
  it('extracts the referred name, searches it with the company, and drafts only after the profile matches', async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = []
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) })
      if (calls.length === 1) return claude(JSON.stringify({ name: 'Ben Patton' }))
      if (calls.length === 2) return apify([item('Ben', 'Patton', 'ben-patton-9834411aa', [['Saint Spritz', 'CEO', true]])])
      return claude(JSON.stringify({ draft: 'Hey Ben, Mallory said you handle paid growth at Saint Spritz. Want me to send you the growth scan?' }))
    })
    const result = await researchReferral(db, input, 'Mattan', [], [])
    expect(result).toMatchObject({ status: 'verified', role: 'CEO', linkedin_url: 'https://www.linkedin.com/in/ben-patton-9834411aa' })
    expect(result.draft).toContain('Hey Ben')
    expect(calls[0].url).toBe('https://proxy.test/v1/messages')
    expect(calls[0].body).not.toHaveProperty('system')
    expect(calls[1].url).toContain('harvestapi~linkedin-profile-search')
    expect(calls[1].body.searchQuery).toBe('Ben Patton Saint Spritz')
    expect(calls).toHaveLength(3)
  })
  it('stops before any lookup for an unnamed handoff', async () => {
    let calls = 0
    vi.stubGlobal('fetch', async () => { calls++; return claude('{"name":null}') })
    const result = await researchReferral(db, { ...input, text: 'Our marketing team handles that' }, 'Mattan', [], [])
    expect(result.status).toBe('unresolved')
    expect(result.draft).toBeNull()
    expect(calls).toBe(1)
  })
  it('uses the tagged profile without any name search (Irina tagging Tatiana, 2026-11-02)', async () => {
    const urls: string[] = []
    vi.stubGlobal('fetch', async (url: string) => {
      urls.push(url)
      return urls.length === 1 ? claude('{"name":"@Tatiana Tabola"}')
        : claude(JSON.stringify({ draft: 'Hi Tatiana, Irina mentioned you lead influencer marketing at BP Mobile. Would you be open to a few creator ideas for your next campaigns?' }))
    })
    const tatiana = { label: 'Tatiana Tabola', profile: { provider_id: 'ACoAACecaTAB', name: 'Tatiana Tabola', headline: 'Influencer Marketing Team Lead | AIBY Group',
      public_identifier: 'tatiana-tabola-580688166', experience: [{ company: 'BP Mobile', position: 'Lead Influencer Marketing Manager', current: true }] } }
    const result = await researchReferral(db, { id: 'c777', text: 'Please connect with @Tatiana Tabola ', company: 'BP Mobile', referrer: 'Irina Rogachova' }, 'Davorin', [], [], [tatiana])
    expect(result).toMatchObject({ status: 'verified', name: 'Tatiana Tabola', linkedin_url: 'https://www.linkedin.com/in/tatiana-tabola-580688166', acknowledgement: "Thanks Irina, I'll reach out to Tatiana." })
    expect(result.draft).toContain('Hi Tatiana')
    expect(urls.every(u => u.startsWith('https://proxy.test'))).toBe(true)
  })
})
