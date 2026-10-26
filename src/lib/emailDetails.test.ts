import { beforeEach, expect, it, vi } from 'vitest'
const db = vi.hoisted(() => ({ fetch: vi.fn() }))
vi.mock('./supabase', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  return { supabase: createClient('https://example.supabase.co', 'test-key', { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: db.fetch } }) }
})
import { fetchEmailDetails } from './emailDetails'

beforeEach(() => db.fetch.mockReset())

it('reads envelope fields for the open prospect and known rows without fetching whole research evidence', async () => {
  db.fetch.mockResolvedValue(new Response(JSON.stringify([{ id: 'email', prospect_id: 'person', email_metadata: { subject: 'Re: Intro' } }]), { status: 200, headers: { 'Content-Type': 'application/json' } }))
  expect(await fetchEmailDetails('person', ['email'])).toEqual([{ id: 'email', prospect_id: 'person', email_metadata: { subject: 'Re: Intro' } }])
  const url = new URL(db.fetch.mock.calls[0][0])
  expect(url.searchParams.get('prospect_id')).toBe('eq.person')
  expect(url.searchParams.get('id')).toBe('in.(email)')
  expect(url.searchParams.get('select')).toContain('email_metadata:draft_evidence->email')
  expect(url.searchParams.get('select')!.split(',')).not.toContain('draft_evidence')
})

it('surfaces an envelope lookup failure so the view can offer a retry', async () => {
  db.fetch.mockImplementation(async () => new Response(JSON.stringify({ message: 'Email headers unavailable' }), { status: 400, headers: { 'Content-Type': 'application/json' } }))
  await expect(fetchEmailDetails('person', ['mail'])).rejects.toMatchObject({ message: 'Email headers unavailable' })
})
