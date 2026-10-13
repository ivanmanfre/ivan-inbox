import { beforeEach, expect, it, vi } from 'vitest'
const db = vi.hoisted(() => ({ fetch: vi.fn() }))
vi.mock('./supabase', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  return { supabase: createClient('https://example.supabase.co', 'test-key', {
    auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: db.fetch },
  }) }
})
import { saveDraftEmail, saveDraftText } from './inbox'

beforeEach(() => { db.fetch.mockReset(); db.fetch.mockResolvedValue(new Response(null, { status: 204 })) })

it('persists the exact edited mirror subject/body through guarded PostgREST without approving', async () => {
  await saveDraftEmail('draft', 'Subject: RISE introduction for Frase Skin\n\nHi Mathew,\n\nExact operator words.\n')
  const [url, options] = db.fetch.mock.calls[0]
  expect(options.method).toBe('PATCH')
  expect(JSON.parse(options.body)).toEqual({ email_mirror_text: 'Subject: RISE introduction for Frase Skin\n\nHi Mathew,\n\nExact operator words.\n' })
  expect(new URL(url).searchParams.get('approved_at')).toBe('is.null')
  expect(new URL(url).searchParams.get('sent_at')).toBe('is.null')
})

it('persists a standalone or paired email subject in the existing guarded message_text field', async () => {
  await saveDraftText('email-leg', 'Subject: Introduction\n\nExact operator words.\n')
  const [url, options] = db.fetch.mock.calls[0]
  expect(JSON.parse(options.body)).toEqual({ message_text: 'Subject: Introduction\n\nExact operator words.\n' })
  expect(new URL(url).searchParams.get('approved_at')).toBe('is.null')
  expect(new URL(url).searchParams.get('sent_at')).toBe('is.null')
})
