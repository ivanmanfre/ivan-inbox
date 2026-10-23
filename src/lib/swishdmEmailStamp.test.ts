import { expect, it, vi } from 'vitest'
const calls = vi.hoisted(() => [] as { op: string; args: unknown[] }[])
vi.mock('./supabase', () => ({ supabase: { from: () => {
  const q: Record<string, unknown> = {}
  for (const op of ['select','update','eq','is','or','order','limit']) q[op] = (...args: unknown[]) => { calls.push({op,args}); return q }
  q.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [{id:'sue-draft',recipient_email:'sue@biatchtequila.com',email_mirror_text:'Reviewed report email'}], error: null }).then(resolve)
  return q
} } }))
import { fetchDraftEmailStamps, saveDraftEmail } from './inbox'
it('loads the email preview on an approval-held SwishDM reply', async () => {
  const stamps = await fetchDraftEmailStamps()
  expect(calls.filter(c=>c.op==='or').map(c=>c.args[0])).toContain('send_blocked_at.is.null,send_blocked_reason.like.post_approval_race*,send_blocked_reason.like.lint*,and(send_blocked_reason.eq.awaiting_client_review,ai_model.like.swishdm_reply_*)')
  expect(stamps.get('sue-draft')).toMatchObject({recipient_email:'sue@biatchtequila.com',email_mirror_text:'Reviewed report email'})
})
it('permits saving edits to a held SwishDM email while keeping sent and approved rows protected', async () => {
  calls.length=0
  await saveDraftEmail('sue-draft','Edited report email')
  expect(calls).toContainEqual({op:'update',args:[{email_mirror_text:'Edited report email'}]})
  expect(calls).toContainEqual({op:'is',args:['sent_at',null]})
  expect(calls).toContainEqual({op:'is',args:['approved_at',null]})
  expect(calls.filter(c=>c.op==='or').map(c=>c.args[0])).toContain('send_blocked_reason.is.null,send_blocked_reason.like.post_approval_race:*,send_blocked_reason.like.lint_*,and(send_blocked_reason.eq.awaiting_client_review,ai_model.like.swishdm_reply_*)')
})
