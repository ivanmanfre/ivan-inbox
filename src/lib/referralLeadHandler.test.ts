import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { REFERRAL_REVISION } from '../../supabase/functions/inbox-dm-draft/research'

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
  linkedin_url: 'https://www.linkedin.com/in/tomas-weller-test', summary: 'Tomas Weller is Influencer Manager at Northwind Games.', reason: null,
  draft: 'Hey Tomas\n\nPriya said you are the person for creator campaigns at Northwind.\n\nAre you running them in-house or with an agency?',
  sources: [{ url: 'https://www.linkedin.com/in/tomas-weller-test', title: 'Tomas Weller | LinkedIn profile search' }], acknowledgement: "Thanks Priya, I'll reach out to Tomas." }
const redrafted = 'Hey Tomas\n\nPriya said you are the person for creator campaigns at Northwind.\n\nWhat do you measure that work on these days?'

type Call = { fn: string; args: Record<string, unknown> }
async function run(rows: Record<string, unknown>[], opts: { body?: Record<string, unknown>; server?: boolean; enrichment?: Record<string, unknown>; model?: (prompt: string) => unknown; apify?: unknown[]; rpc?: (fn: string, args: Record<string, unknown>) => unknown }) {
  const calls: Call[] = []
  const upstream: string[] = []
  const apifyBodies: unknown[] = []
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
        maybeSingle: async () => ({ data: table === 'integration_config' ? { value: 'apify-token' } : null }),
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
  return { status: response.status, result: await response.json(), calls, upstream, apifyBodies }
}

const judge = (verdict: string, quote: string | null = null) => (prompt: string) =>
  prompt.includes('should still contact') ? { verdict, quote } : prompt.includes('Write the first') ? { paragraphs: redrafted.split('\n\n'), reason: null } : { name: null }

describe('a verified referral stays open after later replies', () => {
  it('a courtesy reply is read by the model, leaves the card open and saves the check', async () => {
    const cached = { ...verified, revision: REFERRAL_REVISION }
    const { status, result, calls, upstream } = await run([pitch, handoff, ack, youToo], { server: true, body: { mode: 'referral' }, enrichment: { inbox_referral: cached }, model: judge('go') })
    expect(status).toBe(200)
    expect(result.referral).toMatchObject({ status: 'verified', input_message_id: HANDOFF, later: { through_message_id: 'later-1', verdict: 'go' } })
    expect(upstream).toHaveLength(1)
    expect(upstream[0]).toContain('You too!')
    expect(calls[0]).toMatchObject({ fn: 'inbox_set_referral_v2', args: { p_keep_verified: true } })
  })
  it('"hold off" pauses it with the referrer’s own words', async () => {
    const hold = row('later-2', 'inbound', 'Please hold off contacting Tomas until January, he is on leave', 40)
    const cached = { ...verified, revision: REFERRAL_REVISION, later: { through_message_id: 'later-1', verdict: 'go', quote: null, checked_at: at(31) } }
    const { result } = await run([pitch, handoff, ack, youToo, hold], { server: true, body: { mode: 'referral' }, enrichment: { inbox_referral: cached }, model: judge('hold', 'Please hold off contacting Tomas until January') })
    expect(result.referral.later).toMatchObject({ through_message_id: 'later-2', verdict: 'hold', quote: 'Please hold off contacting Tomas until January' })
  })
  it('an older-revision draft is redrafted from the stored identity with the whole story, without a new profile search', async () => {
    const cached = { ...verified, revision: REFERRAL_REVISION - 1 }
    const { result, upstream, apifyBodies } = await run([pitch, handoff, discarded, ack, youToo], { server: true, body: { mode: 'referral' }, enrichment: { inbox_referral: cached }, model: judge('go') })
    expect(apifyBodies).toHaveLength(0)
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
    expect(apifyBodies).toHaveLength(0)
    expect(result.referral).toMatchObject({ status: 'verified', input_message_id: HANDOFF, name: 'Tomas Weller', passed_over: ['vague'], later: { through_message_id: 'vague', verdict: 'go' } })
  })
})

describe('create referred lead', () => {
  const ready = { ...verified, revision: REFERRAL_REVISION, later: { through_message_id: 'later-1', verdict: 'go', quote: null, checked_at: at(31) } }
  const profile = [{ id: 'ACoAA-test-tomas', publicIdentifier: 'tomas-weller-test', firstName: 'Tomas', lastName: 'Weller', headline: 'Influencer Manager',
    location: { linkedinText: 'Lisbon, Portugal', parsed: { country: 'Portugal', city: 'Lisbon', state: null } } }]
  const body = (draft = verified.draft) => ({ mode: 'referral_lead', input_message_id: HANDOFF, draft })
  it('stages one held invite note through the database function, flagged for a by-hand check', async () => {
    const { status, result, calls, apifyBodies } = await run([pitch, handoff, ack, youToo], { body: body(), enrichment: { inbox_referral: ready }, apify: profile,
      rpc: fn => fn === 'inbox_referral_create_lead' ? { status: 'created', lead_prospect_id: '00000000-0000-4000-8000-0000000000aa', message_id: 'm' } : true })
    expect(status).toBe(200)
    expect(result.lead).toMatchObject({ status: 'created' })
    expect(apifyBodies[0]).toMatchObject({ publicIdentifiers: ['tomas-weller-test'] })
    const made = calls.find(c => c.fn === 'inbox_referral_create_lead')!
    expect(made.args).toMatchObject({ p_referrer: PROSPECT, p_input_message: HANDOFF, p_revision: REFERRAL_REVISION, p_text: verified.draft,
      p_lead: { linkedin_url: 'https://www.linkedin.com/in/tomas-weller-test', provider_id: 'ACoAA-test-tomas', country: 'Portugal', company: 'Northwind Games' } })
    expect((made.args.p_evidence as { review_note: string }).review_note).toContain('already messaged Tomas by hand on LinkedIn')
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
