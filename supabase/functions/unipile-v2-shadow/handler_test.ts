import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'

const config = { enabled: true, endpointId: 'endpoint-synthetic', appId: 'app_synthetic',
  accountId: 'acc_synthetic', production: false, secret: 'synthetic-signing-secret' }
const now = 1800000000
const event = { id: 'evt_synthetic', created_at: '2026-11-16T19:00:00Z',
  application_id: config.appId, application_production: false,
  account_id: config.accountId, account_provider: 'LINKEDIN', account_name: 'Synthetic',
  account_scope_id: null, type: 'message.new',
  payload: { id: 'CLASSIC_synthetic', chat_id: 'CLASSIC_chat', is_sender: false } }
const raw = JSON.stringify(event)
function signed(body = raw, timestamp = now, secret = config.secret) {
  return `t=${timestamp},v0=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`
}
function request(body = raw, signature = signed(body), method = 'POST') {
  return new Request('https://receiver.invalid/', { method, headers: { 'unipile-signature': signature }, body })
}
async function module() {
  const path = new URL('./handler.ts', import.meta.url)
  assert.ok(await Deno.stat(path).then(() => true, () => false), 'Deno shadow handler is missing')
  return await import(path.href)
}

Deno.test('authentic scoped event is acknowledged only after persistence', async () => {
  const { createHandler } = await module()
  let finish!: (value: string) => void
  let saved: Record<string, unknown> | undefined
  const pending = new Promise<string>(resolve => finish = resolve)
  const handle = createHandler(config, { now: () => now, persist: async (row: Record<string, unknown>) => {
    saved = row; return await pending
  } })
  let replied = false
  const response = handle(request()).then((r: Response) => { replied = true; return r })
  await new Promise(resolve => setTimeout(resolve, 15))
  assert.equal(replied, false)
  finish('stored')
  assert.equal((await response).status, 202)
  assert.equal(saved?.endpointId, config.endpointId)
  assert.equal(new TextDecoder().decode(saved?.rawBody as Uint8Array), raw)
})

Deno.test('disabled or incomplete configuration performs no write', async () => {
  const { createHandler } = await module()
  for (const cfg of [{ ...config, enabled: false }, { ...config, secret: '' }, { ...config, production: undefined }]) {
    const handle = createHandler(cfg, { now: () => now, persist: () => assert.fail('disabled write') })
    assert.equal((await handle(request())).status, 503)
  }
})

Deno.test('wrong secret tampering expired timestamp and duplicate signature fields cannot persist', async () => {
  const { createHandler } = await module()
  const handle = createHandler(config, { now: () => now, persist: () => assert.fail('unauthenticated write') })
  for (const req of [request(raw, signed(raw, now, 'wrong')), request(raw + ' ', signed()),
    request(raw, signed(raw, now - 301)), request(raw, signed() + `,t=${now}`), request('not-json')]) {
    const response = await handle(req)
    assert.equal(response.status, 401)
    assert.equal(await response.text(), '{"error":"unauthorized"}')
  }
})

Deno.test('wrong account application or environment cannot enter the configured scope', async () => {
  const { createHandler } = await module()
  const handle = createHandler(config, { now: () => now, persist: () => assert.fail('cross-scope write') })
  for (const changed of [{ account_id: 'acc_other' }, { application_id: 'app_other' }, { application_production: true }]) {
    assert.equal((await handle(request(JSON.stringify({ ...event, ...changed })))).status, 403)
  }
})

Deno.test('malformed envelope is rejected and future types stay quarantined without a business callback', async () => {
  const { createHandler } = await module()
  const handle = createHandler(config, { now: () => now, persist: async () => 'stored' })
  for (const changed of [{ id: '' }, { payload: [] }, { type: null }, { created_at: 'broken' }]) {
    assert.equal((await handle(request(JSON.stringify({ ...event, ...changed })))).status, 400)
  }
  const response = await handle(request(JSON.stringify({ ...event, type: 'future.event', payload: {} })))
  assert.equal(response.status, 202)
  assert.equal(await response.text(), '{"received":true,"state":"quarantined"}')
})

Deno.test('duplicate succeeds but conflicting ID storage failures and unknown receipts never acknowledge', async () => {
  const { createHandler } = await module()
  for (const [receipt, status] of [['duplicate', 202], ['conflict', 409], ['rejected_scope', 403],
    ['capacity', 503], ['disabled', 503], ['unexpected', 503]]) {
    const handle = createHandler(config, { now: () => now, persist: async () => receipt })
    assert.equal((await handle(request())).status, status)
  }
  const handle = createHandler(config, { now: () => now, persist: () => { throw new Error('private path and secret') } })
  const response = await handle(request())
  assert.equal(response.status, 503)
  assert.equal(await response.text(), '{"error":"storage_unavailable"}')
})

Deno.test('stream over one MiB is rejected before storage', async () => {
  const { createHandler } = await module()
  const handle = createHandler(config, { now: () => now, persist: () => assert.fail('oversized write') })
  assert.equal((await handle(request('x'.repeat(1024 * 1024 + 1)))).status, 413)
})

Deno.test('one total deadline covers stalled body and an unresponsive database', async () => {
  const { createHandler } = await module()
  let cancelled = false
  const body = new ReadableStream({ cancel() { cancelled = true } })
  const req = new Request('https://receiver.invalid/', { method: 'POST', body,
    headers: { 'unipile-signature': signed() }, duplex: 'half' } as RequestInit)
  const handle = createHandler(config, { now: () => now, deadlineMs: 30, persist: () => assert.fail('unfinished body write') })
  assert.equal((await handle(req)).status, 503)
  assert.equal(cancelled, true)
  let aborted = false
  const slow = createHandler(config, { now: () => now, deadlineMs: 30,
    persist: (_row: unknown, signal: AbortSignal) => {
      signal.addEventListener('abort', () => aborted = true)
      return new Promise(() => {})
    } })
  assert.equal((await slow(request())).status, 503)
  assert.equal(aborted, true)
})

Deno.test('slow body does not reset the time budget before persistence', async () => {
  const { createHandler } = await module()
  let bodyTimer: ReturnType<typeof setTimeout>
  const body = new ReadableStream({ start(controller) {
    bodyTimer = setTimeout(() => { controller.enqueue(new TextEncoder().encode(raw)); controller.close() }, 30)
  }, cancel() { clearTimeout(bodyTimer) } })
  let persistTimer: ReturnType<typeof setTimeout>
  const handle = createHandler(config, { now: () => now, deadlineMs: 50, persist: () => new Promise(resolve => {
    persistTimer = setTimeout(() => resolve('stored'), 30)
  }) })
  try {
    const req = new Request('https://receiver.invalid/', { method: 'POST', body,
      headers: { 'unipile-signature': signed() }, duplex: 'half' } as RequestInit)
    assert.equal((await handle(req)).status, 503)
  } finally { clearTimeout(persistTimer!) }
})
