// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import fixture from '../../lib/reply-source-v1.fixture.json'
const { rpc, from } = vi.hoisted(() => {
 const rpc = vi.fn()
 const from = vi.fn(() => {
  const result = Promise.resolve({ data: [], error: null, count: 0 })
  const chain: any = new Proxy({}, { get: (_, key) => key === 'then' ? result.then.bind(result) : () => chain })
  return chain
 })
 return { rpc, from }
})
vi.mock('../../lib/supabase', () => ({ supabase: { rpc, from, auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }) }, channel: () => ({ on() { return this }, subscribe() { return this } }), removeChannel: () => {} } }))
import { PerfCharts } from './Performance'
import { CampaignSheet } from './CampaignSheet'
import { CampaignSheet as WorkbenchCampaign } from '../../wb/sends/CampaignSheet'
import { OutreachBlock } from '../../wb/content/OutreachBlock'
import { OverviewView as WorkbenchOverview } from '../../wb/sends/Overview'
import { OverviewView as StockOverview } from '../../screens/kpi/OverviewView'
import { History } from '../dms/History'
import { DmHistory } from '../../wb/dms/DmHistory'
import { msg, threads } from '../dms/fixtures'
import { renderInFrame } from '../test-utils'
import type { CampaignPerf } from '../../lib/campaignPerf'
import type { BandCtx } from './bandCells'
const campaign: CampaignPerf = { campaign_id: 'campaign-a', campaign_name: 'Shared Cold lane', client_id: 'arch', is_active: true, invites_7d: 2, dms_7d: 1, replied_7d: 0, positive_7d: 0, calls_7d: 0, calls_30d: 0, accept_judged: 1, accept_72h: 0, last_send: null }
const detail = () => ({ data: fixture.detail, error: null })
const replies = () => rpc.mock.calls.filter(([name]) => name === 'inbox_reply_source')
const aggregate = () => rpc.mock.calls.filter(([name]) => name === 'outreach_reply_sources')
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(fixture.metrics.data.as_of));
 localStorage.clear()
 rpc.mockImplementation(async name => name === 'outreach_reply_sources' ? { data: fixture.metrics, error: null } : name === 'inbox_reply_source' ? detail() : { data: null, error: null })
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.clearAllMocks() })
it('mounts seat metrics in Performance without replacing the old lane rates', async () => {
 const ctx = { d: { cc: { value: null, failed: null } }, range: '30d', now: Date.now() } as unknown as BandCtx
 render(<PerfCharts seat="arch" ctx={ctx} />)
 expect(await screen.findByText('First observed text replies')).toBeTruthy()
 expect(screen.getByText('Reply rate per lane, 30 days')).toBeTruthy()
 expect(aggregate()[0][1]).toEqual({ p_client_id: 'arch', p_days: 30, p_campaign_id: null })
})
it.each(['d', 'workbench'] as const)('uses stable campaign ID in the %s campaign sheet and labels the old comparison', async shell => {
 const c = { ...campaign }
 if (shell === 'd') renderInFrame(<CampaignSheet c={c} onClose={() => {}} now={Date.now()} />)
 else render(<WorkbenchCampaign c={c} onClose={() => {}} />)
 expect(await screen.findByText('First observed text replies')).toBeTruthy()
 expect(screen.getByText('Shared lane comparison')).toBeTruthy()
 expect(aggregate()[0][1]).toEqual({ p_client_id: 'arch', p_days: 30, p_campaign_id: 'campaign-a' })
})
it('mounts Strategy metrics for its seat beside the legacy fixed-window block', async () => {
 render(<OutreachBlock lane="risedtc" />)
 expect(await screen.findByText('First observed text replies')).toBeTruthy()
 expect(aggregate()[0][1]).toEqual({ p_client_id: 'risedtc', p_days: 30, p_campaign_id: null })
})
it.each(['workbench', 'stock'] as const)('keeps separate labelled denominators for all seats in the %s overview', async shell => {
 const View = shell === 'workbench' ? WorkbenchOverview : StockOverview
 render(<View client="all" timeframe="30d" />)
 await waitFor(() => expect(screen.getAllByText('First observed text replies')).toHaveLength(3))
 const ids = aggregate().map(([, p]) => p.p_client_id).sort()
 expect(ids).toEqual(['arch', 'ivan', 'risedtc'])
 for (const name of ['Ivan', 'Rise', 'Arch']) expect(screen.getByRole('region', { name: `Reply sources for ${name}` })).toBeTruthy()
})
it('mounts the selected seat instead of an all-client denominator in both overview shells', async () => {
 const view = render(<StockOverview client="arch" timeframe="custom" range={{ from: '2026-09-01', to: '2026-09-15' }} />)
 expect(await screen.findByText('First observed text replies')).toBeTruthy()
 expect(aggregate().map(([, p]) => p.p_client_id)).toEqual(['arch'])
 view.unmount(); rpc.mockClear(); render(<WorkbenchOverview client="risedtc" timeframe="7d" />)
 expect(await screen.findByText('First observed text replies')).toBeTruthy()
 expect(aggregate().map(([, p]) => p.p_client_id)).toEqual(['risedtc'])
})
it('loads one thread source and matches first/latest badges only by stable reply ID', async () => {
 const first = fixture.detail.data.first_reply!, latest = fixture.detail.data.latest_reply!
 const [t] = threads([
  msg({ id: first.reply_id, prospect_id: 'p-a', direction: 'inbound', sent_at: first.reply_at, message_text: 'First text' }),
  msg({ id: latest.reply_id, prospect_id: 'p-a', direction: 'inbound', sent_at: latest.reply_at, message_text: 'Latest text' }),
 ])
 render(<History t={t} />)
 expect(await screen.findByText('First observed text reply')).toBeTruthy()
 expect(replies()).toHaveLength(1)
 const firstBubble = document.querySelector(`[data-msg="${first.reply_id}"]`) as HTMLElement
 const latestBubble = document.querySelector(`[data-msg="${latest.reply_id}"]`) as HTMLElement
 expect(within(firstBubble).getByText(/First observed reply/)).toBeTruthy()
 expect(within(latestBubble).getByText(/Latest observed reply/)).toBeTruthy()
})
it('keeps a thread summary when the source reply is outside the visible six messages', async () => {
 const first = fixture.detail.data.first_reply!
 const [t] = threads(Array.from({ length: 8 }, (_, i) => msg({ id: i === 0 ? first.reply_id : `recent-${i}`, prospect_id: 'p-a', direction: 'inbound', sent_at: new Date(Date.parse(first.reply_at) + i * 60000).toISOString(), message_text: `Text ${i}` })))
 render(<History t={t} />)
 expect(await screen.findByText('First observed text reply')).toBeTruthy()
 expect(document.querySelector(`[data-msg="${first.reply_id}"]`)).toBeNull()
 expect(replies()).toHaveLength(1)
})
it.each(['reaction', 'no text'])('does not invent a text reply source in a %s thread', async kind => {
 rpc.mockImplementation(async name => name === 'inbox_reply_source' ? { data: { ...fixture.detail, data: { ...fixture.detail.data, first_reply: null, latest_reply: null } }, error: null } : { data: null, error: null })
 const [t] = threads([msg({ prospect_id: 'p-a', direction: 'inbound', sent_at: '2026-10-07T10:00:00Z', message_text: kind === 'reaction' ? '👍' : '' })])
 render(<History t={t} />)
 expect(await screen.findByText('No observed text replies. Reactions are separate.')).toBeTruthy()
 expect(screen.queryByText(/First observed reply ·/)).toBeNull()
})
it('does not read alternate thread source details until that detail expands', async () => {
 const [t] = threads([msg({ prospect_id: 'p-a', direction: 'inbound', sent_at: '2026-10-07T10:00:00Z', prospect_name: 'Ada Fixture' })])
 render(<DmHistory threads={[t]} onOpen={() => {}} />)
 fireEvent.click(screen.getByRole('button', { name: 'DM history' }))
 expect(replies()).toHaveLength(0)
 const summary = screen.getByText('Reply source for Ada Fixture')
 const element = summary.closest('details')!; element.open = true; fireEvent(element, new Event('toggle'))
 expect(await screen.findByText('First observed text reply')).toBeTruthy(); expect(replies()).toHaveLength(1)
})
it('keeps messages and legacy Performance usable when the new RPC is missing', async () => {
 rpc.mockImplementation(async name => name === 'inbox_reply_source' || name === 'outreach_reply_sources' ? { data: null, error: { code: 'PGRST202' } } : { data: null, error: null })
 const [t] = threads([msg({ prospect_id: 'p-a', direction: 'inbound', sent_at: '2026-10-07T10:00:00Z', message_text: 'Existing message' })])
 render(<History t={t} />)
 expect(await screen.findByText(/Reply sources are unavailable/)).toBeTruthy(); expect(screen.getByText('Existing message')).toBeTruthy()
 cleanup()
 const ctx = { d: { cc: { value: null, failed: null } }, range: '7d', now: Date.now() } as unknown as BandCtx
 render(<PerfCharts seat="arch" ctx={ctx} />)
 expect(await screen.findByText(/Reply sources are unavailable/)).toBeTruthy(); expect(screen.getByText('Reply rate per lane, 7 days')).toBeTruthy()
})

it('removes first/latest source badges above fifteen minutes while the original thread stays available', async () => {
 vi.useRealTimers(); vi.useFakeTimers(); vi.setSystemTime(new Date(fixture.detail.data.as_of))
 const first = fixture.detail.data.first_reply!, latest = fixture.detail.data.latest_reply!
 const [t] = threads([
  msg({ id: first.reply_id, prospect_id: 'p-a', direction: 'inbound', sent_at: first.reply_at, message_text: 'First text' }),
  msg({ id: latest.reply_id, prospect_id: 'p-a', direction: 'inbound', sent_at: latest.reply_at, message_text: 'Latest text' }),
 ])
 render(<History t={t} />); await act(async () => { await Promise.resolve(); await Promise.resolve() })
 expect(screen.getByText(/First observed reply ·/)).toBeTruthy(); expect(screen.getByText(/Latest observed reply ·/)).toBeTruthy()
 rpc.mockReturnValue(new Promise(() => {}))
 await act(async () => { await vi.advanceTimersByTimeAsync(900000) })
 expect(screen.getByText(/First observed reply ·/)).toBeTruthy()
 await act(async () => { await vi.advanceTimersByTimeAsync(1) })
 expect(screen.queryByText(/First observed reply ·/)).toBeNull(); expect(screen.queryByText(/Latest observed reply ·/)).toBeNull()
 expect(screen.getByText('First text')).toBeTruthy(); expect(screen.getByText('Latest text')).toBeTruthy()
 expect(screen.getByText(/Reply sources are unavailable/)).toBeTruthy()
})

it('keeps a new reply without a badge until a later source snapshot contains its ID', async () => {
 vi.useRealTimers(); vi.useFakeTimers(); vi.setSystemTime(new Date(fixture.detail.data.as_of))
 const [t] = threads([msg({ id: 'new-reply', prospect_id: 'p-a', direction: 'inbound', sent_at: '2026-10-07T12:00:00Z', message_text: 'New reply text' })])
 render(<History t={t} />); await act(async () => { await Promise.resolve(); await Promise.resolve() })
 expect(screen.getByText('New reply text')).toBeTruthy(); expect(screen.queryByText(/Latest observed reply ·/)).toBeNull()
 const next = structuredClone(fixture.detail)
 next.data.as_of = '2026-10-07T12:01:00Z'; next.data.latest_reply!.reply_id = 'new-reply'; next.data.latest_reply!.reply_at = '2026-10-07T12:00:00Z'
 rpc.mockResolvedValue({ data: next, error: null })
 await act(async () => { await vi.advanceTimersByTimeAsync(60000) })
 expect(screen.getByText(/Latest observed reply ·/)).toBeTruthy(); expect(screen.getByText('New reply text')).toBeTruthy()
})
