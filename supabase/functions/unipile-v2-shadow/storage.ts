import { Buffer } from 'node:buffer'
import type { Delivery } from './handler.ts'

export function postgresSink(baseUrl: string, serviceKey: string, transport: typeof fetch = fetch) {
  const url = new URL('/rest/v1/rpc/unipile_v2_shadow_accept', baseUrl)
  if (url.protocol !== 'https:' || !serviceKey) throw new Error('storage_configuration_invalid')
  return async (delivery: Delivery, signal: AbortSignal): Promise<string> => {
    try {
      const result = await transport(url.href, {
        method: 'POST', signal, redirect: 'error',
        headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ p_endpoint_id: delivery.endpointId,
          p_body_base64: Buffer.from(delivery.rawBody).toString('base64') }),
      })
      if (!result.ok) throw new Error('storage_unavailable')
      const receipt = await result.json()
      if (typeof receipt !== 'string') throw new Error('storage_unavailable')
      return receipt
    } catch { throw new Error('storage_unavailable') }
  }
}
