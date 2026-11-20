// @vitest-environment jsdom
// Ivan 11-20: an owed yes on the Ivan and SwishDM lanes said "no draft, write it yourself" while the
// audit/report was being built. The banner now reads the build stamp and says so.
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { NoDraftBanner } from './Banners'
import { NOW, owedNoDraft, threads } from './fixtures'
import { fetchBuildRaw } from '../../lib/buildStatus'

vi.mock('../../lib/buildStatus', async orig => ({ ...(await orig<typeof import('../../lib/buildStatus')>()), fetchBuildRaw: vi.fn() }))
vi.mock('../../lib/checkWait', async orig => ({ ...(await orig<typeof import('../../lib/checkWait')>()), fetchCheckState: vi.fn(async () => null) }))
afterEach(() => { cleanup(); vi.clearAllMocks() })

const H = 3_600_000
const at = (hoursAgo: number) => new Date(NOW - hoursAgo * H).toISOString()

it('Ivan lane: an audit build after the yes replaces "no draft"', async () => {
  vi.mocked(fetchBuildRaw).mockResolvedValue({ sw: null, sb: { requested_at: at(0.5), first_requested_at: at(0.5), attempts: 1 } })
  const [t] = threads(owedNoDraft('p1', { prospect_name: 'Alex Example', client_id: 'ivan' }, 1))
  render(<NoDraftBanner t={t} now={NOW} />)
  expect(await screen.findByText(/Alex said yes to the audit\. It is being built now/)).toBeTruthy()
  expect(screen.queryByText(/no draft/)).toBeNull()
})

it('SwishDM lane: a running report build replaces "no draft"', async () => {
  vi.mocked(fetchBuildRaw).mockResolvedValue({ sw: { status: 'requested', at: at(0.5), v8: { state: 'running', first_at: at(0.4), until: at(-0.5) } }, sb: null })
  const [t] = threads(owedNoDraft('p2', { prospect_name: 'Sam Example', client_id: 'swishdm' }, 1))
  render(<NoDraftBanner t={t} now={NOW} />)
  expect(await screen.findByText(/Sam said yes to the report\. It is being built now/)).toBeTruthy()
})

it('a stale stamp from an older yes keeps the plain no-draft banner', async () => {
  vi.mocked(fetchBuildRaw).mockResolvedValue({ sw: null, sb: { requested_at: at(200), attempts: 3 } })
  const [t] = threads(owedNoDraft('p3', { prospect_name: 'Kim Example', client_id: 'ivan' }, 1))
  render(<NoDraftBanner t={t} now={NOW} />)
  expect(await screen.findByText(/Kim is owed a reply: today, no draft\./)).toBeTruthy()
  expect(fetchBuildRaw).toHaveBeenCalledWith('p3')
})
