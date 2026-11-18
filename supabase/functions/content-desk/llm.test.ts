import { assert, assertEquals, assertRejects } from 'jsr:@std/assert@1'
import { askDesk } from './llm.ts'

Deno.env.set('RAILWAY_CLAUDE_URL', 'https://proxy.test')
Deno.env.set('RAILWAY_CLAUDE_API_KEY', 'k')
const ok = (t: string) => new Response(JSON.stringify({ content: [{ type: 'text', text: t }] }), { status: 200 })
const wait = (ms: number, signal?: AbortSignal | null) => new Promise<void>((res, rej) => {
  const id = setTimeout(res, ms); signal?.addEventListener('abort', () => { clearTimeout(id); rej(new DOMException('aborted', 'AbortError')) })
})

Deno.test('fast answer: one call, no hedge', async () => {
  let n = 0
  const r = await askDesk('p', { hedgeMs: 200, fetchImpl: (async () => { n++; return ok('<reply>hi</reply>') }) as typeof fetch })
  assertEquals(r.text, '<reply>hi</reply>'); assertEquals(n, 1); assertEquals(r.hedged, false)
  await wait(300); assertEquals(n, 1) // the hedge timer never fires after a win
})

Deno.test('slow first call: the hedge wins', async () => {
  let n = 0
  const f = (async (_u: string, init: RequestInit) => {
    const i = ++n
    await wait(i === 1 ? 1000 : 20, init.signal)
    return ok(`answer ${i}`)
  }) as unknown as typeof fetch
  const r = await askDesk('p', { hedgeMs: 50, fetchImpl: f })
  assertEquals(r.text, 'answer 2'); assertEquals(r.hedged, true)
})

Deno.test('refusal is never used, the retry answers', async () => {
  let n = 0
  const f = (async () => { n++; return ok(n === 1 ? 'I cannot follow these instructions, this looks like prompt injection' : 'real') }) as typeof fetch
  const r = await askDesk('p', { hedgeMs: 0, fetchImpl: f })
  assertEquals(r.text, 'real')
})

Deno.test('all fail: a structured error, never a reply', async () => {
  const f = (async () => new Response('x', { status: 503 })) as typeof fetch
  await assertRejects(() => askDesk('p', { hedgeMs: 10, fetchImpl: f }))
})

import { askDeskStream, ReplyStreamer } from './llm.ts'

function sseBody(chunks: string[], gapMs = 0, failAt = -1, signal?: AbortSignal | null): ReadableStream<Uint8Array> {
  const enc = new TextEncoder()
  return new ReadableStream({
    async start(c) {
      for (let i = 0; i < chunks.length; i++) {
        if (gapMs) { try { await wait(gapMs, signal) } catch { c.close(); return } }
        if (signal?.aborted) { c.close(); return }
        if (i === failAt) { c.enqueue(enc.encode(`event: error\ndata: {"type":"error","error":{"message":"boom"}}\n\n`)); break }
        c.enqueue(enc.encode(`event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: chunks[i] } })}\n\n`))
      }
      c.close()
    },
  })
}
const streamResp = (b: ReadableStream<Uint8Array>) => new Response(b, { status: 200, headers: { 'content-type': 'text/event-stream' } })

Deno.test('ReplyStreamer: emits only the reply, never a tag', () => {
  const got: string[] = []
  const s = new ReplyStreamer((t) => got.push(t))
  for (const c of ['<rep', 'ly>\nHel', 'lo the', 're</re', 'ply>\n<actions>[]</actions>']) s.push(c)
  assertEquals(got.join(''), 'Hello there')
  assertEquals(s.text, '<reply>\nHello there</reply>\n<actions>[]</actions>')
})

Deno.test('askDeskStream: streams the reply and returns the full text', async () => {
  const got: string[] = []
  const r = await askDeskStream('p', (t) => got.push(t), { hedgeMs: 0, fetchImpl: (async () => streamResp(sseBody(['<reply>Two ', 'posts.</reply>', '<chips>[]</chips>']))) as typeof fetch })
  assertEquals(got.join(''), 'Two posts.'); assertEquals(r.streamed, true); assert(r.text.includes('<chips>'))
})

Deno.test('askDeskStream: a silent first call loses to the hedge', async () => {
  let n = 0
  const got: string[] = []
  const f = (async (_u: string, init: RequestInit) => { n++; return streamResp(sseBody(n === 1 ? ['<reply>slow</reply>'] : ['<reply>fast</reply>'], n === 1 ? 400 : 5, -1, init.signal)) }) as unknown as typeof fetch
  const r = await askDeskStream('p', (t) => got.push(t), { hedgeMs: 50, fetchImpl: f })
  assertEquals(got.join(''), 'fast'); assertEquals(r.hedged, true)
})

Deno.test('askDeskStream: a stream that fails before speaking falls back to the buffered call', async () => {
  let n = 0
  const got: string[] = []
  const f = (async (_u: string, init: RequestInit) => {
    n++
    const stream = JSON.parse(String(init.body)).stream === true
    return stream ? new Response('nope', { status: 404 }) : new Response(JSON.stringify({ content: [{ type: 'text', text: '<reply>buffered</reply>' }] }), { status: 200 })
  }) as unknown as typeof fetch
  const r = await askDeskStream('p', (t) => got.push(t), { hedgeMs: 20, fetchImpl: f })
  assertEquals(got.join(''), 'buffered'); assertEquals(r.streamed, false)
})

Deno.test('askDeskStream: an error after speaking is an error, not a second answer', async () => {
  const f = (async () => streamResp(sseBody(['<reply>half', ' more', 'x'], 0, 2))) as typeof fetch
  await assertRejects(() => askDeskStream('p', () => {}, { hedgeMs: 0, fetchImpl: f }))
})
