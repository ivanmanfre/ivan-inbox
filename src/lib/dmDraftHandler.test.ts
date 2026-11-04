import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const offer = "Hey Robert :)\n---\nbtw, I scale founder's LinkedIn for a living. Can i send you one of my audits of your profile potential? 100% free"
const invite = { id: 'invite', client_id: 'ivan', prospect_name: 'Robert Gilbreath', prospect_company: 'Robert Gilbreath Fractional Executive', direction: 'outbound', message_type: 'connection_note', message_text: "Hey Robert, saw you around Ross Hudgens's content 😂 figured I'd say hi.", sent_at: '2026-10-08T03:16:11Z', created_at: '2026-10-08T03:16:11Z', prospect_stage: 'connected', prospect_blacklisted: false }
const inbound = { ...invite, id: 'reaction', direction: 'inbound', message_type: 'dm', message_text: '👍', sent_at: '2026-10-08T15:22:19Z', created_at: '2026-10-08T15:22:19Z' }
const slugs = ['author-voice', 'ivan-reply-voice-core', 'ivan-company-facts', 'forbidden-language', 'anti-ai-patterns-outreach-playbook', 'arch-company-facts', 'arch-reply-voice-core', 'arch-icp-outreach', 'arch-reply-exemplars']

async function draft(rows: Record<string, unknown>[], reply: string | null = 'cool, thanks for accepting 🙂', req: { headers?: Record<string, string>; body?: Record<string, unknown>; signedIn?: boolean; enrichment?: Record<string, unknown>; latest?: unknown; fetch?: (url: string, body: { messages?: { content: string }[] }) => unknown } = {}) {
  const saved: unknown[] = []
  let handler: (req: Request) => Promise<Response> = () => { throw Error('handler not loaded') }
  const upstream: { messages: { content: string }[] }[] = []
  const sb = {
    rpc: async (_fn: string, args: unknown) => { saved.push(args); return { data: true, error: null } },
    auth: { getUser: async () => req.signedIn === false ? { data: { user: null }, error: { message: 'no session' } } : { data: { user: { id: 'owner' } } } },
    from(table: string) {
      let fields = '*'
      let requestedSlugs = slugs
      let direction: unknown = null, newest = false
      const query = {
        select(value: string) { fields = value; return query },
        eq(field: string, value: unknown) { if (field === 'direction') direction = value; return query }, in(_field: string, values: string[]) { requestedSlugs = values; return query },
        order(_field: string, opts?: { ascending?: boolean }) { newest = opts?.ascending === false; return query }, limit() { return query }, not() { return query },
        maybeSingle: async () => ({ data: null }),
        single: async () => ({ data: fields.startsWith('referral:') ? { referral: req.latest ?? null } : { operator_note: null, enrichment_data: req.enrichment ?? {}, dm_count: 0 } }),
        then(resolve: (value: unknown) => unknown) {
          const data = table === 'content_prompts' ? slugs.filter(slug => requestedSlugs.includes(slug)).map(slug => ({ slug, body: 'current verified rules', updated_at: '2026-10-08' }))
            : (newest ? [...rows].reverse() : rows).filter(row => direction === null || row.direction === direction).map(row => Object.fromEntries(fields.split(',').map(field => [field, row[field]])))
          return Promise.resolve({ data, error: null }).then(resolve)
        },
      }
      return query
    },
  }
  const dir = new URL('../../supabase/functions/inbox-dm-draft/', import.meta.url)
  const globals = {
    Deno: { env: { get: (name: string) => name === 'INBOX_CLAUDE_ALLOWED_USER_ID' ? 'owner' : 'configured' }, serve: (fn: typeof handler) => { handler = fn } },
    Response, AbortSignal, URL, console,
    fetch: async (url: string, init: { body: string }) => {
      upstream.push(JSON.parse(init.body))
      if (req.fetch) return Response.json(req.fetch(url, JSON.parse(init.body)))
      return Response.json({ content: [{ type: 'text', text: JSON.stringify({ reply, reason: reply === null ? 'Declined.' : null }) }] })
    },
  }
  const loaded = new Map<string, unknown>()
  // Local modules run for real (llm.ts, research.ts); only the npm client is stubbed.
  const load = (file: string): unknown => {
    if (loaded.has(file)) return loaded.get(file)
    const exports = {}
    loaded.set(file, exports)
    const compiled = ts.transpileModule(readFileSync(new URL(file, dir), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
    runInNewContext(compiled, { ...globals, globalThis: globals, exports,
      require: (name: string) => name.startsWith('npm:') ? { createClient: () => sb } : load(name.replace(/^\.\//, '')) })
    return exports
  }
  load('index.ts')
  const response = await handler(new Request('https://test/draft', { method: 'POST', headers: req.headers ?? { Authorization: 'Bearer owner-token' }, body: JSON.stringify({ prospect_id: '61d768d6-5bf9-4777-8eb7-cf6c0b38ae75', ...req.body }) }))
  return { status: response.status, result: await response.json(), upstream, saved }
}

describe('on-demand first DM after an invite', () => {
  it('Robert’s invite reaction drafts the approved scan offer', async () => {
    const { result, upstream } = await draft([invite, inbound])
    expect(result.reply).toBe(offer)
    expect(result.input_message_ids).toEqual(['invite', 'reaction'])
    expect(upstream).toHaveLength(0)
  })
  it.each(['Hey', 'Hi Ivan', 'Thanks for connecting', 'Thanks for accepting 🙂'])('offers the scan after a simple greeting: %s', async text => {
    expect((await draft([invite, { ...inbound, message_text: text }])).result.reply).toBe(offer)
  })
  it.each(['dm', 'manual_reply', 'inmail'])('an actual sent %s prevents another first offer', async message_type => {
    const sent = { ...invite, id: 'offer', message_type, message_text: 'May I send you an audit?', sent_at: '2026-10-08T14:00:00Z', created_at: '2026-10-08T14:00:00Z' }
    const { result, upstream } = await draft([invite, sent, inbound], 'Here is the answer to your latest message.')
    expect(result.reply).toBe('Here is the answer to your latest message.')
    expect(upstream).toHaveLength(1)
  })
  it.each(['Thanks but no. Not interested.', '👎', '😡'])('does not turn a decline into a scan offer: %s', async text => {
    const { result, upstream } = await draft([invite, { ...inbound, message_text: text }], null)
    expect(result.reply).toBeNull()
    expect(upstream).toHaveLength(1)
  })
  it('passes message types and current company facts when a first reply asks a question', async () => {
    const { upstream } = await draft([invite, { ...inbound, message_text: 'What do you do?' }], 'I build LinkedIn inbound services.')
    expect(upstream).toHaveLength(1)
    const content = upstream[0].messages.map(m => m.content).join('\n')
    expect(content).toContain('ivan-company-facts')
    expect(content).toContain('connection_note')
    expect(content).toContain('first_dm_after_invite')
  })
  it('a reaction with no sent invitation stays on the normal reply path', async () => {
    const { result, upstream } = await draft([inbound], 'Existing conversation reply.')
    expect(result.reply).toBe('Existing conversation reply.')
    expect(upstream).toHaveLength(1)
  })
  it('does not override an earlier decline when the latest turn is a reaction', async () => {
    const declined = { ...inbound, id: 'decline', message_text: 'Please do not pitch me.', sent_at: '2026-10-08T14:00:00Z', created_at: '2026-10-08T14:00:00Z' }
    const { result, upstream } = await draft([invite, declined, inbound], null)
    expect(result.reply).toBeNull()
    expect(upstream).toHaveLength(1)
  })
  it('keeps the other client’s reaction on its existing drafting path', async () => {
    const { result, upstream } = await draft([invite, inbound].map(row => ({ ...row, client_id: 'arch' })), 'Existing ARCH reply.')
    expect(result.reply).toBe('Existing ARCH reply.')
    expect(upstream).toHaveLength(1)
  })
})

describe('server referral warm-up', () => {
  const server = { headers: { 'x-inbox-secret': 'configured' }, signedIn: false }
  const handoff = { ...inbound, id: 'handoff', client_id: 'arch', prospect_name: 'Núria Oliveira', prospect_company: 'Wildlife Studios', message_text: "Yes, but it's not on my side. You need to talk with Larissa Vieira. " }
  const sentInvite = { ...invite, client_id: 'arch', prospect_name: 'Núria Oliveira', prospect_company: 'Wildlife Studios' }
  const larissa = { id: 'ACoAAlarissa', publicIdentifier: 'larissarvieira', firstName: 'Larissa', lastName: 'Vieira', headline: 'Creative Strategy',
    experience: [{ companyName: 'Wildlife Studios', position: 'Creator Strategy Manager', endDate: { text: 'Present' } }] }
  const dm = 'Hi Larissa\n\nNúria said you look after creator campaigns at Wildlife.\n\nAre you running them for the US or Europe?'
  const stages = (url: string, body: { messages?: { content: string }[] }) => url.includes('api.apify.com') ? [larissa]
    : { content: [{ type: 'text', text: JSON.stringify(body.messages?.[0].content.includes('Extract only the person name') ? { name: 'Larissa Vieira' } : { draft: dm }) }] }
  it('researches a referral with the push secret and no signed-in user, and saves the verified person', async () => {
    const { status, result, saved } = await draft([sentInvite, handoff], null, { ...server, body: { mode: 'referral' }, fetch: stages })
    expect(status).toBe(200)
    expect(result.referral).toMatchObject({ status: 'verified', name: 'Larissa Vieira', role: 'Creator Strategy Manager', linkedin_url: 'https://www.linkedin.com/in/larissarvieira', draft: dm, revision: 5, input_message_id: 'handoff' })
    expect(saved).toHaveLength(1)
    expect((saved[0] as { p_referral: { status: string; researched_at: string } }).p_referral).toMatchObject({ status: 'verified', input_message_id: 'handoff' })
  })
  it('a cached draft whose offer line is past 72 h is researched again', async () => {
    const cached = { status: 'verified', input_message_id: 'handoff', revision: 5, name: 'Larissa Vieira', offer_verified_at: new Date(Date.now() - 73 * 3600_000).toISOString() }
    const { result, upstream } = await draft([sentInvite, handoff], null, { ...server, body: { mode: 'referral' }, enrichment: { inbox_referral: cached }, fetch: stages })
    expect(upstream.length).toBeGreaterThan(0)
    expect(result.referral).toMatchObject({ status: 'verified', draft: dm, offer_verified_at: null })
  })
  it('a cached revision-4 result is served without research', async () => {
    const cached = { status: 'verified', input_message_id: 'handoff', revision: 5, name: 'Larissa Vieira' }
    const { result, upstream, saved } = await draft([sentInvite, handoff], null, { ...server, body: { mode: 'referral' }, enrichment: { inbox_referral: cached } })
    expect(result.referral).toEqual(cached)
    expect(upstream).toHaveLength(0)
    expect(saved).toHaveLength(0)
  })
  it('a verified result saved meanwhile is never overwritten by a weaker one', async () => {
    const kept = { status: 'verified', input_message_id: 'handoff', revision: 5, name: 'Larissa Vieira' }
    const failing = (url: string, body: { messages?: { content: string }[] }) => url.includes('api.apify.com') ? [] : stages(url, body)
    const { result, saved } = await draft([sentInvite, handoff], null, { ...server, body: { mode: 'referral' }, fetch: failing, latest: kept })
    expect(result.referral).toEqual(kept)
    // The save asks the database to keep a verified answer (atomic guard in inbox_set_referral_guarded).
    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({ p_keep_verified: true, p_referral: { status: 'unresolved', input_message_id: 'handoff' } })
  })
  it.each([[{}], [{ mode: 'referral', retry: true }]])('the push secret never drafts a reply or forces a retry: %j', async body => {
    expect((await draft([invite, inbound], null, { ...server, body })).status).toBe(403)
  })
  it('a wrong secret still needs a signed-in user', async () => {
    expect((await draft([invite, inbound], null, { headers: { 'x-inbox-secret': 'wrong' }, signedIn: false, body: { mode: 'referral' } })).status).toBe(401)
  })
})
