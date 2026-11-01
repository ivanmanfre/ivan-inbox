import { beforeEach, expect, it, vi } from 'vitest'

let result: { data: unknown; error: unknown } = { data: [], error: null }
vi.mock('./supabase', () => ({ supabase: { from: () => ({ select: async () => result }) } }))
import { fetchDayLedger, fetchDayLedgerStrict } from './kpis'

beforeEach(() => { result = { data: [], error: null } })

it('the Lanes ledger read fails loudly instead of reading as an empty ledger', async () => {
  result = { data: null, error: new Error('JWT expired') }
  await expect(fetchDayLedgerStrict()).rejects.toThrow('JWT expired')
  // The legacy Overview read keeps its soft fail.
  expect(await fetchDayLedger()).toEqual([])
})

it('a good read returns the rows', async () => {
  result = { data: [{ client_id: 'ivan', day: '2026-11-01' }], error: null }
  expect(await fetchDayLedgerStrict()).toHaveLength(1)
})
