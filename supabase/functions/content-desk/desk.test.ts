// Pure-logic tests for the Content Desk. Made-up data only (public repo).
import { assert, assertEquals } from 'jsr:@std/assert@1'
import { parse, plain } from './parse.ts'
import { lineMatches, resolveDraft, warsawToIso, classifyPostUrl } from './actions.ts'
import { render, makeHandles, applyVisibility, type BriefJson, type Draft } from './brief.ts'
import { planTriggers, warsawMonday } from './triggers.ts'

const draft = (id: string, first: string, extra: Partial<Draft> = {}): Draft => ({
  id, status: 'review', type: 'text', scheduled_at: null, published_at: null, first_line: first, title: '',
  belief: null, vehicle: null, recipe: null, qa_verdict: 'PASS', is_copy: false, photos: 0, brain: false,
  human_edited: false, slot_kind: null, selling: false, chars: 300, created_at: '2026-11-10T10:00:00Z', fixture: null, ...extra,
})
const brief = (drafts: Draft[], extra: Partial<BriefJson> = {}): BriefJson => ({
  as_of: '2026-11-18T11:00:00Z', today: '2026-11-18', this_monday: '2026-11-16', panel: { quotas: [] }, drafts, queue: [],
  posts: { posts: [] }, calls: [], call_lines: [], beliefs: [], rulings: [], autopilot: [], ideas: { reviewing: 0, newest: [] }, ...extra,
})

Deno.test('parse: reply, actions, chips; bad JSON dropped, never guessed', () => {
  const p = parse('<reply>\nMoved it — done.\n</reply>\n<actions>[{"kind":"date","draft":"#abcde","line":"Snow in the park","at":"2026-11-26 10:45"}]</actions>\n<chips>[{"label":"A","send":"a"},{"bad":1}]</chips><reads>not json</reads>')
  assertEquals(p.reply, 'Moved it, done.')
  assertEquals(p.actions.length, 1)
  assertEquals(p.chips, [{ label: 'A', send: 'a' }])
  assertEquals(p.reads, [])
})

Deno.test('plain: no em or en dashes reach Ivan, number ranges keep a hyphen', () => {
  assertEquals(plain('one — two'), 'one, two')
  assertEquals(plain('10–12 posts'), '10-12 posts')
  assert(!/[—–]/.test(plain('a—b–c')))
})

Deno.test('lineMatches: needs the real first words', () => {
  assert(lineMatches('A walk by the river on a cold morning.', 'A walk by the river'))
  assert(lineMatches('A walk by the river on a cold morning.', 'walk by the river'))
  assert(!lineMatches('A walk by the river on a cold morning.', 'Coffee in the old town'))
  assert(!lineMatches('A walk by the river on a cold morning.', 'A'))
  assert(!lineMatches('A walk by the river on a cold morning.', undefined))
})

Deno.test('resolveDraft: handle and line must agree; arrays are ambiguity', () => {
  const r = render(brief([draft('aaaaaaaa-0000-4000-8000-000000000001', 'A walk by the river'), draft('bbbbbbbb-0000-4000-8000-000000000002', 'Coffee in the old town')]))
  const h1 = [...r.drafts.keys()][0]
  const ok = resolveDraft(r, { kind: 'approve', draft: h1, line: 'A walk by the river' })
  assert('d' in ok && ok.d.first_line.startsWith('A walk'))
  const wrong = resolveDraft(r, { kind: 'approve', draft: h1, line: 'Coffee in the old town' })
  assert('error' in wrong && wrong.error === 'line_mismatch')
  const amb = resolveDraft(r, { kind: 'approve', draft: [...r.drafts.keys()], line: 'x' })
  assert('error' in amb && amb.error === 'ambiguous' && amb.chips?.length === 2)
  const none = resolveDraft(r, { kind: 'approve', draft: '#fffff', line: 'A walk by the river' })
  assert('error' in none && none.error === 'unknown_draft')
})

Deno.test('makeHandles: unique prefixes, 5+ hex', () => {
  const h = makeHandles(['abcde111-0000-4000-8000-000000000000', 'abcde222-0000-4000-8000-000000000000', 'fffff000-0000-4000-8000-000000000000'])
  assertEquals(new Set(h.values()).size, 3)
  assertEquals(h.get('fffff000-0000-4000-8000-000000000000'), '#fffff')
  assertEquals(h.get('abcde111-0000-4000-8000-000000000000'), '#abcde1')
})

Deno.test('warsawToIso: CET and CEST wall times', () => {
  assertEquals(warsawToIso('2026-11-26 10:45'), '2026-11-26T09:45:00.000Z')
  assertEquals(warsawToIso('2026-07-01 10:45'), '2026-07-01T08:45:00.000Z')
  assertEquals(warsawToIso('Thursday'), null)
})

Deno.test('classifyPostUrl: LinkedIn activity, X status, others none', () => {
  assertEquals(classifyPostUrl('https://www.linkedin.com/posts/some-person_topic-activity-7400000000000000001-AbCd')?.id, '7400000000000000001')
  assertEquals(classifyPostUrl('https://www.linkedin.com/feed/update/urn:li:activity:7400000000000000002/')?.id, '7400000000000000002')
  assertEquals(classifyPostUrl('https://x.com/someone/status/1900000000000000000')?.platform, 'x')
  assertEquals(classifyPostUrl('https://example.com/blog/post'), null)
})

Deno.test('applyVisibility: unfinished drafts the Review hides are dropped; scheduled stay', () => {
  const b = brief([draft('aaaaaaaa-0000-4000-8000-000000000001', 'visible'), draft('bbbbbbbb-0000-4000-8000-000000000002', 'hidden'),
    draft('cccccccc-0000-4000-8000-000000000003', 'dated', { status: 'scheduled', scheduled_at: '2026-11-19T09:00:00Z' })])
  const v = applyVisibility(b, new Map([['aaaaaaaa-0000-4000-8000-000000000001', true]]))
  assertEquals(v.drafts.map((d) => d.first_line), ['visible', 'dated'])
  assert(v.drafts[0].brain)
  assertEquals(applyVisibility(b, null).drafts.length, 3)
})

Deno.test('render: week counts and unlabeled beliefs are stated, not guessed', () => {
  const r = render(brief([draft('aaaaaaaa-0000-4000-8000-000000000001', 'Tuesday post', { status: 'scheduled', scheduled_at: '2026-11-17T09:00:00Z' })]))
  assert(r.text.includes('THIS WEEK'))
  assert(r.text.includes('NO belief label'))
  assertEquals(r.weeks[0].originals, 1)
})

Deno.test('triggers: Monday plan once, call line quoted verbatim, cap 5 a week, no duplicates', () => {
  const b = brief([draft('aaaaaaaa-0000-4000-8000-000000000001', 'Monday post', { status: 'scheduled', scheduled_at: '2026-11-16T09:00:00Z' })],
    { as_of: '2026-11-16T08:30:00Z', today: '2026-11-16' })
  const weeks = render(b).weeks
  const lines = Array.from({ length: 6 }, (_, i) => ({ id: `l${i}`, ingested_at: '2026-11-16T07:00:00Z', status: 'scored', topic: 't', said: `made up line ${i}`, when: null, belief: '1', vehicle: 'take', score: 7, draft_id: null }))
  const input = { now: '2026-11-16T08:30:00Z', weeks, posts: [], callLines: lines, queue: [], drafts: [], t3Done: [], ledger: [] as { kind: string; dedupe_key: string; fired_at: string }[] }
  const first = planTriggers(input)
  assertEquals(first.filter((p) => p.kind === 'week_plan').length, 1)
  assertEquals(first.filter((p) => p.kind === 'call_line').length, 2) // per-kind cap
  assert(first.find((p) => p.kind === 'call_line')!.body.includes('"made up line 0"'))
  const ledger = first.map((p) => ({ kind: p.kind, dedupe_key: p.dedupe_key, fired_at: input.now }))
  const again = planTriggers({ ...input, ledger })
  assertEquals(again.length, 0) // deduped and capped
  for (const p of first) assert(p.artifact.ref)
  // night: nothing fires
  assertEquals(planTriggers({ ...input, now: '2026-11-16T22:30:00Z' }).length, 0)
  assertEquals(warsawMonday('2026-11-22T22:59:00Z'), '2026-11-16') // Sun 23:59 Warsaw
})

Deno.test('parse: an answer written outside or before the tags still becomes the reply', () => {
  assertEquals(parse('Two posts go out.\n<chips>[]</chips>').reply, 'Two posts go out.')
  assertEquals(parse('<reply>\n</reply>Two posts go out.').reply, 'Two posts go out.')
  assertEquals(parse('<reply>Two posts go out.').reply, 'Two posts go out.')
})

import { authPrompt, parseAuth, authorize } from './auth.ts'
import { ideaDecidable } from './actions.ts'

Deno.test('lineMatches: strict, no fuzzy word overlap', () => {
  assert(!lineMatches('I left Vienna for Berlin last spring', 'I left Poland for Berlin'))
  assert(lineMatches('I left Vienna for Berlin last spring', 'I left Vienna'))
  assert(!lineMatches('I left Vienna for Berlin last spring', 'left Vienna'))  // 2 words, 11 chars
})

Deno.test('resolveDraft: exact handle only, no prefix fallback', () => {
  const r = render(brief([draft('abcde111-0000-4000-8000-000000000001', 'I left Vienna for Berlin'), draft('abcde222-0000-4000-8000-000000000002', 'I left Poland for Berlin')]))
  const res = resolveDraft(r, { kind: 'delete', draft: '#abcde', line: 'I left Vienna for Berlin' })
  assert('error' in res && res.error === 'unknown_draft')
})

Deno.test('warsawToIso: nonexistent dates and DST gaps are rejected', () => {
  assertEquals(warsawToIso('2026-11-31 10:45'), null)
  assertEquals(warsawToIso('2026-03-29 02:30'), null)
  assertEquals(warsawToIso('2026-10-25 02:30') !== null, true) // ambiguous fall-back hour exists
})

Deno.test('authorization: fail closed on junk, per-action verdicts', async () => {
  assertEquals(parseAuth('nonsense', 2), [false, false])
  assertEquals(parseAuth('[{"n":2,"ok":true},{"n":1,"ok":false}]', 2), [false, true])
  assertEquals(parseAuth('Sure! [{"n":1,"ok":true}]', 1), [false])          // extra text: rejected
  assertEquals(parseAuth('[{"n":1,"ok":"yes"}]', 1), [false])               // non-boolean: rejected
  assertEquals(parseAuth('[{"n":1,"ok":true}]', 2), [false, false])         // wrong length: rejected
  assertEquals(parseAuth('```json\n[{"n":1,"ok":true}]\n```', 1), [true])
  assert(authPrompt('move the snow one to thursday', ['date X for Thu']).includes('move the snow one to thursday'))
  const refused = await authorize('approve it', ['approve X'], (async () => { throw new Error('refused') }) as never)
  assertEquals(refused, [false])
  const yes = await authorize('approve it', ['approve X'], (async () => ({ text: '[{"n":1,"ok":true}]', ms: 1, attempts: 1, model: 'm', hedged: false })) as never)
  assertEquals(yes, [true])
})

Deno.test('ideaDecidable mirrors the app lane guard', () => {
  assert(ideaDecidable({ workspace_type: null, campaign_id: null }))
  assert(ideaDecidable({ workspace_type: ' Own ', campaign_id: null }))
  assert(!ideaDecidable({ workspace_type: 'client', campaign_id: null }))
  assert(!ideaDecidable({ workspace_type: null, campaign_id: 'c1' }))
})

import { urlInMessage, allowedHost } from './unfurl.ts'

Deno.test('links: whole-token match, allowlisted hosts only', () => {
  assert(urlInMessage('https://x.com/a/status/1', 'copy this <https://x.com/a/status/1>, ok'))
  assert(!urlInMessage('https://x.com/a/status/1', 'copy this https://x.com/a/status/1.2'))
  assert(!urlInMessage('https://x.com/a/status/1', 'copy this https://x.com/a/status/12'))
  assert(allowedHost('https://www.linkedin.com/posts/x'))
  assert(!allowedHost('https://linkedin.com.evil.test/x'))
  assert(!allowedHost('http://x.com/a'))
  assert(!allowedHost('https://user:pw@x.com/a'))
})

Deno.test('parse: server-owned "_" keys from the model are dropped', () => {
  const p = parse('<reply>ok</reply><actions>[{"kind":"approve","draft":"#abcde","line":"a b c","_qa_override":true,"_snapshot":{}}]</actions>')
  assertEquals(Object.keys(p.actions[0]).filter((k) => k.startsWith('_')), [])
})

import { plan } from './actions.ts'

Deno.test('delete: a dated draft is refused with a pull chip; an undated review draft is held', async () => {
  const dated = draft('aaaaaaaa-0000-4000-8000-000000000001', 'Snow in the park this morning', { scheduled_at: '2026-11-26T09:45:00Z' })
  const free = draft('bbbbbbbb-0000-4000-8000-000000000002', 'Coffee in the old town again')
  const r = render(brief([dated, free]))
  const ctx = { brief: r, attachments: [], text: '', env: () => undefined } as never
  const h = (id: string) => r.handleOf.get(id)!
  const p1 = await plan(ctx, { kind: 'delete', draft: h(dated.id), line: 'Snow in the park' })
  assertEquals(p1.refuse, 'dated'); assert(p1.chips?.[0].label === 'Pull it first')
  const p2 = await plan(ctx, { kind: 'delete', draft: h(free.id), line: 'Coffee in the old town' })
  assertEquals(p2.echo.state, 'held')
})
