import { beforeEach, expect, it, vi } from 'vitest'
const db = vi.hoisted(() => ({ fetch: vi.fn(), writes: [] as Record<string, unknown>[] }))
vi.mock('./supabase', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  return { supabase: createClient('https://example.supabase.co', 'test-key', { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: db.fetch } }) }
})
import { composeReply, emailReplyTarget, type Thread } from './inbox'
const incoming = { id: 'inbound', direction: 'inbound', recipient_email: 'elizaveta.savenkova@zimad.com', message_text: 'Wednesday?', draft_evidence: { email: { subject: 'Re: Creator campaigns for ZiMAD - Arch Intro', message_id: '<reply@zimad.com>', references: '<intro@arch.com>' } } }
const t = { prospect_id: 'liza', client_id: 'arch', channel: 'email', draft: null, companionDraft: null } as Thread
beforeEach(() => {
  db.writes.length = 0
  db.fetch.mockReset().mockImplementation(async (url: string, init: RequestInit) => {
    const body = init.body ? JSON.parse(init.body as string) : null
    if (init.method === 'POST' && String(url).includes('/outreach_messages')) db.writes.push(body)
    const data = String(url).includes('/rpc/') ? { ok: true, allow_send: true, revision: 12, in_flight: false } : init.method === 'POST' ? null : [incoming]
    return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } })
  })
})

it('queues exactly the displayed reply subject, alternate recipient and verified threading headers', async () => {
  const target = await emailReplyTarget('liza')
  expect(target).toMatchObject({ source_message_id: 'inbound', subject: 'Re: Creator campaigns for ZiMAD - Arch Intro', recipient_email: 'elizaveta.savenkova@zimad.com' })
  await composeReply(t, 'Wednesday works.\n\nDavorin', target)
  expect(db.writes).toEqual([expect.objectContaining({ recipient_email: 'elizaveta.savenkova@zimad.com', message_text: 'Subject: Re: Creator campaigns for ZiMAD - Arch Intro\n\nWednesday works.\n\nDavorin', draft_evidence: { conversation_agent_manual_revision: 12, email_headers: { 'In-Reply-To': '<reply@zimad.com>', References: '<intro@arch.com> <reply@zimad.com>' }, email_subject: 'Re: Creator campaigns for ZiMAD - Arch Intro', email_reply_to_message_id: 'inbound' } })])
})

it('refuses to queue when a newer email changes the recipient or thread after the preview', async () => {
  const preview = await emailReplyTarget('liza')
  db.fetch.mockImplementation(async () => new Response(JSON.stringify([{ ...incoming, id: 'newer', recipient_email: 'colleague@zimad.com' }]), { status: 200, headers: { 'Content-Type': 'application/json' } }))
  await expect(composeReply(t, 'Wednesday works.', preview)).rejects.toThrow(/email conversation changed/i)
  expect(db.writes).toEqual([])
})
