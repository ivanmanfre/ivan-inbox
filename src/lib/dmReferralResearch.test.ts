import { afterEach, describe, expect, it, vi } from 'vitest'
import { researchReferral } from '../../supabase/functions/inbox-dm-draft/research'

const input = { id: 'in-1', text: 'ben Patton does that side of biz', company: 'Saint Spritz' }
const profile = 'https://pr.linkedin.com/in/ben-patton-9834411aa'
const person = { status: 'verified', name: 'Ben Patton', company: 'Saint Spritz', role: 'CEO', linkedin_url: profile, summary: 'CEO at Saint Spritz.' }
const reply = (data: unknown) => new Response(JSON.stringify(data))
afterEach(() => vi.unstubAllGlobals())

describe('referral researcher', () => {
  it('extracts the referred name before searching and writes only after the cited profile matches', async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = []
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) })
      if (calls.length === 1) return reply({ choices: [{ message: { content: JSON.stringify({ name: 'Ben Patton' }) } }] })
      if (calls.length === 2) return reply({ output: [{ type: 'web_search_call', action: { sources: [{ url: profile }] } },
        { type: 'message', content: [{ type: 'output_text', text: 'Ben runs Saint Spritz.\n```json\n' + JSON.stringify(person) + '\n```', annotations: [{ type: 'url_citation', url: profile, title: 'Ben Patton - Saint Spritz | LinkedIn' }] }] }] })
      return reply({ choices: [{ message: { content: JSON.stringify({ draft: 'Hey Ben, Mallory said you handle paid growth at Saint Spritz. Want me to send you the growth scan?' }) } }] })
    })
    const result = await researchReferral('test-key', input, 'Mattan', [], [])
    expect(result.status).toBe('verified')
    expect(result.draft).toContain('Hey Ben')
    expect(calls[1].body.input).toBe('"Ben Patton" "Saint Spritz" site:linkedin.com/in')
    expect(calls).toHaveLength(3)
  })
  it('stops before web search for an unnamed handoff', async () => {
    let calls = 0
    vi.stubGlobal('fetch', async () => { calls++; return reply({ choices: [{ message: { content: '{"name":null}' } }] }) })
    const result = await researchReferral('test-key', { ...input, text: 'Our marketing team handles that' }, 'Mattan', [], [])
    expect(result.status).toBe('unresolved')
    expect(result.draft).toBeNull()
    expect(calls).toBe(1)
  })
})
