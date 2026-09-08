import { describe, it, expect, vi, beforeEach } from 'vitest'

// ONE PHONE RANG TWICE PER DM (Ivan, 2026-09-08). push_subscriptions carried two
// live Apple endpoints for the same iPhone under the ivan-inbox label and every
// sender fans out to all rows under the label. The reconcile that runs on
// every launch must leave exactly one row per device: the endpoint this
// install answers to, siblings with the same user agent gone, and nothing
// else touched.

type Step = { table: string; op: string; filters: Record<string, unknown>; payload?: unknown }
let steps: Step[] = []
let upsertError: unknown = null

function builder(table: string) {
  const make = (op: string, payload?: unknown) => {
    const step: Step = { table, op, filters: {}, payload }
    steps.push(step)
    const chain = {
      eq(k: string, v: unknown) { step.filters[`eq:${k}`] = v; return chain },
      neq(k: string, v: unknown) { step.filters[`neq:${k}`] = v; return chain },
      then(res: (v: unknown) => unknown) {
        return Promise.resolve({ error: op === 'upsert' ? upsertError : null }).then(res)
      },
    }
    return chain
  }
  return {
    upsert: (payload: unknown) => make('upsert', payload),
    delete: () => make('delete'),
  }
}

vi.mock('./supabase', () => ({ supabase: { from: (t: string) => builder(t) } }))

const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) Version/26.5.2 Mobile/15E148 Safari/604.1'
const LIVE = 'https://web.push.apple.com/LIVE'
const sub = {
  endpoint: LIVE,
  toJSON: () => ({ endpoint: LIVE, keys: { p256dh: 'p', auth: 'a' } }),
}
let existing: typeof sub | null = sub

beforeEach(() => {
  steps = []
  upsertError = null
  existing = sub
  vi.stubEnv('VITE_VAPID_PUBLIC_KEY', 'BAAA')
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      userAgent: UA,
      serviceWorker: {
        ready: Promise.resolve({
          pushManager: {
            getSubscription: async () => existing,
            subscribe: async () => sub,
          },
        }),
      },
    },
  })
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { PushManager: class {} } })
  Object.defineProperty(globalThis, 'Notification', { configurable: true, value: { permission: 'granted' } })
})

const { reconcilePush } = await import('./push')

describe('reconcilePush leaves one row per device', () => {
  it('writes this endpoint, then deletes ivan-inbox siblings with the same user agent', async () => {
    expect(await reconcilePush()).toBe('ok')
    expect(steps.map(s => s.op)).toEqual(['upsert', 'delete'])
    const [up, del] = steps
    expect(up.table).toBe('push_subscriptions')
    expect(up.payload).toMatchObject({ endpoint: LIVE, device_label: 'ivan-inbox', user_agent: UA })
    expect(del.table).toBe('push_subscriptions')
    // Three-way scope: the label, THIS device's UA, everything but the row just written.
    expect(del.filters).toEqual({ 'eq:device_label': 'ivan-inbox', 'eq:user_agent': UA, 'neq:endpoint': LIVE })
  })

  it('never deletes when the upsert failed — a device must not go quiet on a write error', async () => {
    upsertError = { message: 'rls' }
    expect(await reconcilePush()).toBe('failed')
    expect(steps.map(s => s.op)).toEqual(['upsert'])
  })

  it('re-subscribes an orphaned device and still prunes its siblings', async () => {
    existing = null
    expect(await reconcilePush()).toBe('healed')
    expect(steps.map(s => s.op)).toEqual(['upsert', 'delete'])
  })

  it('does nothing without permission', async () => {
    Object.defineProperty(globalThis, 'Notification', { configurable: true, value: { permission: 'default' } })
    expect(await reconcilePush()).toBe('skipped')
    expect(steps).toEqual([])
  })
})
