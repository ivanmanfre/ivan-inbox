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

it('replies to the specifically selected older email and identifies the newer received email', async () => {
  const old = { ...incoming, id: 'old', sent_at: '2026-10-25T09:00:00Z', message_text: 'Earlier question', draft_evidence: { email: { subject: 'Older topic', message_id: '<older@zimad.com>' } } }
  db.fetch.mockImplementation(async (url: string, init: RequestInit) => {
    if (init.method === 'POST' && String(url).includes('/outreach_messages')) db.writes.push(JSON.parse(init.body as string))
    const selected = new URL(String(url)).searchParams.get('id') === 'eq.old'
    const data = String(url).includes('/rpc/') ? { ok: true, allow_send: true, revision: 12, in_flight: false } : init.method === 'POST' ? null : [selected ? old : incoming]
    return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } })
  })
  const target = await emailReplyTarget('liza', 'old')
  expect(target).toMatchObject({ source_message_id: 'old', selection: 'specific', latest_source_message_id: 'inbound',
    context: { body: 'Earlier question', isLatest: false, date: old.sent_at }, email_headers: { 'In-Reply-To': '<older@zimad.com>' } })
  await composeReply(t, 'Answer to earlier question', target)
  expect(db.writes[0]).toMatchObject({ message_text: 'Subject: Re: Older topic\n\nAnswer to earlier question',
    draft_evidence: { email_reply_to_message_id: 'old', email_headers: { 'In-Reply-To': '<older@zimad.com>' } } })
})

it('queues the reviewed rich body and signature without changing the existing manual approval gates', async () => {
  const target = await emailReplyTarget('liza')
  const composition = { version: 1 as const, source_text: `${target.message_text_prefix}Hello`, body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello', marks: [{ type: 'bold' }] }] }] }, signature: null }
  await composeReply(t, 'Hello', target, composition)
  expect(db.writes[0]).toMatchObject({ draft_evidence: { email_composition: composition, email_composition_reviewed: composition } })
  expect((db.writes[0].draft_evidence as Record<string, unknown>).operator_copy_approval).toBeUndefined()
})

it('replies to all by default and queues the Cc the operator left in the composer (Lou Fasulo 10-27)', async () => {
  const lou = { ...incoming, recipient_email: 'lou@starform.co', draft_evidence: { email: { ...incoming.draft_evidence.email, to: ['davorin@madebyarch.com', 'margaret@starform.co', 'jesse@starform.co'], cc: [] } } }
  db.fetch.mockImplementation(async (url: string, init: RequestInit) => {
    if (init.method === 'POST' && String(url).includes('/outreach_messages')) db.writes.push(JSON.parse(init.body as string))
    const data = String(url).includes('/rpc/') ? { ok: true, allow_send: true, revision: 12, in_flight: false } : init.method === 'POST' ? null : [lou]
    return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } })
  })
  const target = await emailReplyTarget('liza')
  expect(target.cc).toEqual(['margaret@starform.co', 'jesse@starform.co'])
  await composeReply(t, 'Early next week works.', { ...target, cc: ['margaret@starform.co'] })
  expect(db.writes[0]).toMatchObject({ recipient_email: 'lou@starform.co', draft_evidence: { email_cc: ['margaret@starform.co'] } })
})
