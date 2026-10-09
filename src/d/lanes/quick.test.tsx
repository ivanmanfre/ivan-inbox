// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { forget } from '../../lib/pageMemo'
import { fetchGovernor } from '../../lib/kpis'
import { useLanesData } from './useLanesData'

const sdk = vi.hoisted(() => ({ rpc: vi.fn() }))
const GOV = ['gov'] as const
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: sdk.rpc } }))
vi.mock('../../lib/kpis', async importOriginal => ({ ...await importOriginal<typeof import('../../lib/kpis')>(), fetchGovernor: vi.fn() }))

beforeEach(() => {
  localStorage.setItem('sb-test-auth-token', JSON.stringify({ user: { id: 'u1' } }))
  vi.mocked(fetchGovernor).mockReset()
  sdk.rpc.mockReset()
})
afterEach(() => { forget(); localStorage.clear() })

it('uses the verified quick slot without fetching the bulky direct source', async () => {
  const rows = [{ client_id: 'ivan', used: 3 }]
  sdk.rpc.mockResolvedValue({ data: { gov: { value: rows, error: null } }, error: null })
  const view = renderHook(() => useLanesData(GOV))
  await waitFor(() => expect(view.result.current.data.gov.value).toEqual(rows))
  expect(sdk.rpc).toHaveBeenCalledWith('inbox_phone_lanes_pick_r2', { p_keys: ['gov'] })
  expect(fetchGovernor).not.toHaveBeenCalled()
})

it('falls back to the independent source when the quick slot reports an error', async () => {
  const rows = [{ client_id: 'ivan', used: 4 }]
  sdk.rpc.mockResolvedValue({ data: { gov: { value: null, error: 'source unavailable' } }, error: null })
  vi.mocked(fetchGovernor).mockResolvedValue(rows as never)
  const view = renderHook(() => useLanesData(GOV))
  await waitFor(() => expect(view.result.current.data.gov.value).toEqual(rows))
  expect(fetchGovernor).toHaveBeenCalledTimes(1)
  expect(view.result.current.data.gov.failed).toBeNull()
})
