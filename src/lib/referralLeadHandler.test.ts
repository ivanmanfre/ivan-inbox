import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { REFERRAL_REVISION } from '../../supabase/functions/inbox-dm-draft/research'
import { storyKey } from '../../supabase/functions/inbox-dm-draft/referral'

// Invented fixtures only (public repo): a made-up studio, referrer and referred person.
const PROSPECT = '61d768d6-5bf9-4777-8eb7-cf6c0b38ae75'
const HANDOFF = '0b5a3d0e-1111-4c2a-9a55-000000000001'
const slugs = ['rise-company-facts', 'rise-reply-voice-core', 'rise-reply-exemplars', 'arch-company-facts', 'arch-reply-voice-core', 'arch-icp-outreach', 'arch-reply-exemplars', 'forbidden-language', 'anti-ai-patterns-outreach-playbook']
const base = { client_id: 'arch', prospect_name: 'Priya Example', prospect_company: 'Northwind Games', channel: 'linkedin', message_type: 'dm', prospect_stage: 'dm_sent', prospect_blacklisted: false, approved_at: null, send_blocked_reason: null, ai_model: null }
const at = (min: number) => new Date(Date.UTC(2026, 10, 5, 12, min)).toISOString()
const row = (id: string, direction: string, text: string, min: number, extra: Record<string, unknown> = {}) => ({ ...base, id, direction, message_text: text, sent_at: at(min), created_at: at(min), ...extra })
const pitch = row('pitch', 'outbound', 'Are you running creator campaigns at the moment?', 0)
const handoff = row(HANDOFF, 'inbound', 'You could contact Tomas Weller, he is the influencer manager here', 10)
const ack = row('ack', 'outbound', "Thanks Priya, I'll reach out to Tomas directly.", 20)
const youToo = row('later-1', 'inbound', 'You too!', 30)
const discarded = row('old-draft', 'outbound', 'Hey Priya, could you introduce me to Tomas?', 15, { sent_at: null, send_blocked_reason: 'discarded_in_inbox' })
const verified = { status: 'verified', input_message_id: HANDOFF, name: 'Tomas Weller', company: 'Northwind Games', role: 'Influencer Manager',
  linkedin_url: 'https://www.linkedin.com/in/tomas-weller-test', member_id: 'ACoAA-test-tomas', summary: 'Tomas Weller is Influencer Manager at Northwind Games.', reason: null,
  draft: 'Hey Tomas\n\nPriya said you are the person for creator campaigns at Northwind.\n\nAre you running them in-house or with an agency?',
  sources: [{ url: 'https://www.linkedin.com/in/tomas-weller-test', title: 'Tomas Weller | LinkedIn profile search' }], acknowledgement: "Thanks Priya, I'll reach out to Tomas." }
// The story after the handoff: our sent acknowledgement plus the replies.
const keyAfter = (...later: { id: string; message_text: string; direction: string; created_at: string }[]) => storyKey([ack, ...later], [])
const checked = (...ids: string[]) => ({ through_message_id: ids.at(-1) ?? HANDOFF, message_ids: ids, verdict: 'go', quote: null, checked_at: at(31) })
const redrafted = 'Hey Tomas\n\nPriya said you are the person for creator campaigns at Northwind.\n\nWhat do you measure that work on these days?'

type Call = { fn: string; args: Record<string, unknown> }
async function run(rows: Record<string, unknown>[], opts: { body?: Record<string, unknown>; server?: boolean; enrichment?: Record<string, unknown>; model?: (prompt: string) => unknown; apify?: unknown[]; rpc?: (fn: string, args: Record<string, unknown>) => unknown; credits?: number | null; noSeat?: boolean }) {
  const calls: Call[] = []
  const upstream: string[] = []
  const apifyBodies: unknown[] = []
  const balanceReads: string[] = []
  let handler: (req: Request) => Promise<Response> = () => { throw Error('handler not loaded') }
  const sb = {
    rpc: async (fn: string, args: Record<string, unknown>) => { calls.push({ fn, args }); return { data: opts.rpc ? opts.rpc(fn, args) : true, error: null } },
    auth: { getUser: async () => ({ data: { user: { id: 'owner' } } }) },
    from(table: string) {
      let fields = '*', direction: unknown = null
      const query = {
        select(value: string) { fields = value; return query },
        eq(field: string, value: unknown) { if (field === 'direction') direction = value; return query }, in() { return query },
        order() { return query }, limit() { return query }, not() { return query },
        maybeSingle: async () => ({ data: table === 'integration_config' && !opts.noSeat ? { value: 'config-value' } : null }),
        single: async () => ({ data: fields.startsWith('referral:') ? { referral: null } : { operator_note: null, enrichment_data: opts.enrichment ?? {}, linkedin_url: 'https://www.linkedin.com/in/priya-example-test' } }),
        then(resolve: (value: unknown) => unknown) {
          const data = table === 'content_prompts' ? slugs.map(slug => ({ slug, body: 'current verified rules', updated_at: '2026-11-20' }))
            : rows.filter(r => direction === null || r.direction === direction).map(r => Object.fromEntries(fields.split(',').map(f => [f, r[f]])))
          return Promise.resolve({ data, error: null }).then(resolve)
        },
      }
      return query
    },
  }
  const dir = new URL('../../supabase/functions/inbox-dm-draft/', import.meta.url)
  const globals = {
    Deno: { env: { get: (name: string) => name === 'INBOX_CLAUDE_ALLOWED_USER_ID' ? 'owner' : 'configured' }, serve: (fn: typeof handler) => { handler = fn } },
    Response, AbortSignal, URL, console, decodeURIComponent, encodeURIComponent,
    fetch: async (url: string, init: { body: string }) => {
      // The seat's InMail credit balance (a read; nothing is sent). null = unreadable.
      if (url.includes('/linkedin/inmail_balance')) { balanceReads.push(url); return opts.credits === null ? new Response('', { status: 500 }) : Response.json({ sales_navigator: opts.credits ?? 40 }) }
      if (url.includes('api.apify.com')) { apifyBodies.push(JSON.parse(init.body)); return Response.json(opts.apify ?? []) }
      const prompt = JSON.parse(init.body).messages[0].content as string
      upstream.push(prompt)
      return Response.json({ content: [{ type: 'text', text: JSON.stringify(opts.model ? opts.model(prompt) : {}) }] })
    },
  }
  const loaded = new Map<string, unknown>()
  const load = (file: string): unknown => {
    if (loaded.has(file)) return loaded.get(file)
    const exports = {}
    loaded.set(file, exports)
    const compiled = ts.transpileModule(readFileSync(new URL(file, dir), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
    runInNewContext(compiled, { ...globals, globalThis: globals, exports, require: (name: string) => name.startsWith('npm:') ? { createClient: () => sb } : load(name.replace(/^\.\//, '')) })
    return exports
  }
  load('index.ts')
  const headers: Record<string, string> = opts.server ? { 'x-inbox-secret': 'configured' } : { Authorization: 'Bearer owner-token' }
  const response = await handler(new Request('https://test/draft', { method: 'POST', headers, body: JSON.stringify({ prospect_id: PROSPECT, ...opts.body }) }))
  return { status: response.status, result: await response.json(), calls, upstream, apifyBodies, balanceReads }
}

const judge = (verdict: string, quote: string | null = null) => (prompt: string) =>
  prompt.includes('A condition inside the handoff') ? { verdict, quote } : prompt.includes('Write the first') ? { paragraphs: redrafted.split('\n\n'), reason: null } : { name: null }

describe('a verified referral stays open after later replies', () => {
  it('a courtesy reply is read by the model, leaves the card open and saves the check', async () => {
    const cached = { ...verified, revision: REFERRAL_REVISION, story_key: keyAfter(youToo) }
    const { status, result, calls, upstream } = await run([pitch, handoff, ack, youToo], { server: true, body: { mode: 'referral' }, enrichment: { inbox_referral: cached }, model: judge('go') })
    expect(status).toBe(200)
    expect(result.referral).toMatchObject({ status: 'verified', input_message_id: HANDOFF, later: { through_message_id: 'later-1', message_ids: ['later-1'], verdict: 'go' } })
    expect(upstream).toHaveLength(1)
    expect(upstream[0]).toContain('You too!')
    expect(calls[0]).toMatchObject({ fn: 'inbox_set_referral_v2', args: { p_keep_verified: true } })
  })
  it('"hold off" pauses it with the referrer’s own words', async () => {
    const hold = row('later-2', 'inbound', 'Please hold off contacting Tomas until January, he is on leave', 40)
    const cached = { ...verified, revision: REFERRAL_REVISION, story_key: keyAfter(youToo), later: checked('later-1') }
    const { result } = await run([pitch, handoff, ack, youToo, hold], { server: true, body: { mode: 'referral' }, enrichment: { inbox_referral: cached }, model: judge('hold', 'Please hold off contacting Tomas until January') })
    expect(result.referral.later).toMatchObject({ through_message_id: 'later-2', message_ids: ['later-1', 'later-2'], verdict: 'hold', quote: 'Please hold off contacting Tomas until January' })
    // The new reply also redrafts the DM from the changed story.
    expect(result.referral.story_key).toBe(keyAfter(youToo, hold))
  })
  it('an older-revision draft is redrafted from the stored identity with the whole story, without a new profile search', async () => {
    const cached = { ...verified, revision: REFERRAL_REVISION - 1 }
    const { result, upstream, apifyBodies } = await run([pitch, handoff, discarded, ack, youToo], { server: true, body: { mode: 'referral' }, enrichment: { inbox_referral: cached }, model: judge('go') })
    // Only the stored profile is read (its member id is pinned for Create); no search.
    expect(apifyBodies).toEqual([expect.objectContaining({ publicIdentifiers: ['tomas-weller-test'] })])
    expect(result.referral).toMatchObject({ status: 'verified', revision: REFERRAL_REVISION, draft: redrafted, linkedin_url: verified.linkedin_url })
    const drafting = upstream.find(p => p.includes('Write the first'))!
    // The handoff, every later message and the operator's discarded draft all reach the drafter.
    expect(drafting).toContain('"referral_message"')
    expect(drafting).toContain('You too!')
    expect(drafting).toContain('could you introduce me to Tomas?')
    expect(drafting).toContain('discarded by the operator')
    expect(drafting).toContain('Never quote or paraphrase anything else the referrer said')
  })
  it('a newer reply that only looks like a handoff names nobody: the open referral stands', async () => {
    const vague = row('vague', 'inbound', 'You can reach out to someone else from the studio too', 30)
    const cached = { ...verified, revision: REFERRAL_REVISION }
    const { result, apifyBodies } = await run([pitch, handoff, ack, vague], { server: true, body: { mode: 'referral' }, enrichment: { inbox_referral: cached }, model: judge('go') })
    expect(apifyBodies.every(b => Array.isArray((b as { publicIdentifiers?: unknown }).publicIdentifiers))).toBe(true)
    expect(result.referral).toMatchObject({ status: 'verified', input_message_id: HANDOFF, name: 'Tomas Weller', passed_over: ['vague'], later: { through_message_id: 'vague', verdict: 'go' } })
  })
})

// The InMail drafter (ARCH): a fuller intro with a short subject; the note drafter answers as before.
const inmailBody = "Hey Tomas\n\nPriya pointed me to you for creator campaigns at Northwind Games.\n\nI'm Davorin, founder of ARCH. We run creator campaigns for mobile games, for studios like Example Studio.\n\nAre you open to an intro chat sometime next week?"
const withInmail = (verdict = 'go', inmail: Record<string, unknown> = { subject: 'ARCH x Northwind', paragraphs: inmailBody.split('\n\n'), reason: null }) => (prompt: string) =>
  prompt.includes('Write the first LinkedIn InMail') ? inmail : judge(verdict)(prompt)

describe('the ARCH first touch as an InMail', () => {
  it('a redraft writes the InMail beside the invite note when the seat has credits and the URL still shows the verified member', async () => {
    const cached = { ...verified, revision: REFERRAL_REVISION - 1 }
    const tomas = [{ id: 'ACoAA-test-tomas', publicIdentifier: 'tomas-weller-test', firstName: 'Tomas', lastName: 'Weller' }]
    const { result, upstream, apifyBodies, balanceReads } = await run([pitch, handoff, ack, youToo], { server: true, body: { mode: 'referral' }, enrichment: { inbox_referral: cached }, model: withInmail(), credits: 12, apify: tomas })
    expect(balanceReads).toHaveLength(1)
    expect(apifyBodies).toEqual([expect.objectContaining({ publicIdentifiers: ['tomas-weller-test'] })])
    expect(result.referral).toMatchObject({ draft: redrafted, inmail: { subject: 'ARCH x Northwind', body: inmailBody }, inmail_route: { channel: 'inmail', credits: 12, open_profile: null }, member_id: 'ACoAA-test-tomas' })
    const prompt = upstream.find(p => p.includes('Write the first LinkedIn InMail'))!
    expect(prompt).toContain('scale line')
    expect(prompt).toContain('No link of any kind')
  })
  it('no credits: their profile is read through Apify, and a closed profile keeps the invite note with the reason', async () => {
    const cached = { ...verified, revision: REFERRAL_REVISION - 1 }
    const closed = [{ id: 'ACoAA-test-tomas', publicIdentifier: 'tomas-weller-test', firstName: 'Tomas', lastName: 'Weller', openProfile: false }]
    const { result, upstream, apifyBodies } = await run([pitch, handoff, ack, youToo], { server: true, body: { mode: 'referral' }, enrichment: { inbox_referral: cached }, model: withInmail(), credits: 0, apify: closed })
    expect(apifyBodies).toEqual([expect.objectContaining({ publicIdentifiers: ['tomas-weller-test'] })])
    expect(result.referral.inmail).toBeNull()
    expect(result.referral.inmail_route).toMatchObject({ channel: 'connection_note', credits: 0, open_profile: false })
    expect(result.referral.inmail_route.why).toContain('no InMail credits')
    expect(upstream.some(p => p.includes('Write the first LinkedIn InMail'))).toBe(false)
  })
  it('a profile that cannot be read, or shows someone else, drafts no InMail even with credits', async () => {
    const cached = { ...verified, revision: REFERRAL_REVISION - 1 }
    for (const apify of [[], [{ id: 'ACoAA-test-other', publicIdentifier: 'tomas-weller-test', firstName: 'Marta', lastName: 'Example' }]]) {
      const { result, upstream } = await run([pitch, handoff, ack, youToo], { server: true, body: { mode: 'referral' }, enrichment: { inbox_referral: cached }, model: withInmail(), credits: 12, apify })
      expect(result.referral.inmail).toBeNull()
      expect(result.referral.inmail_route).toMatchObject({ channel: 'connection_note' })
      // The verified member stays recorded; the read never replaces it.
      expect(result.referral.member_id).toBe('ACoAA-test-tomas')
      expect(upstream.some(p => p.includes('Write the first LinkedIn InMail'))).toBe(false)
    }
  })
  it('a referral left unresolved (its supplied profile showed another person) gets no lead staged (Sol r6)', async () => {
    const unresolved = { ...verified, status: 'unresolved', revision: REFERRAL_REVISION, story_key: keyAfter(youToo), later: checked('later-1'), member_id: undefined }
    const got = await run([pitch, handoff, ack, youToo], { body: { mode: 'referral_lead', input_message_id: HANDOFF, draft: verified.draft, linkedin_url: verified.linkedin_url, story_key: keyAfter(youToo) },
      enrichment: { inbox_referral: unresolved }, credits: 12, rpc: () => true })
    expect(got.status).toBe(409)
    expect(got.calls.find(c => c.fn === 'inbox_referral_create_lead')).toBeUndefined()
  })
  it.each([
    ['given name carries the surname', 'Tomas Weller', 'Tomas Weller', 'Rivera'],
    ['another surname', 'Tomas Weller', 'Tomas', 'Rivera'],
    ['compound surnames sharing the last word', 'Tomas Garcia Weller', 'Tomas', 'Lopez Weller'],
    ['a generational suffix', 'Tomas Weller', 'Tomas', 'Weller Jr.'],
    ['the whole name in the given-name field', 'Tomas Weller', 'Tomas Weller', ''],
  ])('an unpinned referral whose profile shows another person (%s) gets no lead staged (Sol r7/r8/r9)', async (_case, name, firstName, lastName) => {
    const legacy = { ...verified, name, revision: REFERRAL_REVISION, story_key: keyAfter(youToo), later: checked('later-1'), member_id: undefined }
    const other = [{ id: 'ACoAA-test-other', publicIdentifier: 'tomas-weller-test', firstName, lastName, openProfile: true }]
    const got = await run([pitch, handoff, ack, youToo], { body: { mode: 'referral_lead', input_message_id: HANDOFF, draft: verified.draft, linkedin_url: verified.linkedin_url, story_key: keyAfter(youToo) },
      enrichment: { inbox_referral: legacy }, apify: other, credits: 12, rpc: () => true })
    expect(got.status).toBe(409)
    expect(got.calls.find(c => c.fn === 'inbox_referral_create_lead')).toBeUndefined()
  })
  it('a legacy unpinned referral: the note Create stages even with credits and an open profile, with no redraft loop (Sol r5)', async () => {
    const legacy = { ...verified, revision: REFERRAL_REVISION, story_key: keyAfter(youToo), later: checked('later-1'), member_id: undefined }
    const open = [{ id: 'ACoAA-test-tomas', publicIdentifier: 'tomas-weller-test', firstName: 'Tomas', lastName: 'Weller', openProfile: true }]
    const got = await run([pitch, handoff, ack, youToo], { body: { mode: 'referral_lead', input_message_id: HANDOFF, draft: verified.draft, linkedin_url: verified.linkedin_url, story_key: keyAfter(youToo) },
      enrichment: { inbox_referral: legacy }, apify: open, credits: 12, rpc: fn => fn === 'inbox_referral_create_lead' ? { status: 'created', lead_prospect_id: '00000000-0000-4000-8000-0000000000aa', message_id: 'm' } : true })
    expect(got.status).toBe(200)
    expect(got.result.inmail_available).toBeUndefined()
    expect(got.calls.find(c => c.fn === 'inbox_referral_create_lead')!.args).toMatchObject({ p_channel: 'connection_note' })
  })
  it('a referral with no verified member (researched before it was recorded) gets no InMail, and no profile read (Sol r4)', async () => {
    const legacy = { ...verified, member_id: undefined, revision: REFERRAL_REVISION - 1 }
    const rivera = [{ id: 'ACoAA-test-rivera', publicIdentifier: 'tomas-weller-test', firstName: 'Tomas', lastName: 'Rivera', openProfile: true }]
    const { result, upstream, apifyBodies } = await run([pitch, handoff, ack, youToo], { server: true, body: { mode: 'referral' }, enrichment: { inbox_referral: legacy }, model: withInmail(), credits: 12, apify: rivera })
    expect(apifyBodies).toHaveLength(0)
    expect(result.referral.inmail ?? null).toBeNull()
    expect(result.referral.inmail_route).toMatchObject({ channel: 'connection_note' })
    expect(result.referral.member_id ?? null).toBeNull()
    expect(upstream.some(p => p.includes('Write the first LinkedIn InMail'))).toBe(false)
  })
  it('a redraft the drafter declines keeps the verified member (Sol r4)', async () => {
    const cached = { ...verified, revision: REFERRAL_REVISION - 1 }
    const { result } = await run([pitch, handoff, ack, youToo], { server: true, body: { mode: 'referral' }, enrichment: { inbox_referral: cached }, model: () => ({ paragraphs: [], reason: 'declined' }), credits: 12 })
    expect(result.referral.draft).toBeNull()
    expect(result.referral.member_id).toBe('ACoAA-test-tomas')
  })
  it('an open profile goes as an InMail even with the credits unreadable', async () => {
    const cached = { ...verified, revision: REFERRAL_REVISION - 1 }
    const open = [{ id: 'ACoAA-test-tomas', publicIdentifier: 'tomas-weller-test', firstName: 'Tomas', lastName: 'Weller', openProfile: true }]
    const { result } = await run([pitch, handoff, ack, youToo], { server: true, body: { mode: 'referral' }, enrichment: { inbox_referral: cached }, model: withInmail(), credits: null, apify: open })
    expect(result.referral.inmail_route).toMatchObject({ channel: 'inmail', credits: null, open_profile: true })
    expect(result.referral.inmail).toMatchObject({ subject: 'ARCH x Northwind' })
  })
  it('an InMail with a link, a long subject or no subject is not kept', async () => {
    const cached = { ...verified, revision: REFERRAL_REVISION - 1 }
    for (const bad of [{ subject: 'ARCH x Northwind', paragraphs: ['Hey Tomas', 'See https://example.test/deck'] }, { subject: 'A subject that runs far too long for this', paragraphs: ['Hey Tomas', 'Hi'] }, { paragraphs: ['Hey Tomas', 'Hi'] }]) {
      const { result } = await run([pitch, handoff, ack, youToo], { server: true, body: { mode: 'referral' }, enrichment: { inbox_referral: cached }, model: withInmail('go', bad), credits: 3 })
      expect(result.referral.inmail).toBeNull()
      expect(result.referral.draft).toBe(redrafted)
    }
  })
  it('other seats never read credits or draft an InMail', async () => {
    const rise = [pitch, handoff, ack, youToo].map(r => ({ ...r, client_id: 'risedtc' }))
    const { result, balanceReads } = await run(rise, { server: true, body: { mode: 'referral' }, enrichment: { inbox_referral: { ...verified, revision: REFERRAL_REVISION - 1 } }, model: withInmail(), credits: 9 })
    expect(balanceReads).toHaveLength(0)
    expect(result.referral.inmail ?? null).toBeNull()
  })
})

describe('a conditional handoff and a staged invite', () => {
  it('the handoff itself is read for a hold even with no later reply', async () => {
    const conditional = row(HANDOFF, 'inbound', 'Hold off until January, then talk to Tomas Weller, he is the influencer manager here', 10)
    const cached = { ...verified, revision: REFERRAL_REVISION, story_key: '' }
    const { result, upstream } = await run([pitch, conditional], { server: true, body: { mode: 'referral' }, enrichment: { inbox_referral: cached }, model: judge('hold', 'Hold off until January') })
    expect(upstream.some(p => p.includes('A condition inside the handoff counts too'))).toBe(true)
    expect(result.referral.later).toMatchObject({ verdict: 'hold', quote: 'Hold off until January', message_ids: [] })
  })
  it('a reply after the invite was staged is read, and a hold takes the invite back to review', async () => {
    const hold = row('later-2', 'inbound', 'Actually please hold off on Tomas for now', 40)
    const linked = { ...verified, revision: REFERRAL_REVISION, story_key: keyAfter(youToo), later: checked('later-1'), lead_prospect_id: '00000000-0000-4000-8000-0000000000aa', lead_message_id: '00000000-0000-4000-8000-0000000000bb' }
    const { calls } = await run([pitch, handoff, ack, youToo, hold], { server: true, body: { mode: 'referral' }, enrichment: { inbox_referral: linked }, model: judge('hold', 'please hold off on Tomas for now') })
    const paused = calls.find(c => c.fn === 'inbox_referral_lead_later')!
    expect(paused.args).toMatchObject({ p_referrer: PROSPECT, p_input_message: HANDOFF, p_later: { verdict: 'hold', message_ids: ['later-1', 'later-2'] } })
  })
})

describe('create referred lead', () => {
  const ready = { ...verified, revision: REFERRAL_REVISION, story_key: keyAfter(youToo), later: checked('later-1') }
  const profile = [{ id: 'ACoAA-test-tomas', publicIdentifier: 'tomas-weller-test', firstName: 'Tomas', lastName: 'Weller', headline: 'Influencer Manager',
    location: { linkedinText: 'Lisbon, Portugal', parsed: { country: 'Portugal', city: 'Lisbon', state: null } } }]
  const body = (draft = verified.draft, linkedin_url = verified.linkedin_url) => ({ mode: 'referral_lead', input_message_id: HANDOFF, draft, linkedin_url, story_key: keyAfter(youToo) })
  it('stages one held invite note through the database function, flagged for a by-hand check', async () => {
    const { status, result, calls, apifyBodies } = await run([pitch, handoff, ack, youToo], { body: body(), enrichment: { inbox_referral: ready }, apify: profile, credits: 0,
      rpc: fn => fn === 'inbox_referral_create_lead' ? { status: 'created', lead_prospect_id: '00000000-0000-4000-8000-0000000000aa', message_id: 'm' } : true })
    expect(status).toBe(200)
    expect(result.lead).toMatchObject({ status: 'created' })
    expect(apifyBodies[0]).toMatchObject({ publicIdentifiers: ['tomas-weller-test'] })
    const made = calls.find(c => c.fn === 'inbox_referral_create_lead')!
    expect(made.args).toMatchObject({ p_referrer: PROSPECT, p_input_message: HANDOFF, p_revision: REFERRAL_REVISION, p_text: verified.draft, p_expected_url: verified.linkedin_url, p_later_ids: ['later-1'],
      p_lead: { linkedin_url: 'https://www.linkedin.com/in/tomas-weller-test', provider_id: 'ACoAA-test-tomas', country: 'Portugal', company: 'Northwind Games' } })
    expect((made.args.p_evidence as { review_note: string }).review_note).toContain('already messaged Tomas by hand on LinkedIn')
  })
  const inmailReady = { ...ready, inmail: { subject: 'ARCH x Northwind', body: inmailBody }, inmail_route: { channel: 'inmail', credits: 12, open_profile: null, why: 'credits', checked_at: at(31) } }
  const inmailBodyReq = (over: Record<string, unknown> = {}) => ({ ...body(inmailBody), channel: 'inmail', subject: 'ARCH x Northwind', note: verified.draft, ...over })
  const created = (fn: string) => fn === 'inbox_referral_create_lead' ? { status: 'created', lead_prospect_id: '00000000-0000-4000-8000-0000000000aa', message_id: 'm' } : true
  it('stages one held InMail when the seat has credits, with the lane, seat and recipient the sender checks', async () => {
    const { status, result, calls } = await run([pitch, handoff, ack, youToo], { body: inmailBodyReq(), enrichment: { inbox_referral: inmailReady }, apify: profile, rpc: created, credits: 12 })
    expect(status).toBe(200)
    expect(result.lead).toMatchObject({ status: 'created', channel: 'inmail' })
    const made = calls.find(c => c.fn === 'inbox_referral_create_lead')!
    expect(made.args).toMatchObject({ p_channel: 'inmail', p_text: `Subject: ARCH x Northwind\n\n${inmailBody}`,
      p_evidence: { sent_as: 'inmail', delivery_lane: 'arch_referral_inmail', inmail_api: 'sales_navigator', inmail_provider_id: 'ACoAA-test-tomas', sender_account_id: 'config-value', fallback_note: verified.draft, no_sequence_enrollment: true } })
    expect((made.args.p_evidence as { review_note: string }).review_note).toContain('LinkedIn InMail (one Sales Navigator credit)')
  })
  it('no credits and a closed profile at Create: nothing is staged, and the answer says why so the card shows the note', async () => {
    const closed = [{ ...profile[0], openProfile: false }]
    const { status, result, calls } = await run([pitch, handoff, ack, youToo], { body: inmailBodyReq(), enrichment: { inbox_referral: inmailReady }, apify: closed, rpc: created, credits: 0 })
    expect(status).toBe(409)
    expect(result.inmail_unavailable).toContain('no InMail credits')
    expect(calls.find(c => c.fn === 'inbox_referral_create_lead')).toBeUndefined()
  })
  it('a reviewed URL that now resolves to another member with the same first name is refused for both channels (Sol r2)', async () => {
    const rivera = [{ ...profile[0], id: 'ACoAA-test-rivera', lastName: 'Rivera' }]
    for (const req of [body(), inmailBodyReq()]) {
      const got = await run([pitch, handoff, ack, youToo], { body: req, enrichment: { inbox_referral: inmailReady }, apify: rivera, rpc: created, credits: 0 })
      expect(got.status).toBe(409)
      expect(got.result.error).toContain('not the member the draft was checked against')
      expect(got.calls.find(c => c.fn === 'inbox_referral_create_lead')).toBeUndefined()
    }
    // An InMail with no pinned member id is never staged.
    const unpinned = { ...inmailReady, member_id: undefined }
    const none = await run([pitch, handoff, ack, youToo], { body: inmailBodyReq(), enrichment: { inbox_referral: unpinned }, apify: profile, rpc: created })
    expect(none.status).toBe(409)
    expect(none.calls.find(c => c.fn === 'inbox_referral_create_lead')).toBeUndefined()
  })
  it('a redraft after the URL moved to another member keeps the first pin, and Create refuses both channels (Sol r3)', async () => {
    const rivera = [{ ...profile[0], id: 'ACoAA-test-rivera', lastName: 'Rivera' }]
    const moved = await run([pitch, handoff, ack, youToo], { server: true, body: { mode: 'referral' }, enrichment: { inbox_referral: { ...inmailReady, revision: REFERRAL_REVISION - 1 } }, model: withInmail(), credits: 12, apify: rivera })
    expect(moved.result.referral.inmail_route).toMatchObject({ channel: 'connection_note' })
    expect(moved.result.referral.member_id).toBe('ACoAA-test-tomas')
    expect(moved.result.referral.inmail ?? null).toBeNull()
    const repinned = { ...ready, ...moved.result.referral }
    for (const req of [body(), inmailBodyReq()]) {
      const got = await run([pitch, handoff, ack, youToo], { body: req, enrichment: { inbox_referral: repinned }, apify: rivera, rpc: created, credits: 12 })
      expect(got.status).toBe(409)
      expect(got.calls.find(c => c.fn === 'inbox_referral_create_lead')).toBeUndefined()
    }
  })
  it('an open profile with no sender seat: the note stages, with no InMail ping-pong (Sol r3)', async () => {
    const open = [{ ...profile[0], openProfile: true }]
    const inm = await run([pitch, handoff, ack, youToo], { body: inmailBodyReq(), enrichment: { inbox_referral: inmailReady }, apify: open, rpc: created, credits: 0, noSeat: true })
    expect(inm.status).toBe(409)
    expect(inm.result.inmail_unavailable).toContain('sender seat')
    const note = await run([pitch, handoff, ack, youToo], { body: body(), enrichment: { inbox_referral: inmailReady }, apify: open, rpc: created, credits: 0, noSeat: true })
    expect(note.status).toBe(200)
    expect(note.calls.find(c => c.fn === 'inbox_referral_create_lead')!.args).toMatchObject({ p_channel: 'connection_note' })
  })
  it('a note Create when an InMail can go now stages nothing and says so (Sol r2), unless the drafter declined the InMail', async () => {
    const noteOnly = { ...ready, inmail_route: { channel: 'connection_note', credits: 0, open_profile: false, why: 'none', checked_at: at(31) } }
    const back = await run([pitch, handoff, ack, youToo], { body: body(), enrichment: { inbox_referral: noteOnly }, apify: profile, rpc: created, credits: 12 })
    expect(back.status).toBe(409)
    expect(back.result.inmail_available).toContain('12 Sales Navigator InMail credits')
    expect(back.calls.find(c => c.fn === 'inbox_referral_create_lead')).toBeUndefined()
    const late = await run([pitch, handoff, ack, youToo], { body: body(), enrichment: { inbox_referral: inmailReady }, apify: profile, rpc: created, credits: 12 })
    expect(late.status).toBe(409)
    const declined = { ...ready, inmail: null, inmail_route: { ...inmailReady.inmail_route } }
    const kept = await run([pitch, handoff, ack, youToo], { body: body(), enrichment: { inbox_referral: declined }, apify: profile, rpc: created, credits: 12 })
    expect(kept.status).toBe(200)
    expect(kept.calls.find(c => c.fn === 'inbox_referral_create_lead')!.args).toMatchObject({ p_channel: 'connection_note' })
  })
  it('a reviewed URL that now shows another person is refused for both channels', async () => {
    const other = [{ ...profile[0], firstName: 'Marta', lastName: 'Example' }]
    for (const req of [body(), inmailBodyReq()]) {
      const got = await run([pitch, handoff, ack, youToo], { body: req, enrichment: { inbox_referral: inmailReady }, apify: other, rpc: created })
      expect(got.status).toBe(409)
      expect(got.result.error).toContain('now shows Marta Example')
      expect(got.calls.find(c => c.fn === 'inbox_referral_create_lead')).toBeUndefined()
    }
  })
  it('an open profile goes free at Create even with no credits', async () => {
    const open = [{ ...profile[0], openProfile: true }]
    const { calls } = await run([pitch, handoff, ack, youToo], { body: inmailBodyReq(), enrichment: { inbox_referral: inmailReady }, apify: open, rpc: created, credits: 0 })
    const made = calls.find(c => c.fn === 'inbox_referral_create_lead')!
    expect(made.args).toMatchObject({ p_channel: 'inmail' })
    expect((made.args.p_evidence as { review_note: string }).review_note).toContain('free: their profile is open')
  })
  it('refuses an InMail edited to carry a link or dashes, a long fallback note, or one the card never showed', async () => {
    const link = await run([pitch, handoff, ack, youToo], { body: inmailBodyReq({ draft: `${inmailBody}\n\nhttps://example.test` }), enrichment: { inbox_referral: inmailReady }, apify: profile, rpc: created })
    expect(link.status).toBe(400)
    expect(link.result.error).toContain('no links')
    expect((await run([pitch, handoff, ack, youToo], { body: inmailBodyReq({ subject: 'ARCH — Northwind' }), enrichment: { inbox_referral: inmailReady }, apify: profile, rpc: created })).status).toBe(400)
    const longNote = await run([pitch, handoff, ack, youToo], { body: inmailBodyReq({ note: 'x'.repeat(301) }), enrichment: { inbox_referral: inmailReady }, apify: profile, rpc: created })
    expect(longNote.status).toBe(400)
    expect(longNote.result.error).toContain('fallback invite note')
    const none = await run([pitch, handoff, ack, youToo], { body: inmailBodyReq(), enrichment: { inbox_referral: ready }, apify: profile, rpc: created })
    expect(none.status).toBe(409)
    expect(none.calls.find(c => c.fn === 'inbox_referral_create_lead')).toBeUndefined()
  })
  it('the cron secret can never create a lead', async () => {
    expect((await run([pitch, handoff], { server: true, body: body(), enrichment: { inbox_referral: ready } })).status).toBe(403)
  })
  it('refuses a paused referral, an unread later reply, a long note and another tenant', async () => {
    const paused = { ...ready, later: { ...ready.later, verdict: 'hold', quote: 'hold off' } }
    expect((await run([pitch, handoff, ack, youToo], { body: body(), enrichment: { inbox_referral: paused } })).status).toBe(409)
    const unread = row('later-2', 'inbound', 'one more thing', 40)
    expect((await run([pitch, handoff, ack, youToo, unread], { body: body(), enrichment: { inbox_referral: ready } })).status).toBe(409)
    const long = await run([pitch, handoff, ack, youToo], { body: body('x'.repeat(301)), enrichment: { inbox_referral: ready } })
    expect(long.status).toBe(400)
    expect(long.result.error).toContain('300')
    // The card showed a draft written before the latest message we sent.
    expect((await run([pitch, handoff, ack, youToo], { body: { ...body(), story_key: 'older-story' }, enrichment: { inbox_referral: ready } })).status).toBe(409)
    // The card reviewed another person than the one stored now.
    expect((await run([pitch, handoff, ack, youToo], { body: body(verified.draft, 'https://www.linkedin.com/in/someone-else-test'), enrichment: { inbox_referral: ready } })).status).toBe(409)
    const rise = [pitch, handoff, ack, youToo].map(r => ({ ...r, client_id: 'risedtc' }))
    const other = await run(rise, { body: body(), enrichment: { inbox_referral: ready } })
    expect(other.status).toBe(409)
    expect(other.calls.find(c => c.fn === 'inbox_referral_create_lead')).toBeUndefined()
  })
  it('a dismissal closes the card through the database function', async () => {
    const { result, calls } = await run([pitch, handoff], { body: { mode: 'referral_dismiss', input_message_id: HANDOFF }, enrichment: { inbox_referral: ready } })
    expect(result).toEqual({ dismissed: true })
    expect(calls[0]).toMatchObject({ fn: 'inbox_referral_dismiss', args: { p_referrer: PROSPECT, p_input_message: HANDOFF } })
  })
})
