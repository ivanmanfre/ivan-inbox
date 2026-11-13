import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.fn()
vi.mock('./supabase', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }))

import { fetchStoreNumbers, storeLine } from './context'

const none = { est_sales_monthly_usd: null, platform: null, meta_tag: null, google_ads_tag: null }

describe('storeLine', () => {
  it('writes sales, platform and both tag states in one line', () => {
    expect(storeLine({ est_sales_monthly_usd: 37887, platform: 'shopify', meta_tag: false, google_ads_tag: false }))
      .toBe('about $38k a month in sales (estimate) · Shopify · no Meta or Google ad tags on the site')
    expect(storeLine({ ...none, est_sales_monthly_usd: 1217989, meta_tag: true, google_ads_tag: true }))
      .toBe('about $1.2M a month in sales (estimate) · Meta and Google ad tags on the site')
  })
  it('rounds small and exact-million amounts plainly', () => {
    expect(storeLine({ ...none, est_sales_monthly_usd: 640 })).toBe('about $640 a month in sales (estimate)')
    expect(storeLine({ ...none, est_sales_monthly_usd: 2_000_000 })).toBe('about $2M a month in sales (estimate)')
    expect(storeLine({ ...none, est_sales_monthly_usd: 0 })).toBe('about $0 a month in sales (estimate)')
  })
  it('names the one tag that is there', () => {
    expect(storeLine({ ...none, meta_tag: true, google_ads_tag: false })).toBe('Meta ad tag on the site, no Google')
    expect(storeLine({ ...none, meta_tag: false, google_ads_tag: true })).toBe('Google ad tag on the site, no Meta')
  })
  it('says nothing about tags when the check is incomplete, and nothing at all with no data', () => {
    expect(storeLine({ ...none, platform: 'shopify', meta_tag: true })).toBe('Shopify')
    expect(storeLine(none)).toBe('')
  })
})

describe('fetchStoreNumbers', () => {
  beforeEach(() => rpc.mockReset())
  it('asks for the one prospect and returns the row', async () => {
    const row = { est_sales_monthly_usd: 1114, platform: 'shopify', meta_tag: null, google_ads_tag: null }
    rpc.mockResolvedValue({ data: [row], error: null })
    await expect(fetchStoreNumbers('p1')).resolves.toEqual(row)
    expect(rpc).toHaveBeenCalledWith('prospect_store_numbers', { p_prospect_id: 'p1' })
  })
  it('returns null when nothing is on file', async () => {
    rpc.mockResolvedValue({ data: [], error: null })
    await expect(fetchStoreNumbers('p1')).resolves.toBeNull()
    rpc.mockResolvedValue({ data: [none], error: null })
    await expect(fetchStoreNumbers('p1')).resolves.toBeNull()
  })
  it('throws on a read error so the caller can leave the row out', async () => {
    rpc.mockResolvedValue({ data: null, error: new Error('down') })
    await expect(fetchStoreNumbers('p1')).rejects.toThrow('down')
  })
})
