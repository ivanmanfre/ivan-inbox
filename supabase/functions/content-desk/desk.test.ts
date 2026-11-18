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
  assertEquals(p.chips, [{ label: 'a', send: 'a' }])   // one text per chip (Sol r5 B1)
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
  assert('error' in wrong && wrong.error === 'handle_mismatch')   // the excerpt names another draft: act on none (Sol r6 #2)
  const nomatch = resolveDraft(r, { kind: 'approve', draft: h1, line: 'Snow on the tram roof' })
  assert('error' in nomatch && nomatch.error === 'line_mismatch')
  const amb = resolveDraft(r, { kind: 'approve', draft: [...r.drafts.keys()], line: 'x' })
  assert('error' in amb && amb.error === 'ambiguous' && amb.chips?.length === 2)
  const none = resolveDraft(r, { kind: 'approve', draft: '#fffff', line: 'A walk by the river' })
  assert('error' in none && none.error === 'handle_mismatch')   // a made-up handle never resolves
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
  assert('error' in res && res.error === 'handle_mismatch')
  const res2 = resolveDraft(r, { kind: 'delete', draft: '#abcde', line: 'Snow on the tram roof' })
  assert('error' in res2 && res2.error === 'unknown_draft')
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

import { shortParagraphs } from './parse.ts'
import { unmeasured } from './brief.ts'

Deno.test('shortParagraphs: long prose split at sentences, lists untouched', () => {
  const long = Array.from({ length: 8 }, (_, i) => `Sentence number ${i} has exactly seven words here.`).join(' ')
  const out = shortParagraphs(long)
  for (const p of out.split('\n\n')) assert((p.match(/\S+/g) ?? []).length <= 30)
  assertEquals(out.replace(/\n\n/g, ' '), long)
  const list = '- ' + 'word '.repeat(40).trim()
  assertEquals(shortParagraphs(list), list)
  assertEquals(shortParagraphs('Short one.'), 'Short one.')
})

Deno.test('unmeasured: a published draft the metrics have not caught is listed, newest first', () => {
  const ds = [
    draft('aaaaaaaa-0000-4000-8000-000000000001', 'Kraków weekend', { status: 'published', published_at: '2026-11-16T13:04:00Z' }),
    draft('bbbbbbbb-0000-4000-8000-000000000002', 'Creators who doubled', { status: 'published', published_at: '2026-11-17T14:34:00Z' }),
  ]
  const u = unmeasured(ds, [{ url: 'https://www.linkedin.com/posts/a-1', first_line: 'Kraków weekend', posted_at: '2026-11-16T13:04:00Z', impressions: 400 }],
    { 'aaaaaaaa-0000-4000-8000-000000000001': ['https://www.linkedin.com/posts/a-1'] })
  assertEquals(u.map((d) => d.first_line), ['Creators who doubled'])
})

// ---- Sol r4 fixes (made-up data only) ---------------------------------------
import { planForTarget, normT3, sha256Hex, type Snapshot } from './actions.ts'
import { queueT3Job } from '../_shared/desk-t3.ts'
import { mergedPosts } from './brief.ts'

// a chainable query mock: every call is logged and returns the chain; awaiting it gives `result`
// deno-lint-ignore no-explicit-any
function chain(result: unknown, log: unknown[][] = []): any {
  // deno-lint-ignore no-explicit-any
  const p: any = new Proxy(function () {}, {
    get(_t, k) {
      if (k === 'then') return (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(result).then(res, rej)
      return (...args: unknown[]) => { log.push([String(k), ...args]); return p }
    },
  })
  return p
}
// deno-lint-ignore no-explicit-any
const forbidden: any = new Proxy({}, { get() { throw new Error('no separate read allowed') } })
const ID1 = 'aaaaaaaa-0000-4000-8000-000000000001'

Deno.test('r4#1 delete: a brain draft is never dropped from the desk, dated or not', async () => {
  for (const extra of [{}, { scheduled_at: '2027-03-09T09:45:00Z' }]) {
    const b = draft(ID1, 'Snow in the park this morning', { brain: true, ...extra })
    const r = render(brief([b]))
    const p = await plan({ brief: r, attachments: [], text: '', env: () => undefined } as never, { kind: 'delete', draft: r.handleOf.get(ID1)!, line: 'Snow in the park' })
    assertEquals(p.refuse, 'brain_draft'); assertEquals(p.run, undefined)
    assert(p.echo.label.includes('Brain drafts take Keep or Drop in Review'))
  }
})

Deno.test('r4#2 t3: the verifier string is byte for byte what queueT3Job stores, and planning twice changes nothing', async () => {
  const r = render(brief([]))
  let sent: { title: string; brief: string } | null = null
  const ctx = { brief: r, attachments: [], text: 'Build me the thing', env: () => undefined, t3: async (a: { title: string; brief: string }) => { sent = a; return { job_id: 'j1', status: 'queued' } } } as never
  const act: Record<string, unknown> & { kind: string } = { kind: 't3', title: '  Fix   the\nexport  ', brief: '\n\n    ' + 'x'.repeat(7990) + ' suffix that a re-trim would expose' }
  const p = await plan(ctx, act)
  const verifierTitle = String(act.title), verifierBrief = String(act.brief)
  await plan(ctx, act)
  assertEquals([String(act.title), String(act.brief)], [verifierTitle, verifierBrief])
  await p.run!()
  assertEquals(sent!.title, verifierTitle); assertEquals(sent!.brief, verifierBrief)
  const log: unknown[][] = []
  const db = { from: () => chain({ data: { id: 'j1' }, error: null }, log) }
  await queueT3Job(db, { userId: 'u', messageId: 'm', title: sent!.title, brief: sent!.brief })
  const ins = log.find((l) => l[0] === 'insert')![1] as { title: string; brief: string }
  assertEquals(ins.title, verifierTitle); assertEquals(ins.brief, verifierBrief)
  assertEquals(normT3(verifierTitle, verifierBrief), { title: verifierTitle, brief: verifierBrief })
  const empty = await plan(ctx, { kind: 't3', title: 'A job', brief: '   ' })
  assertEquals(empty.refuse, 'empty')
})

Deno.test('r4#3 date and photo: undo carries exactly what the forward transaction returned, with no separate read', async () => {
  const d = draft(ID1, 'Snow in the park this morning', { updated_at: '2026-11-18T10:00:00.1+00:00' })
  const r = render(brief([d]))
  const calls: unknown[][] = []
  const userDb = { rpc: (name: string, args: unknown) => {
    calls.push([name, args])
    return Promise.resolve({ error: null, data: name === 'desk_set_date'
      ? { ok: true, before: null, applied: '2027-03-09T09:45:00+00:00', applied_status: 'review', applied_updated_at: '2026-11-18T10:00:05+00:00', rpc: { ok: true } }
      : { ok: true, before: [], applied: ['https://img.test/a.jpg'], applied_status: 'review', applied_updated_at: '2026-11-18T10:00:06+00:00', rpc: { ok: true } } })
  } }
  const ctx = { brief: r, attachments: [{ kind: 'photo', url: 'https://img.test/a.jpg' }], text: '', env: () => undefined, userDb, svc: forbidden } as never
  const h = r.handleOf.get(ID1)!
  const pd = await plan(ctx, { kind: 'date', draft: h, line: 'Snow in the park', at: '2027-03-09 10:45' })
  const rd = await pd.run!()
  assertEquals(calls[0], ['desk_set_date', { p_draft: ID1, p_expected_updated_at: d.updated_at, p_expected_status: 'review', p_at: '2027-03-09T09:45:00.000Z' }])
  assertEquals(rd.undo, { op: 'date', draft_id: ID1, prev: null, applied: '2027-03-09T09:45:00+00:00', applied_status: 'review', applied_updated_at: '2026-11-18T10:00:05+00:00' })
  const pp = await plan(ctx, { kind: 'photo_attach', draft: h, line: 'Snow in the park', photo: 1 })
  const rp = await pp.run!()
  assertEquals((calls[1] as [string])[0], 'desk_set_photos')
  assertEquals(rp.undo, { op: 'photos', draft_id: ID1, prev: [], applied: ['https://img.test/a.jpg'], applied_status: 'review', applied_updated_at: '2026-11-18T10:00:06+00:00' })
})

Deno.test('r4#4 held pull: another queue row, no row or an unreadable queue fails closed; a pull never falls back to the calendar', async () => {
  const future = new Date(Date.now() + 5 * 86400e3).toISOString()
  const row = { id: ID1, status: 'scheduled', type: 'text', scheduled_at: future, published_at: null, post_body: 'Snow in the park this morning\nmore', title: '', topic: '',
    taxonomy: {}, qa: null, source_ref: null, image_urls: [], created_at: '2026-11-10T10:00:00Z', updated_at: 'U1', client_id: null }
  const svcWith = (q: unknown) => ({ from: (t: string) => chain(t === 'carousel_drafts' ? { data: row, error: null } : q) })
  const snap = (qid: string | null): Snapshot => ({ target_id: ID1, updated_at: 'U1', status: 'scheduled', first_line_sha: '', scheduled_at: future, image_urls: [],
    queue: qid ? { queue_id: qid, slot_at: future, status: 'pending' } : null, next: qid ? { queue_id: qid, slot_at: future } : null, queue_ids: qid ? [qid] : [] })
  const sha = await sha256Hex('Snow in the park this morning')
  const qB = { data: [{ id: 'q-B', scheduled_at: future, status: 'pending', platform: 'linkedin', is_repost: false }], error: null }
  const rpcs: unknown[][] = []
  const userDb = { rpc: (n: string, a: unknown) => { rpcs.push([n, a]); return Promise.resolve({ data: { ok: true }, error: null }) } }
  const base = { brief: render(brief([])), attachments: [], text: '', env: () => undefined, userDb }
  const act = { kind: 'pull', reason: 'wrong week' }
  assertEquals(await planForTarget({ ...base, svc: svcWith(qB) } as never, { ...act }, { ...snap('q-A'), first_line_sha: sha }), { refuse: 'queue_changed' })
  assertEquals(await planForTarget({ ...base, svc: svcWith({ data: [], error: null }) } as never, { ...act }, { ...snap('q-A'), first_line_sha: sha }), { refuse: 'queue_changed' })
  assertEquals(await planForTarget({ ...base, svc: svcWith({ data: null, error: { message: 'down' } }) } as never, { ...act }, { ...snap('q-B'), first_line_sha: sha }), { refuse: 'queue_read_failed' })
  const ok = await planForTarget({ ...base, svc: svcWith(qB) } as never, { ...act }, { ...snap('q-B'), first_line_sha: sha }) as { run?: () => Promise<unknown> }
  await ok.run!()
  assertEquals(rpcs, [['desk_pull', { p_draft: ID1, p_expected_updated_at: 'U1', p_queue_ids: ['q-B'], p_next_queue: 'q-B', p_next_slot: future, p_reason: 'wrong week' }]])
  // a second live queue row that was not there when it was authorized: refused before any write
  const qAB = { data: [...qB.data, { id: 'q-C', scheduled_at: future, status: 'queued_v2', platform: 'x', is_repost: false }], error: null }
  assertEquals(await planForTarget({ ...base, svc: svcWith(qAB) } as never, { ...act }, { ...snap('q-B'), first_line_sha: sha }), { refuse: 'queue_changed' })
  // proposed without a Next row: refused at once with the Remove date chip, nothing held
  const d = draft(ID1, 'Snow in the park this morning', { status: 'scheduled', scheduled_at: future })
  const r = render(brief([d]))
  const p = await plan({ ...base, brief: { ...r, queueByDraft: new Map() } } as never, { kind: 'pull', draft: r.handleOf.get(ID1)!, line: 'Snow in the park' })
  assertEquals(p.refuse, 'no_queue_row'); assertEquals(p.run, undefined); assertEquals(p.chips?.[0].label, 'Remove the date')
})

Deno.test('r4#5 redo: refused while generating; the flip requires an eligible status AND the authorized updated_at', async () => {
  const gen = draft(ID1, 'Snow in the park this morning', { status: 'generating', updated_at: 'U1' })
  let r = render(brief([gen]))
  const pg = await plan({ brief: r, attachments: [], text: '', env: () => undefined } as never, { kind: 'redo', draft: r.handleOf.get(ID1)!, line: 'Snow in the park' })
  assertEquals(pg.refuse, 'not_redoable'); assertEquals(pg.run, undefined)
  const d = draft(ID1, 'Snow in the park this morning', { status: 'review', updated_at: 'U1' })
  r = render(brief([d]))
  // the claim is desk_redo_claim (locks, authorized status + updated_at, no live queued copy: Sol r6 #6)
  const calls: unknown[][] = []
  let reply: Record<string, unknown> = { ok: false, error: 'changed' }
  const userDb = { rpc: (n: string, a: unknown) => { calls.push([n, a]); return Promise.resolve({ data: reply, error: null }) }, from: () => { throw new Error('no direct table write') } }
  let fired = 0
  const ctx = { brief: r, attachments: [], text: '', env: () => undefined, userDb, fetchImpl: () => { fired++; return Promise.resolve(new Response('ok')) } } as never
  const p = await plan(ctx, { kind: 'redo', draft: r.handleOf.get(ID1)!, line: 'Snow in the park' })
  let err = ''
  try { await p.run!() } catch (e) { err = (e as Error).message }
  assertEquals(err, 'changed'); assertEquals(fired, 0)   // the row was taken by another redo: no second writer call
  assertEquals((calls[0] as [string, Record<string, unknown>])[0], 'desk_redo_claim')
  assertEquals((calls[0] as [string, Record<string, unknown>])[1].p_expected_updated_at, 'U1')
  assertEquals((calls[0] as [string, Record<string, unknown>])[1].p_expected_status, 'review')
  // a live queued copy is refused by the claim, and nothing fires
  reply = { ok: false, error: 'queue_still_live' }; err = ''
  try { await p.run!() } catch (e) { err = (e as Error).message }
  assertEquals(err, 'queue_still_live'); assertEquals(fired, 0)
  // a writer 4xx gives the row back through desk_redo_release
  reply = { ok: true, type: 'text', topic: 't', title: 't' }
  const ctx4 = { brief: r, attachments: [], text: '', env: () => undefined, userDb, fetchImpl: () => { fired++; return Promise.resolve(new Response('no', { status: 422 })) } } as never
  const p4 = await plan(ctx4, { kind: 'redo', draft: r.handleOf.get(ID1)!, line: 'Snow in the park' })
  err = ''; try { await p4.run!() } catch (e) { err = (e as Error).message }
  assertEquals(err, 'writer_refused'); assertEquals(calls.at(-1)![0], 'desk_redo_release')
})

Deno.test('r4#8 last post: one time-sorted list; SUMMARY "Last post out" is its first row', () => {
  const ds = [draft(ID1, 'A ferry at dawn and a cold coffee', { status: 'published', published_at: '2026-11-17T15:00:00Z' })]
  const posts = [{ url: 'https://www.linkedin.com/posts/b-2', first_line: 'Two creators doubled their reach', posted_at: '2026-11-17T14:30:00Z', impressions: 900 }]
  const m = mergedPosts(ds, posts, {})
  assertEquals(m.map((x) => x.first_line), ['A ferry at dawn and a cold coffee', 'Two creators doubled their reach'])
  const txt = render(brief(ds, { posts: { posts }, post_links: {} })).text
  const sum = txt.split('\n').find((l) => l.startsWith('- Last post out:'))!
  assert(sum.includes('A ferry at dawn'), sum)
  const list = txt.split('RECENT PUBLISHED POSTS')[1].split('\n').filter((l) => l.startsWith('- '))
  assert(list[0].includes('A ferry at dawn') && list[1].includes('Two creators'))
})

Deno.test('r4#9 shortParagraphs: never splits inside 1.5x or a URL, keeps the text byte for byte', () => {
  const t = 'The cold brew post reached 1.5x his median in two days, which is the best this month for a text post with no photo at all. ' +
    'The report is at https://example.com/report.html?a=1.5 and has the full numbers for every single post he made. Next week has two open slots. 3 drafts fit that.'
  const out = shortParagraphs(t)
  assert(out.includes('1.5x') && out.includes('https://example.com/report.html?a=1.5 and'))
  assert(!out.includes('1. 5x'))
  assertEquals(out.replace(/\n\n/g, ' '), t)
  for (const p of out.split('\n\n')) assert((p.match(/\S+/g) ?? []).length <= 30, p)
  // a lowercase word after a period (an abbreviation, a domain) is never a cut point
  const abbr = 'word '.repeat(20) + 'see e.g. this and example.com. then ' + 'word '.repeat(20)
  assertEquals(shortParagraphs(abbr), abbr)
})

Deno.test('r4#10 urlInMessage: raw token first, one matched wrapper, trailing punctuation; never an unmatched closer', () => {
  assert(!urlInMessage('https://example.test/report', 'see https://example.test/report] now'))
  assert(urlInMessage('https://example.test/a,', 'file https://example.test/a, please'))
  assert(urlInMessage('https://example.test/report', 'see [https://example.test/report] now'))
  assert(urlInMessage('https://example.test/report', 'see (https://example.test/report). ok'))
  assert(urlInMessage('https://example.test/report', 'see "https://example.test/report"'))
  assert(!urlInMessage('https://example.test/report', 'see ((https://example.test/report))'))
  assert(!urlInMessage('https://example.test/report', 'see (https://example.test/report'))
})

// ---- Sol r5 fixes + eval rV1 items (made-up data only) ---------------------
import { ivanQuote, verbatimIn, actionKey, distinctExcerpt, lockCode } from './actions.ts'
import { canonicalUrl } from './unfurl.ts'
import { oneText } from './parse.ts'

Deno.test('r5 B1: a chip has one text; the model label is dropped', () => {
  const p = parse('<reply>ok</reply><chips>[{"label":"Show draft","send":"remove the date from the tram post"},{"label":"x"}]</chips>')
  assertEquals(p.chips, [{ label: 'remove the date from the tram post', send: 'remove the date from the tram post' }])
  assertEquals(oneText([{ label: 'Pull it first', send: '  pull it  ' }]), [{ label: 'pull it', send: 'pull it' }])
})

Deno.test('r5 B2/B3: approve, Brain Keep and delete go only through the locked desk functions with the authorized revision', async () => {
  const calls: unknown[][] = []
  const userDb = { rpc: (n: string, a: unknown) => { calls.push([n, a]); return Promise.resolve({ data: { ok: true }, error: null }) }, from: () => { throw new Error('no direct table write') } }
  for (const brain of [false, true]) {
    const d = draft(ID1, 'Snow in the park this morning', { updated_at: 'U7', brain })
    const r = render(brief([d]))
    const p = await plan({ brief: r, attachments: [], text: '', env: () => undefined, userDb, svc: forbidden } as never, { kind: 'approve', draft: r.handleOf.get(ID1)!, line: 'Snow in the park' })
    await p.run!()
  }
  const d = draft(ID1, 'Snow in the park this morning', { updated_at: 'U7' })
  const r = render(brief([d]))
  const pd = await plan({ brief: r, attachments: [], text: '', env: () => undefined, userDb, svc: forbidden } as never, { kind: 'delete', draft: r.handleOf.get(ID1)!, line: 'Snow in the park', reason: 'off topic' })
  await pd.run!()
  assertEquals(calls, [
    ['desk_approve', { p_draft: ID1, p_expected_updated_at: 'U7', p_expected_status: 'review' }],
    ['desk_keep', { p_draft: ID1, p_expected_updated_at: 'U7', p_expected_status: 'review' }],
    ['desk_delete', { p_draft: ID1, p_expected_updated_at: 'U7', p_reason: 'off topic' }],
  ])
  // a refusal from the locked check is a code, never a write
  const refuse = { rpc: () => Promise.resolve({ data: { ok: false, error: 'changed' }, error: null }) }
  const pr = await plan({ brief: r, attachments: [], text: '', env: () => undefined, userDb: refuse, svc: forbidden } as never, { kind: 'approve', draft: r.handleOf.get(ID1)!, line: 'Snow in the park' })
  let err = ''; try { await pr.run!() } catch (e) { err = (e as Error).message }
  assertEquals(err, 'changed')
})

Deno.test('r5 B5 + r6 #1: Ivan-attributed text is only his exact words, and the verifier reads exactly the stored fields', async () => {
  const text = 'cold brew queues in Warsaw are wild, worth a post'
  assertEquals(ivanQuote('cold brew queues in Warsaw', text), 'cold brew queues in Warsaw')
  assertEquals(ivanQuote('Ivan said his clients love cold brew', text), null)   // no fallback to the whole message
  assertEquals(ivanQuote(undefined, text), null)
  assert(!verbatimIn('', text))
  for (const [quote, stored] of [['a private line from somewhere else', null], ['cold brew queues in Warsaw', 'cold brew queues in Warsaw']] as const) {
    let inserted: Record<string, unknown> | null = null
    const svc = { from: () => ({ insert: (row: Record<string, unknown>) => { inserted = row; return chain({ data: { id: 'i1' }, error: null }) } }) }
    const topic = 'Cold brew queues ' + 'x'.repeat(300)
    const p = await plan({ brief: render(brief([])), attachments: [], text, env: () => undefined, svc, messageId: 'm1' } as never, { kind: 'idea', text: topic, quote })
    await p.run!()
    const ev = (inserted!.evidence as { quote?: string }[])[0]
    assertEquals(ev.quote ?? null, stored)
    assert(!JSON.stringify(inserted).includes('private line'))
    // every Ivan-facing stored field appears verbatim in what the verifier reads
    assert(p.describe!.includes(String(inserted!.raw_topic)) && p.describe!.includes(String(inserted!.raw_context)))
    assert(stored ? p.describe!.includes(`"${stored}"`) : p.describe!.includes('his own words: nothing'))
  }
  const pl = await plan({ brief: render(brief([])), attachments: [], text: 'file https://example.test/a my take: too long', env: () => undefined } as never, { kind: 'link', url: 'https://example.test/a', note: 'too long' })
  assert(pl.describe!.includes('Stored as his note: "too long"'), pl.describe)
  const pn = await plan({ brief: render(brief([])), attachments: [], text: 'file https://example.test/a', env: () => undefined } as never, { kind: 'link', url: 'https://example.test/a', note: 'he loves it' })
  assert(pn.describe!.includes('Stored as his note: nothing'), pn.describe)
})

Deno.test('r5 B8: one token gives one canonical URL', () => {
  assertEquals(canonicalUrl('https://example.test/resource.'), 'https://example.test/resource.')
  assert(urlInMessage('https://example.test/resource.', 'see https://example.test/resource.'))
  assert(!urlInMessage('https://example.test/resource', 'see https://example.test/resource.'))
  assertEquals(canonicalUrl('(https://example.test/a).'), 'https://example.test/a')
  assertEquals(canonicalUrl('<https://example.test/a>,'), 'https://example.test/a')
  assertEquals(canonicalUrl('report]'), null)
  assertEquals(canonicalUrl('((https://example.test/a))'), null)
})

Deno.test('r5 B7: two posts with the same opener stay two; matching is by linked URL only', () => {
  const ds = [
    draft(ID1, 'Three things I learned this week', { status: 'published', published_at: '2026-11-17T15:00:00Z' }),
    draft('bbbbbbbb-0000-4000-8000-000000000002', 'Three things I learned this week', { status: 'published', published_at: '2026-11-10T15:00:00Z' }),
  ]
  const posts = [{ url: 'https://www.linkedin.com/posts/old-1', first_line: 'Three things I learned this week', posted_at: '2026-11-10T15:00:00Z', impressions: 500 }]
  const links = { 'bbbbbbbb-0000-4000-8000-000000000002': ['https://www.linkedin.com/posts/old-1'] }
  const m = mergedPosts(ds, posts, links)
  assertEquals(m.map((x) => [x.at, !!x.p]), [['2026-11-17T15:00:00Z', false], ['2026-11-10T15:00:00Z', true]])
  assertEquals(unmeasured(ds, posts, null), [])   // no link map: nothing guessed
})

Deno.test('r5 B9 + E4: abbreviations never cut; lists become one block per bullet; the appended failure line is split too', () => {
  const dr = 'I met Dr. Smith at the café and we talked about outreach for a long time, more than an hour, with lots of notes. ' +
    'He said St. Mary is the best spot for a meetup vs. the old town, e.g. Thursdays. No. 5 tram goes there and it is quick.'
  const out = shortParagraphs(dr)
  for (const cut of ['Dr.\n\nSmith', 'St.\n\nMary', 'vs.\n\nthe', 'No.\n\n5']) assert(!out.includes(cut), cut)
  assertEquals(out.replace(/\n\n/g, ' '), dr)
  const list = 'Five picks for the open slots:\n- "Cold brew at 7am" for belief 5.\n- "Tram 33 at rush hour" for belief 1.\n- "A ferry at dawn" for belief 2.'
  assertEquals(shortParagraphs(list), 'Five picks for the open slots:\n\n- "Cold brew at 7am" for belief 5.\n\n- "Tram 33 at rush hour" for belief 1.\n\n- "A ferry at dawn" for belief 2.')
  const failed = 'Sending the tram post back to the writer. It takes a few minutes.\n\nThat did not go through: The writer can\'t take a direction from here yet, so I left "Tram 33 at rush hour is the best market research …" as it is. Say "redo it" to rerun it on the same idea.'
  for (const b of shortParagraphs(failed).split(/\n\s*\n/)) assert((b.match(/\S+/g) ?? []).length < 40, b)
})

Deno.test('eval E3: week blocks show only the calendar panel labels as coverage', () => {
  const thisMon = '2026-11-16'
  const d = draft(ID1, 'Kraków in the snow and a long train ride', { status: 'scheduled', scheduled_at: '2026-11-19T09:45:00Z', vehicle: 'poland_place', belief: 5 })
  const txt = render(brief([d], { this_monday: thisMon, panel: { quotas: [], slots: [{ draft_id: ID1, belief: null, vehicle: null }] } })).text
  const line = txt.split('\n').find((l) => l.includes('Kraków in the snow'))!
  assert(line.includes('calendar belief -') && line.includes('calendar vehicle -') && !line.includes('POLAND'), line)
})

// ---- Sol r6 fixes (made-up data only) ----------------------------------------
Deno.test('r6 #2: an opener shared by two drafts acts on none and shows one chip per draft with a distinct excerpt and day', () => {
  const a = draft(ID1, 'Three things I learned this week about cold email', { scheduled_at: '2026-11-26T09:45:00Z' })
  const b = draft('bbbbbbbb-0000-4000-8000-000000000002', 'Three things I learned this week about hiring')
  const r = render(brief([a, b]))
  const res = resolveDraft(r, { kind: 'delete', draft: r.handleOf.get(ID1)!, line: 'Three things I learned this week' })
  assert('error' in res && res.error === 'ambiguous')
  const chips = (res as { chips: { label: string; send: string }[] }).chips
  assertEquals(chips.length, 2)
  for (const c of chips) assertEquals(c.label, c.send)
  assert(chips[0].send.includes('"Three things I learned this week about cold"') && chips[0].send.includes('dated 2026-11-26'), chips[0].send)
  assert(chips[1].send.includes('"Three things I learned this week about hiring"') && chips[1].send.includes('undated'), chips[1].send)
  // each chip's excerpt names exactly one draft
  for (const d of [a, b]) assertEquals([a, b].filter((o) => lineMatches(o.first_line, distinctExcerpt(d, [a, b]))).length, 1)
  // the longer excerpt resolves, and only with the right handle
  const ok = resolveDraft(r, { kind: 'delete', draft: r.handleOf.get(ID1)!, line: 'Three things I learned this week about cold' })
  assert('d' in ok && ok.d.id === ID1)
  // identical openers: the day narrows it
  const c = draft('cccccccc-0000-4000-8000-000000000003', 'Same opener for both of these posts', { scheduled_at: '2026-11-27T09:45:00Z' })
  const e = draft('dddddddd-0000-4000-8000-000000000004', 'Same opener for both of these posts')
  const r2 = render(brief([c, e]))
  const amb = resolveDraft(r2, { kind: 'approve', draft: r2.handleOf.get(c.id)!, line: 'Same opener for both' })
  assert('error' in amb && amb.error === 'ambiguous')
  const byDay = resolveDraft(r2, { kind: 'approve', draft: r2.handleOf.get(c.id)!, line: 'Same opener for both', dated: '2026-11-27' })
  assert('d' in byDay && byDay.d.id === c.id)
})

Deno.test('r6 #3 + r7 #2: the key is the kind, the resolved target and the canonical args its write consumes', async () => {
  const d = draft(ID1, 'Snow in the park this morning', { updated_at: 'U1' })
  const r = render(brief([d]))
  const ctx = { brief: r, attachments: [], text: 'delete the snow one, wrong topic', env: () => undefined } as never
  const h = r.handleOf.get(ID1)!
  const a = await plan(ctx, { kind: 'delete', draft: h, line: 'Snow in the park', reason: 'wrong  topic' })
  // one extra field the delete never consumes, another excerpt and a model note: the same key
  const b = await plan(ctx, { kind: 'delete', draft: h, line: 'Snow in the park this', reason: 'wrong topic', note: 'x', at: '2027-01-01 10:00', foo: 1 })
  assertEquals(actionKey({ ...a, target_id: ID1 }), actionKey({ ...b, target_id: ID1 }))
  assertEquals(a.canon, { reason: 'wrong topic' })
  // a date consumes only the instant: different times are two actions, the same instant one
  const d1 = await plan(ctx, { kind: 'date', draft: h, line: 'Snow in the park', at: '2027-03-09 10:45' })
  const d2 = await plan(ctx, { kind: 'schedule', draft: h, line: 'Snow in the park', at: '2027-03-09 10:45', reason: 'ignored' })
  const d3 = await plan(ctx, { kind: 'date', draft: h, line: 'Snow in the park', at: '2027-03-10 10:45' })
  assertEquals(actionKey({ ...d1, target_id: ID1 }), actionKey({ ...d2, target_id: ID1 }))
  assert(actionKey({ ...d1, target_id: ID1 }) !== actionKey({ ...d3, target_id: ID1 }))
  // an idea's key is its stored topic and quote; an unused model field changes nothing
  const i1 = await plan(ctx, { kind: 'idea', text: 'Snow posts', quote: 'wrong topic' })
  const i2 = await plan(ctx, { kind: 'idea', text: 'Snow posts', quote: 'wrong topic', tags: ['x'] })
  assertEquals(actionKey(i1), actionKey(i2))
})

Deno.test('r6 #7: a lock timeout or deadlock from any desk write is "it changed, nothing done"', async () => {
  assert(lockCode({ code: '55P03' }) && lockCode({ code: '40P01' }) && !lockCode({ code: '23505' }) && !lockCode(null))
  const d = draft(ID1, 'Snow in the park this morning', { updated_at: 'U1' })
  const r = render(brief([d]))
  for (const code of ['55P03', '40P01']) {
    const userDb = { rpc: () => Promise.resolve({ data: null, error: { code, message: 'x' } }) }
    const p = await plan({ brief: r, attachments: [], text: '', env: () => undefined, userDb, svc: forbidden } as never, { kind: 'approve', draft: r.handleOf.get(ID1)!, line: 'Snow in the park' })
    let err = ''; try { await p.run!() } catch (e) { err = (e as Error).message }
    assertEquals(err, 'changed')
  }
})

Deno.test('eval E5: each published post row states its own 48h window, computed at brief build', () => {
  const posts = [
    { url: 'https://www.linkedin.com/posts/k-1', first_line: 'Just back from a weekend in the mountains', posted_at: '2026-11-16T13:04:00Z', impressions: 400, too_new: true },
    { url: 'https://www.linkedin.com/posts/k-2', first_line: 'A ferry at dawn and a cold coffee', posted_at: '2026-11-18T05:00:00Z', impressions: 90 },
  ]
  const txt = render(brief([], { as_of: '2026-11-18T11:00:00Z', posts: { posts }, post_links: {} })).text
  const lines = txt.split('RECENT PUBLISHED POSTS')[1].split('\n').filter((l) => l.startsWith('- '))
  assert(lines.find((l) => l.includes('mountains'))!.includes('45h since posting, 48h window OPEN'))
  assert(lines.find((l) => l.includes('ferry'))!.includes('6h since posting, 48h window OPEN'))
  const later = render(brief([], { as_of: '2026-11-18T14:00:00Z', posts: { posts }, post_links: {} })).text
  const m = later.split('RECENT PUBLISHED POSTS')[1].split('\n').find((l) => l.includes('mountains'))!
  assert(m.includes('48h since posting, 48h window CLOSED') && m.includes('early read') && !m.includes('too new'), m)
})

import { stripLineHandles } from './parse.ts'
Deno.test('L-handles never reach the reply text', () => {
  const hs = ['L1', 'L2', 'L4']
  assertEquals(stripLineHandles('Post L1, your call line from Mon 2 Nov.', hs), 'Post your call line from Mon 2 Nov.')
  assertEquals(stripLineHandles('Use the pain line (L4) for this week.', hs), 'Use the pain line for this week.')
  assertEquals(stripLineHandles('Take L2 first.', hs), 'Take first.')
  assertEquals(stripLineHandles('An L13 handle not in the brief stays.', hs), 'An L13 handle not in the brief stays.')
})

// ---- Sol r7 fixes + eval rV3 (made-up data only) -------------------------------
import { HandleStream } from './parse.ts'
import { competitorsOf, canonArgs } from './actions.ts'
import { weekCount } from './brief.ts'

Deno.test('r7 #1: dated is enforced on the resolved draft; rivals that start the same way are listed', async () => {
  const a = draft(ID1, 'Snow in the park this morning and a long walk home', { scheduled_at: '2026-11-26T09:45:00Z' })
  const b = draft('bbbbbbbb-0000-4000-8000-000000000002', 'Snow in the city again, trams stuck')
  const r = render(brief([a, b]))
  const wrongDay = resolveDraft(r, { kind: 'delete', draft: r.handleOf.get(ID1)!, line: 'Snow in the park this', dated: '2026-11-27' })
  assert('error' in wrongDay && wrongDay.error === 'dated_mismatch')
  const ok = resolveDraft(r, { kind: 'delete', draft: r.handleOf.get(ID1)!, line: 'Snow in the park this', dated: '2026-11-26' })
  assert('d' in ok)
  assertEquals(competitorsOf(a, 'Snow in the park this', [a, b]).map((x) => x.id), ['bbbbbbbb-0000-4000-8000-000000000002'])
})

Deno.test('r7 #3: the journal-facing canon holds only what each write consumes', () => {
  const ctx = { text: 'file https://example.test/a my note here', attachments: [], brief: render(brief([])) } as never
  assertEquals(canonArgs('link', { kind: 'link', url: 'https://example.test/a', note: 'my note here', extra: 'x' }, ctx), { url: 'https://example.test/a', note: 'my note here' })
  assertEquals(canonArgs('link', { kind: 'link', url: 'https://example.test/a', note: 'not his words' }, ctx), { url: 'https://example.test/a', note: null })
  assertEquals(canonArgs('approve', { kind: 'approve', reason: 'x', at: 'y' }, ctx), {})
})

Deno.test('r7 #5: a writer 4xx with a release that stays busy gives failed_release', async () => {
  const d = draft(ID1, 'Snow in the park this morning', { status: 'review', updated_at: 'U1' })
  const r = render(brief([d]))
  let releases = 0
  const userDb = { rpc: (n: string) => {
    if (n === 'desk_redo_claim') return Promise.resolve({ data: { ok: true, type: 'text', topic: 't', title: 't' }, error: null })
    releases++
    return Promise.resolve({ data: { ok: false, error: 'busy' }, error: null })
  } }
  const ctx = { brief: r, attachments: [], text: '', env: () => undefined, userDb, fetchImpl: () => Promise.resolve(new Response('no', { status: 422 })) } as never
  const p = await plan(ctx, { kind: 'redo', draft: r.handleOf.get(ID1)!, line: 'Snow in the park' })
  let err = ''; try { await p.run!() } catch (e) { err = (e as Error).message }
  assertEquals(err, 'failed_release'); assertEquals(releases, 3)
})

Deno.test('r7 #7: a cloud job says opened only after the queue write is confirmed', async () => {
  const r = render(brief([]))
  for (const [j, want] of [[{ job_id: '', status: 'failed', error: 'x' }, 't3_queue_failed'], [{ job_id: 'j1', status: 'queued' }, 'ok']] as const) {
    const ctx = { brief: r, attachments: [], text: 'build it', env: () => undefined, t3: async () => j } as never
    const p = await plan(ctx, { kind: 't3', title: 'Build it', brief: 'Build the thing.' })
    assert(!p.echo.label.startsWith('Opened'))
    let got = 'ok'; let label = ''
    try { label = String((await p.run!()).label ?? '') } catch (e) { got = (e as Error).message }
    assertEquals(got, want)
    if (want === 'ok') assert(label.startsWith('Opened a cloud thread'))
  }
})

Deno.test('r7 #8: a handle split across deltas is never shown; a quoted L1 is kept', () => {
  const hs = new HandleStream(['L1', 'L2'])
  const outs = [hs.push('Post L'), hs.push('1, your call line from Mon'), hs.push(' 2 Nov is the pick.'), hs.flush()]
  for (const o of outs) assert(!/\bL1\b/.test(o), o)
  assertEquals(outs.join(''), 'Post your call line from Mon 2 Nov is the pick.')
  const q = new HandleStream(['L1', 'L2'])
  const qouts = [q.push('He said "L1 is'), q.push(' the best" and L2'), q.push(' is next.'), q.flush()]
  assertEquals(qouts.join(''), 'He said "L1 is the best" and is next.')
  assertEquals(stripLineHandles('Your words: "take L1 off" (L2).', ['L1', 'L2']), 'Your words: "take L1 off".')
  assertEquals(plain(' a — b ', true), ' a, b ')
})

Deno.test('eval E8: week counts read "N of 5 originals dated (M open)" from the calendar panel', () => {
  assertEquals(weekCount({ originals: 4, cap: 5 }), '4 of 5 originals dated (1 open)')
  assertEquals(weekCount({ originals: 5, cap: 5 }), '5 of 5 originals dated')
  const txt = render(brief([], { this_monday: '2026-11-16', panel: { quotas: [], week_fill: [{ week_start: '2026-11-16', slots: 4 }, { week_start: '2026-11-23', slots: 4 }, { week_start: '2026-11-30', slots: 2 }] } })).text
  assert(txt.includes('THIS WEEK (Mon 2026-11-16 to Sun 2026-11-22): 4 of 5 originals dated (1 open)'), txt.slice(0, 600))
  assert(txt.includes('week after next: 2 of 5 originals dated (3 open)'))
  assert(!/open slots?: ?\d/.test(txt) && !txt.includes('original slots still open'))
})
