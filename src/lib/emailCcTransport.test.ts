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
    JSON.stringify(options.method === 'PATCH' ? [{ id: 'draft' }] : { draft_evidence: evidence }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  ))
})
it('serializes the evidence guard as valid JSON in the actual PostgREST request', async () => {
  await saveDraftEmailCc('draft', 'michael@vmisports.com')
  const [url, options] = db.fetch.mock.calls.find(([, options]) => options.method === 'PATCH')!
  const query = new URL(url).searchParams
  expect(query.get('draft_evidence')).toBe(`eq.${JSON.stringify(evidence)}`)
  expect(JSON.parse(query.get('draft_evidence')!.slice(3))).toEqual(evidence)
  expect(query.get('approved_at')).toBe('is.null')
  expect(query.get('sent_at')).toBe('is.null')
  expect(JSON.parse(options.body)).toEqual({ draft_evidence: { ...evidence, email_cc: ['michael@vmisports.com'] } })
})
it('uses an IS NULL guard when the draft has no evidence', async () => {
  db.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ draft_evidence: null }), { status: 200 }))
  await saveDraftEmailCc('draft', '')
  expect(new URL(db.fetch.mock.calls[1][0]).searchParams.get('draft_evidence')).toBe('is.null')
})
it('rejects a concurrent evidence change without claiming a save', async () => {
  db.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ draft_evidence: evidence }), { status: 200 }))
  db.fetch.mockResolvedValueOnce(new Response('[]', { status: 200 }))
  await expect(saveDraftEmailCc('draft', 'michael@vmisports.com')).rejects.toThrow(/draft changed/)
})
