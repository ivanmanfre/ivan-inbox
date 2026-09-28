import { beforeEach, describe, expect, it, vi } from 'vitest'

const sent: unknown[] = []
vi.mock('./push-send.ts', () => ({ sendPush: async (_db: unknown, payload: unknown) => {
  sent.push(payload); return { subs: 1, results: ['sent'] }
} }))

const { notify, validateNotify, pushDefault } = await import('./notify.ts')
const { fallbackIncidentKey } = await import('./notification-lifecycle.ts')

function db(created: boolean) {
  const updates: unknown[] = []
  const client = {
    rpc: vi.fn(async () => ({ data: [{ id: '11111111-1111-4111-8111-111111111111', created, expires_at: '2026-09-28T12:00:00Z' }], error: null })),
    from: () => ({ update: (payload: unknown) => {
      updates.push(payload)
      return { eq: async () => ({ error: null }) }
    } }),
  }
  return { client, updates }
}

beforeEach(() => { sent.length = 0 })

describe('notify transient workflow claim', () => {
  it('uses the atomic claim as the only push gate and sends canonical ID', async () => {
    const a = db(true)
    const input = { family: 'system_infra_alarm', source: 'wa-relay:siEM4bDSfevuVCII', tenant: 'rise',
      incident_key: 'rise:siEM4bDSfevuVCII:hubspot:config_read_failed:attention',
      severity: 'attention', title: 'HubSpot read failed', group_key: 'workflow' }
    const first = await notify(a.client as never, input)
    expect(first.pushed).toBe(true)
    expect(a.client.rpc).toHaveBeenCalledWith('claim_inbox_workflow_notification', expect.objectContaining({
      p_alert: expect.objectContaining({ incident_key: input.incident_key }),
    }))
    expect(sent[0]).toMatchObject({ notificationId: first.id, tag: first.id, family: 'system_infra_alarm' })
    const b = db(false)
    const repeat = await notify(b.client as never, input)
    expect(repeat).toMatchObject({ id: first.id, deduped: true, pushed: false })
    expect(sent).toHaveLength(1)
  })

  it('retains booking and Claude policy and rejects malformed explicit keys', () => {
    expect(pushDefault('booking_notice', 'attention')).toBe(true)
    expect(pushDefault('claude_turn', 'info')).toBe(true)
    expect(validateNotify({ family: 'booking_notice', title: 'Booked' }).incident_key).toBeNull()
    expect(() => validateNotify({ family: 'system_infra_alarm', title: 'Failed' })).not.toThrow()
    expect(() => validateNotify({ family: 'system_infra_alarm', title: 'Failed', incident_key: 'workflow-only' })).toThrow()
  })

  it('ignores run/count changes but keeps distinct failure conditions and HTTP codes', async () => {
    const base = { family: 'system_infra_alarm', source: 'workflow-a', tenant: 'rise', severity: 'error' }
    const one = await fallbackIncidentKey({ ...base, title: '3 sends failed', body: 'Node: Dispatch, exec 100 at 2026-09-28' })
    const repeat = await fallbackIncidentKey({ ...base, title: '5 sends failed', body: 'Node: Dispatch, exec 101 at 2026-09-29' })
    const otherNode = await fallbackIncidentKey({ ...base, title: '5 sends failed', body: 'Node: Authenticate, exec 101 at 2026-09-29' })
    const http = await fallbackIncidentKey({ ...base, title: '5 sends failed', body: 'Node: Dispatch, HTTP 403, exec 101 at 2026-09-29' })
    expect(one).toBe(repeat)
    expect(otherNode).not.toBe(one)
    expect(http).not.toBe(one)
    const measured1 = await fallbackIncidentKey({ ...base, title: 'Lane under floor', body: 'sends 18, leads 7, slots 2; floor 20' })
    const measured2 = await fallbackIncidentKey({ ...base, title: 'Lane under floor', body: 'sends 15, leads 6, slots 1; floor 20' })
    const raisedFloor = await fallbackIncidentKey({ ...base, title: 'Lane under floor', body: 'sends 15, leads 6, slots 1; floor 30' })
    const status429 = await fallbackIncidentKey({ ...base, title: 'HubSpot failed', body: 'HTTP 429' })
    const status500 = await fallbackIncidentKey({ ...base, title: 'HubSpot failed', body: 'HTTP 500' })
    expect(measured1).toBe(measured2)
    expect(raisedFloor).not.toBe(measured1)
    expect(status429).not.toBe(status500)
  })

  it('normalizes measured leads and percentages but preserves a changed floor with its unit', async () => {
    const base = { family: 'lane_supply_alarm', source: 'workflow-a', tenant: 'rise', severity: 'attention', title: 'Lane below floor' }
    const a = await fallbackIncidentKey({ ...base, body: '12 leads, 8%; under floor 20 leads' })
    const b = await fallbackIncidentKey({ ...base, body: '15 leads, 11%; under floor 20 leads' })
    const c = await fallbackIncidentKey({ ...base, body: '12 leads, 8%; under floor 30 leads' })
    expect(a).toBe(b)
    expect(c).not.toBe(a)
  })

  it.each(['floor is', 'minimum', 'required', 'target of', 'threshold:', 'limit >=', 'min at'])(
    'protects an explicit %s threshold through measured-count normalization', async (phrase) => {
      const base = { family: 'lane_supply_alarm', source: 'workflow-a', tenant: 'rise', severity: 'attention', title: 'Lane below floor' }
      const a = await fallbackIncidentKey({ ...base, body: `12 leads, 8%; ${phrase} 20 leads` })
      const b = await fallbackIncidentKey({ ...base, body: `15 leads, 11%; ${phrase} 20 leads` })
      const c = await fallbackIncidentKey({ ...base, body: `12 leads, 8%; ${phrase} 30 leads` })
      expect(a).toBe(b)
      expect(c).not.toBe(a)
    },
  )
})
