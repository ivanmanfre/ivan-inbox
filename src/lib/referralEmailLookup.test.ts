import { afterEach, describe, expect, it, vi } from 'vitest'
import { apify, claude, item } from './referralTestEnv'
import { linksOutsideRules, redraftReferral, researchReferral } from '../../supabase/functions/inbox-dm-draft/research'
import { readMatch } from '../../supabase/functions/inbox-dm-draft/apollo'
import type { ReferralDraft } from '../../supabase/functions/inbox-dm-draft/referral'

// Invented people and companies only: this repo is public.
const db = { from: (t: string) => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { value: t === 'integration_config' ? 'key' : null } }) }) }) }) }
const URL_ = 'https://www.linkedin.com/in/dana-fictional-1'
const person = { company: 'Brewco UK', linkedin_url: URL_ }
const apollo = (p: Record<string, unknown> | null) => new Response(JSON.stringify({ person: p }))
const match = (over: Record<string, unknown> = {}) => ({ email: 'dana.fictional@brewco.example', email_status: 'verified', linkedin_url: 'http://www.linkedin.com/in/dana-fictional-1',
  organization: { name: 'Brewco UK' }, employment_history: [{ organization_name: 'Brewco UK', current: true }], ...over })
afterEach(() => vi.unstubAllGlobals())

describe('readMatch (Apollo people/match)', () => {
  it('keeps a verified work email on the same profile at the referral company', () => {
    expect(readMatch({ person: match() }, person)).toEqual({ status: 'found', email: 'dana.fictional@brewco.example' })
  })
  it('refuses another profile, another employer, an unverified or a personal address', () => {
    expect(readMatch({ person: match({ linkedin_url: 'https://linkedin.com/in/someone-else' }) }, person).status).toBe('mismatch')
    expect(readMatch({ person: match({ organization: { name: 'Othercorp' }, employment_history: [{ organization_name: 'Othercorp', current: true }] }) }, person).status).toBe('mismatch')
    expect(readMatch({ person: match({ email_status: 'guessed' }) }, person).status).toBe('none')
    expect(readMatch({ person: match({ email: 'dana@gmail.com' }) }, person).status).toBe('none')
    expect(readMatch({ person: match({ email: 'email_not_unlocked@domain.com' }) }, person).status).toBe('none')
    expect(readMatch({ person: null }, person).status).toBe('none')
  })
})

describe('referral both lanes (Ivan 2026-11-26)', () => {
  const text = 'I am leaving this week. Please reach out to Dana Fictional who can advise on this.'
  const input = { id: 'in-1', text, company: 'Brewco UK', referrer: 'Sam Example' }
  const run = (answers: ((body: Record<string, unknown>, url: string) => Response)[]) => {
    const calls: { url: string; body: Record<string, unknown> }[] = []
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)); calls.push({ url, body })
      return answers[calls.length - 1](body, url)
    })
    return calls
  }
  const dm = () => claude(JSON.stringify({ paragraphs: ['Hey Dana', 'Sam pointed me to you for influencer campaigns at Brewco UK.', "I'm Davorin, founder of ARCH. We run creator campaigns for subscription brands.", 'Would you be open to a quick chat about it?'] }))
  const mail = () => claude(JSON.stringify({ subject: 'Sam suggested I reach out', paragraphs: ['Hi Dana', "I'm Davorin, founder of ARCH, and Sam suggested I reach out to you about creator campaigns.", 'We run creator campaigns for subscription brands.', 'Would you be open to a quick chat about it?'] }))

  it('finds the verified work email when the handoff gives none, and drafts the email too', async () => {
    const calls = run([() => claude(JSON.stringify({ name: 'Dana Fictional' })), () => apify([item('Dana', 'Fictional', 'dana-fictional-1', [['Brewco UK', 'Marketing Director', true]])]),
      dm, () => apollo(match()), mail])
    const r = await researchReferral(db, input, 'Davorin', [], [], [], { emailLane: true })
    expect(r.status).toBe('verified')
    expect(calls[3].url).toBe('https://api.apollo.io/api/v1/people/match')
    expect(calls[3].body).toMatchObject({ linkedin_url: URL_, reveal_personal_emails: false })
    expect(r.email).toMatchObject({ to: 'dana.fictional@brewco.example', cc: [], subject: 'Sam suggested I reach out', found_by: 'apollo' })
    expect(r.email_lookup).toMatchObject({ status: 'found', email: 'dana.fictional@brewco.example', linkedin_url: URL_ })
    // The DM introduces the company instead of asking how they measure their work.
    const prompt = String((calls[2].body.messages as { content: string }[])[0].content)
    expect(prompt).toMatch(/introduces Davorin and the company/)
    expect(prompt).not.toMatch(/measured on/)
    expect(prompt).toMatch(/Under 290 characters/)
    expect(prompt).not.toMatch(/public deck link/)
    // The email carries the deck, one approved case study and the booking link from the client rules.
    const emailPrompt = String((calls[4].body.messages as { content: string }[])[0].content)
    expect(emailPrompt).toMatch(/public deck link/)
    expect(emailPrompt).toMatch(/public case study/)
    expect(emailPrompt).toMatch(/live booking link/)
    expect(emailPrompt).toMatch(/Under 150 words/)
  })
  it('reuses a stored lookup for the same profile (no second credit) and skips seats without email', async () => {
    const stored = { linkedin_url: URL_, checked_at: '2026-11-26T00:00:00Z', source: 'apollo' as const, status: 'none' as const, reason: 'Apollo has no work email for them.' }
    let calls = run([() => claude(JSON.stringify({ name: 'Dana Fictional' })), () => apify([item('Dana', 'Fictional', 'dana-fictional-1', [['Brewco UK', 'Marketing Director', true]])]), dm])
    let r = await researchReferral(db, input, 'Davorin', [], [], [], { emailLane: true, lookup: stored })
    expect(calls).toHaveLength(3)
    expect(r.email ?? null).toBeNull()
    expect(r.email_reason ?? null).toBeNull()
    expect(r.email_lookup).toEqual(stored)
    calls = run([() => claude(JSON.stringify({ name: 'Dana Fictional' })), () => apify([item('Dana', 'Fictional', 'dana-fictional-1', [['Brewco UK', 'Marketing Director', true]])]), dm])
    r = await researchReferral(db, input, 'Davorin', [], [], [], { emailLane: false })
    expect(calls).toHaveLength(3)
    expect(r.email_lookup).toBeUndefined()
  })
  it('an Apollo outage stores nothing and offers a retry', async () => {
    run([() => claude(JSON.stringify({ name: 'Dana Fictional' })), () => apify([item('Dana', 'Fictional', 'dana-fictional-1', [['Brewco UK', 'Marketing Director', true]])]), dm, () => new Response('down', { status: 503 })])
    const r = await researchReferral(db, input, 'Davorin', [], [], [], { emailLane: true })
    expect(r.status).toBe('verified')
    expect(r.email_lookup).toBeUndefined()
    expect(r.email_reason).toMatch(/lookup could not finish/)
  })
  it('a referral researched before the lookup existed gets it once on redraft', async () => {
    const cached: ReferralDraft = { status: 'verified', input_message_id: 'in-1', name: 'Dana Fictional', company: 'Brewco UK', role: 'Marketing Director', linkedin_url: URL_,
      summary: 's', draft: 'old', reason: null, sources: [], revision: 13 }
    const calls = run([dm, () => apollo(match()), mail])
    const r = await redraftReferral(cached, 'Davorin', [], {}, db)
    expect(calls[1].url).toContain('apollo.io')
    expect(r.email?.to).toBe('dana.fictional@brewco.example')
    expect(r.email?.found_by).toBe('apollo')
    expect(r.draft).toContain('founder of ARCH')
  })
  it('an email link must come from the client rules word for word', () => {
    const rules = [{ slug: 'x', body: 'Case study: https://arch.example/case-study/one/' }]
    expect(linksOutsideRules('See https://arch.example/case-study/one/.', rules)).toBe(false)
    expect(linksOutsideRules('See https://arch.example/made-up/', rules)).toBe(true)
    expect(linksOutsideRules('No link here', rules)).toBe(false)
  })
})
