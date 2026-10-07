import { beforeEach, expect, it, vi } from 'vitest'
const db = vi.hoisted(() => ({ fetch: vi.fn() }))
vi.mock('./supabase', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  return { supabase: createClient('https://example.supabase.co', 'test-key', {
    auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: db.fetch },
  }) }
})
import { saveDraftEmailCc } from './inbox'
const evidence = { generated_text: 'Keep "quotes", commas, and\nnewlines', email_cc: [], email: { generated_text: 'Subject: Audit' } }
beforeEach(() => {
  db.fetch.mockReset()
  db.fetch.mockImplementation(async (_url: string, options: RequestInit) => new Response(
    JSON.stringify(options.method === 'GET' ? { draft_evidence: evidence } : null),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  ))
})
it('keeps the exact evidence guard in the request body with the new CC', async () => {
  await saveDraftEmailCc('draft', 'michael@vmisports.com')
  const [url, options] = db.fetch.mock.calls.at(-1)!
  expect(new URL(url).searchParams.has('draft_evidence')).toBe(false)
  expect(options.method).toBe('POST')
  expect(JSON.parse(options.body)).toEqual({ p_message_id: 'draft', p_cc: ['michael@vmisports.com'], p_expected_evidence: evidence })
})
it('passes absent evidence as SQL null and supports empty CC', async () => {
  db.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ draft_evidence: null }), { status: 200 }))
  expect(await saveDraftEmailCc('draft', '')).toEqual([])
  expect(JSON.parse(db.fetch.mock.calls[1][1].body)).toMatchObject({ p_cc: [], p_expected_evidence: null })
})
it('surfaces a concurrent evidence change without claiming a save', async () => {
  db.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ draft_evidence: evidence }), { status: 200 }))
  db.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ message: 'The draft changed. Refresh before approving.' }), { status: 400 }))
  await expect(saveDraftEmailCc('draft', 'michael@vmisports.com')).rejects.toThrow(/draft changed/)
})
it('saves CC on a research-heavy draft without exceeding the proxy URL limit', async () => {
  const large = { ...evidence, research: 'x'.repeat(90000) }
  db.fetch.mockImplementation(async (url: string, options: RequestInit) => {
    if (String(url).length > 8192) return new Response('Bad Request', { status: 400 })
    return new Response(JSON.stringify(options.method === 'GET' ? { draft_evidence: large } : null), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })
  })
  await expect(saveDraftEmailCc('draft', 'michael@vmisports.com')).resolves.toEqual(['michael@vmisports.com'])
  const [url, options] = db.fetch.mock.calls.at(-1)!
  expect(String(url).length).toBeLessThan(8192)
  expect(options.method).toBe('POST')
  expect(JSON.parse(options.body)).toMatchObject({ p_message_id: 'draft', p_cc: ['michael@vmisports.com'], p_expected_evidence: large })
})
