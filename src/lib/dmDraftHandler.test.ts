import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const offer = "Hey Robert :)\n---\nbtw, I scale founder's LinkedIn for a living. Can i send you one of my audits of your profile potential? 100% free"
const invite = { id: 'invite', client_id: 'ivan', prospect_name: 'Robert Gilbreath', prospect_company: 'Robert Gilbreath Fractional Executive', direction: 'outbound', message_type: 'connection_note', message_text: "Hey Robert, saw you around Ross Hudgens's content 😂 figured I'd say hi.", sent_at: '2026-10-08T03:16:11Z', created_at: '2026-10-08T03:16:11Z', prospect_stage: 'connected', prospect_blacklisted: false }
const inbound = { ...invite, id: 'reaction', direction: 'inbound', message_type: 'dm', message_text: '👍', sent_at: '2026-10-08T15:22:19Z', created_at: '2026-10-08T15:22:19Z' }
const slugs = ['author-voice', 'ivan-reply-voice-core', 'ivan-company-facts', 'forbidden-language', 'anti-ai-patterns-outreach-playbook', 'arch-company-facts', 'arch-reply-voice-core', 'arch-icp-outreach', 'arch-reply-exemplars']

async function draft(rows: Record<string, unknown>[], reply: string | null = 'cool, thanks for accepting 🙂') {
  let handler: (req: Request) => Promise<Response> = () => { throw Error('handler not loaded') }
  const upstream: { messages: { content: string }[] }[] = []
  const sb = {
    auth: { getUser: async () => ({ data: { user: { id: 'owner' } } }) },
    from(table: string) {
      let fields = '*'
      let requestedSlugs = slugs
      const query = {
        select(value: string) { fields = value; return query },
        eq() { return query }, in(_field: string, values: string[]) { requestedSlugs = values; return query }, order() { return query },
        single: async () => ({ data: { operator_note: null, enrichment_data: {}, dm_count: 0 } }),
        then(resolve: (value: unknown) => unknown) {
          const data = table === 'content_prompts' ? slugs.filter(slug => requestedSlugs.includes(slug)).map(slug => ({ slug, body: 'current verified rules', updated_at: '2026-10-08' }))
            : rows.map(row => Object.fromEntries(fields.split(',').map(field => [field, row[field]])))
          return Promise.resolve({ data, error: null }).then(resolve)
        },
      }
      return query
    },
  }
  const source = readFileSync(new URL('../../supabase/functions/inbox-dm-draft/index.ts', import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  runInNewContext(compiled, {
    exports: {}, require: (name: string) => name.startsWith('npm:') ? { createClient: () => sb } : {},
    Deno: { env: { get: (name: string) => name === 'INBOX_CLAUDE_ALLOWED_USER_ID' ? 'owner' : 'configured' }, serve: (fn: typeof handler) => { handler = fn } },
    Response, AbortSignal, console,
    fetch: async (_url: string, init: { body: string }) => {
      upstream.push(JSON.parse(init.body))
      return Response.json({ model: 'gpt-4.1', choices: [{ message: { content: JSON.stringify({ reply, reason: reply === null ? 'Declined.' : null }) } }] })
    },
  })
  const response = await handler(new Request('https://test/draft', { method: 'POST', headers: { Authorization: 'Bearer owner-token' }, body: JSON.stringify({ prospect_id: '61d768d6-5bf9-4777-8eb7-cf6c0b38ae75' }) }))
  return { status: response.status, result: await response.json(), upstream }
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
