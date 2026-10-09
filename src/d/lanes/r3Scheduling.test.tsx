// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { forget } from '../../lib/pageMemo'
import { useLanesData } from './useLanesData'
const sdk = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: sdk.rpc } }))
const KEYS = ['cc', 'gov'] as const
beforeEach(() => { sdk.rpc.mockReset(); localStorage.setItem('sb-test-auth-token', JSON.stringify({ user: { id: 'u1' } })) })
afterEach(() => { forget(); localStorage.clear() })
it('Home can show a failed monitor with Retry while the governor is still pending', async () => {
  sdk.rpc.mockImplementation((_name: string, args: { p_keys: string[] }) => args.p_keys.includes('gov')
    ? new Promise(() => {}) : Promise.resolve({ data: { cc: { value: null, error: 'monitor unavailable' } }, error: null }))
  const view = renderHook(() => useLanesData(KEYS))
  await waitFor(() => expect(view.result.current.data.cc.failed).toBeTruthy(), { timeout: 1500 })
  expect(view.result.current.data.gov).toEqual({ value: null, failed: null })
  expect(typeof view.result.current.refresh).toBe('function')
})
const SUMMARY_KEYS = ['outcomes'] as const
it('keeps the saved summary generation time and bypasses the saved copy on Refresh', async () => {
  const stamp = '2026-10-09T22:40:00.000Z'
  sdk.rpc.mockResolvedValue({ data: { outcomes: { value: [], error: null, generated_at: stamp, from_cache: true } }, error: null })
  const view = renderHook(() => useLanesData(SUMMARY_KEYS))
  await waitFor(() => expect(view.result.current.data.outcomes.value).toEqual([]))
  expect(view.result.current.data.outcomes).toHaveProperty('generatedAt', Date.parse(stamp))
  expect(sdk.rpc).toHaveBeenCalledWith('inbox_phone_lanes_cached_r3', { p_keys: ['outcomes'], p_fresh: false }, { get: true })
  view.result.current.refresh()
  await waitFor(() => expect(sdk.rpc).toHaveBeenCalledWith('inbox_phone_lanes_cached_r3', { p_keys: ['outcomes'], p_fresh: true }, { get: true }))
})
