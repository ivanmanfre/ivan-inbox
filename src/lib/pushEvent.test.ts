import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { forwardPushToClients, pushClientEvent } from './pushEvent'

const id = '123e4567-e89b-42d3-a456-426614174000'

describe('service worker push forwarding', () => {
  it('forwards the persisted UUID unchanged to every open client', () => {
    const a = { postMessage: vi.fn() }
    const b = { postMessage: vi.fn() }
    forwardPushToClients({ notificationId: id, family: 'system_infra_alarm', url: './#exp/d/workflows' }, [a, b])
    expect(a.postMessage).toHaveBeenCalledWith({ type: 'push', notificationId: id, family: 'system_infra_alarm', url: './#exp/d/workflows' })
    expect(b.postMessage).toHaveBeenCalledWith(a.postMessage.mock.calls[0][0])
  })

  it('keeps old DM and Claude payloads while refusing an invented row ID', () => {
    expect(pushClientEvent({ family: 'claude_turn' })).toEqual({ type: 'push', family: 'claude_turn', url: './' })
    expect(pushClientEvent({ notificationId: 'not-a-uuid', family: 'inbound_reply_notice' })).toEqual({ type: 'push', family: 'inbound_reply_notice', url: './' })
  })

  it('is the helper wired into the real service-worker push handler', () => {
    const source = readFileSync(new URL('../sw.ts', import.meta.url), 'utf8')
    expect(source).toContain("import { forwardPushToClients } from './lib/pushEvent'")
    expect(source).toContain('forwardPushToClients({ url, family: d.family, notificationId: d.notificationId }, clients)')
  })
})
