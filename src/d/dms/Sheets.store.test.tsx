// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Thread } from '../../lib/inbox'

const store = vi.fn()
vi.mock('../../lib/supabase', () => ({ supabase: {} }))
vi.mock('../ui/toast', () => ({ useToast: () => ({ show: vi.fn() }) }))
vi.mock('../../wb/dms/conversationAgentData', () => ({ fetchConversationAgentCards: vi.fn(async () => []) }))
vi.mock('../../lib/context', async orig => ({
  ...(await orig<typeof import('../../lib/context')>()),
  fetchProspectContext: vi.fn(async () => ({ icp_score: 7, title: 'Founder', location: 'Oslo', industry: 'Beauty', company_domain: 'natural-nuance.com' })),
  fetchScan: vi.fn(async () => null),
  fetchStoreNumbers: (...a: unknown[]) => store(...a),
}))

import { ContextSheet } from './Sheets'

const t = { prospect_id: 'p1', prospect_name: 'Ase Karin', prospect_company: 'Natural Nuance', client_id: 'risedtc', lane: null } as unknown as Thread

afterEach(() => { cleanup(); store.mockReset() })

describe('ContextSheet store row', () => {
  it('shows what is on file about the store, between Scan and Sequence', async () => {
    store.mockResolvedValue({ est_sales_monthly_usd: 37887, platform: 'shopify', meta_tag: false, google_ads_tag: false })
    render(<ContextSheet t={t} all={[]} onClose={() => {}} />)
    await waitFor(() => expect(screen.getByText('Store')).toBeTruthy())
    expect(screen.getByText('about $38k a month in sales (estimate) · Shopify · no Meta or Google ad tags on the site')).toBeTruthy()
    expect(store).toHaveBeenCalledWith('p1')
    const labels = [...document.querySelectorAll('dt')].map(d => d.textContent)
    expect(labels.indexOf('Store')).toBe(labels.indexOf('Scan') + 1)
    expect(labels.indexOf('Sequence')).toBe(labels.indexOf('Store') + 1)
  })

  it('leaves the row out when nothing is on file', async () => {
    store.mockResolvedValue(null)
    render(<ContextSheet t={t} all={[]} onClose={() => {}} />)
    await waitFor(() => expect(screen.getByText('Fit')).toBeTruthy())
    expect(screen.queryByText('Store')).toBeNull()
  })

  it('leaves the row out, and keeps the rest of the sheet, when the read fails', async () => {
    store.mockRejectedValue(new Error('down'))
    render(<ContextSheet t={t} all={[]} onClose={() => {}} />)
    await waitFor(() => expect(screen.getByText('Fit')).toBeTruthy())
    expect(screen.queryByText('Store')).toBeNull()
    expect(screen.getByText('7 / 10')).toBeTruthy()
  })
})
