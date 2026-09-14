import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => ({ cleanup: undefined as undefined | (() => void), set: vi.fn(), fetch: vi.fn() }))
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useState: () => [null, harness.set],
  useEffect: (fn: () => () => void) => { harness.cleanup = fn() },
}))
vi.mock('../../lib/campaignControl', async importOriginal => ({
  ...await importOriginal<typeof import('../../lib/campaignControl')>(), fetchPayload: harness.fetch,
}))
import { useCampaignControl } from './Control'

describe('Control live refresh', () => {
  beforeEach(() => {
    vi.useFakeTimers(); harness.fetch.mockReset(); harness.set.mockReset()
    harness.fetch.mockResolvedValue({ state: 'unavailable', reason: 'test response' })
    vi.stubGlobal('window', new EventTarget())
    vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }))
  })
  afterEach(() => { harness.cleanup?.(); vi.unstubAllGlobals(); vi.useRealTimers() })
  it('refreshes visible Control every minute', async () => {
    useCampaignControl(); await vi.advanceTimersByTimeAsync(60_000)
    expect(harness.fetch).toHaveBeenCalledTimes(2)
  })
  it('refreshes immediately when returning to the tab', async () => {
    useCampaignControl(); await vi.advanceTimersByTimeAsync(0)
    document.dispatchEvent(new Event('visibilitychange')); await vi.advanceTimersByTimeAsync(0)
    expect(harness.fetch).toHaveBeenCalledTimes(2)
  })
  it('pauses hidden tabs, prevents overlapping requests and stops on unmount', async () => {
    harness.fetch.mockReturnValue(new Promise(() => {}))
    useCampaignControl(); await vi.advanceTimersByTimeAsync(120_000)
    expect(harness.fetch).toHaveBeenCalledTimes(1)
    harness.cleanup?.(); window.dispatchEvent(new Event('focus')); await vi.advanceTimersByTimeAsync(120_000)
    expect(harness.fetch).toHaveBeenCalledTimes(1)
  })
  it('does not publish a response after unmount', async () => {
    let resolve!: (v: unknown) => void
    harness.fetch.mockReturnValue(new Promise(r => { resolve = r }))
    useCampaignControl(); harness.cleanup?.(); resolve({ state: 'unavailable', reason: 'late' })
    await vi.advanceTimersByTimeAsync(0); expect(harness.set).not.toHaveBeenCalled()
  })
  it('does not poll hidden tabs', async () => {
    useCampaignControl(); await vi.advanceTimersByTimeAsync(0)
    Object.assign(document, { visibilityState: 'hidden' }); await vi.advanceTimersByTimeAsync(120_000)
    expect(harness.fetch).toHaveBeenCalledTimes(1)
  })
})
