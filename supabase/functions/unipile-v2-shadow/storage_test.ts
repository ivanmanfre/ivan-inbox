import assert from 'node:assert/strict'

Deno.test('database adapter calls only the dedicated RPC and carries raw bytes and abort signal', async () => {
  const path = new URL('./storage.ts', import.meta.url)
  assert.ok(await Deno.stat(path).then(() => true, () => false), 'PostgREST adapter is missing')
  const { postgresSink } = await import(path.href)
  const controller = new AbortController()
  let captured: { url: string; init: RequestInit } | undefined
  const sink = postgresSink('https://database.invalid', 'synthetic-service-key', async (url: string, init: RequestInit) => {
    captured = { url, init }
    return new Response('"stored"', { status: 200 })
  })
  assert.equal(await sink({ endpointId: 'endpoint-test', rawBody: new TextEncoder().encode('{ "x": 1 }') }, controller.signal), 'stored')
  assert.equal(captured?.url, 'https://database.invalid/rest/v1/rpc/unipile_v2_shadow_accept')
  assert.equal(captured?.init.signal, controller.signal)
  assert.equal(captured?.init.method, 'POST')
  assert.deepEqual(JSON.parse(captured?.init.body as string), { p_endpoint_id: 'endpoint-test', p_body_base64: 'eyAieCI6IDEgfQ==' })
})

Deno.test('database adapter refuses failed HTTP malformed receipts and retries nothing', async () => {
  const path = new URL('./storage.ts', import.meta.url)
  assert.ok(await Deno.stat(path).then(() => true, () => false), 'PostgREST adapter is missing')
  const { postgresSink } = await import(path.href)
  for (const response of [new Response('private diagnostic', { status: 500 }), new Response('{}'), new Response('not-json')]) {
    let calls = 0
    const sink = postgresSink('https://database.invalid', 'synthetic-service-key', () => { calls++; return Promise.resolve(response) })
    await assert.rejects(() => sink({ endpointId: 'test', rawBody: new Uint8Array() }, new AbortController().signal), /^Error: storage_unavailable$/)
    assert.equal(calls, 1)
  }
})
