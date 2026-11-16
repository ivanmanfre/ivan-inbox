type Config = {
  enabled: boolean; endpointId?: string; appId?: string; accountId?: string;
  production?: boolean; secret?: string;
}
export type Delivery = { endpointId: string; rawBody: Uint8Array }
type Dependencies = {
  persist: (delivery: Delivery, signal: AbortSignal) => Promise<string>;
  now?: () => number; deadlineMs?: number;
}
const encoder = new TextEncoder()
const response = (status: number, body: object) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
})
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0

async function authenticate(raw: Uint8Array, header: string | null, secret: string, now: number) {
  if (!header || header.length > 256 || !Number.isSafeInteger(now) || now <= 0) throw new Error('auth')
  const parts = header.split(',').map(part => part.trim())
  const timestamp = parts.find(part => /^t=[1-9][0-9]{0,11}$/.test(part))?.slice(2)
  const signature = parts.find(part => /^v0=[a-fA-F0-9]{64}$/.test(part))?.slice(3)
  if (parts.length !== 2 || !timestamp || !signature || Math.abs(now - Number(timestamp)) > 300) throw new Error('auth')
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'])
  const prefix = encoder.encode(`${timestamp}.`)
  const signed = new Uint8Array(prefix.length + raw.length)
  signed.set(prefix); signed.set(raw, prefix.length)
  const digest = Uint8Array.from(signature.match(/../g)!, byte => parseInt(byte, 16))
  if (!await crypto.subtle.verify('HMAC', key, digest, signed)) throw new Error('auth')
  const event = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw))
  if (!object(event)) throw new Error('auth')
  return event
}

export function createHandler(configuration: Config, dependencies: Dependencies) {
  const config = { ...configuration }
  const now = dependencies.now ?? (() => Math.floor(Date.now() / 1000))
  // Only shorter deadlines are allowed in tests/configuration; never extend past 4s.
  const deadlineMs = Math.min(dependencies.deadlineMs ?? 4000, 4000)
  return async (req: Request): Promise<Response> => {
    if (req.method !== 'POST') return response(405, { error: 'method_not_allowed' })
    if (!config.enabled || !text(config.secret) || !text(config.endpointId)
      || !text(config.appId) || !text(config.accountId) || typeof config.production !== 'boolean') {
      return response(503, { error: 'receiver_disabled' })
    }
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const deadline = new Promise<Response>(resolve => {
      timer = setTimeout(() => {
        controller.abort()
        resolve(response(503, { error: 'deadline_exceeded' }))
      }, deadlineMs)
    })
    const work = async () => {
      const reader = req.body?.getReader()
      if (!reader) return response(400, { error: 'body_required' })
      const cancel = () => { void reader.cancel().catch(() => {}) }
      controller.signal.addEventListener('abort', cancel, { once: true })
      const chunks: Uint8Array[] = []
      let length = 0
      try {
        while (true) {
          const part = await reader.read()
          if (controller.signal.aborted) return response(503, { error: 'deadline_exceeded' })
          if (part.done) break
          length += part.value.length
          if (length > 1024 * 1024) {
            cancel()
            return response(413, { error: 'body_too_large' })
          }
          chunks.push(part.value)
        }
      } finally {
        controller.signal.removeEventListener('abort', cancel)
        reader.releaseLock()
      }
      const raw = new Uint8Array(length)
      let offset = 0
      for (const chunk of chunks) { raw.set(chunk, offset); offset += chunk.length }
      let event: Record<string, unknown>
      try { event = await authenticate(raw, req.headers.get('unipile-signature'), config.secret!, now()) }
      catch { return response(401, { error: 'unauthorized' }) }
      if (controller.signal.aborted) return response(503, { error: 'deadline_exceeded' })
      if (event.application_id !== config.appId || event.account_id !== config.accountId
        || event.application_production !== config.production) return response(403, { error: 'scope_mismatch' })
      if (!text(event.id) || !event.id.startsWith('evt_') || event.id.length > 256
        || !text(event.type) || event.type.length > 128 || !object(event.payload)
        || !text(event.created_at) || !Number.isFinite(Date.parse(event.created_at))) {
        return response(400, { error: 'event_invalid' })
      }
      const status = await dependencies.persist({ endpointId: config.endpointId!, rawBody: raw }, controller.signal)
      if (controller.signal.aborted) return response(503, { error: 'deadline_exceeded' })
      if (status === 'conflict') return response(409, { error: 'event_conflict' })
      if (status === 'rejected_scope') return response(403, { error: 'scope_mismatch' })
      if (!['stored', 'duplicate'].includes(status)) return response(503, { error: 'storage_unavailable' })
      return response(202, { received: true, state: 'quarantined' })
    }
    try { return await Promise.race([work().catch(() => response(503, { error: 'storage_unavailable' })), deadline]) }
    finally { clearTimeout(timer) }
  }
}
