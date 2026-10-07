// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import fixture from '../../lib/reply-source-v1.fixture.json'
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('../../lib/supabase', () => ({ supabase: { rpc, auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }) } } }))
import { ReplySources } from './ReplySources'
import { ReplySourceSummary } from '../dms/ReplySourceSummary'
const scope = { kind: 'operator', clientId: 'ivan' } as const
beforeEach(() => { rpc.mockResolvedValue({ data: fixture.metrics, error: null }) })
afterEach(() => { cleanup(); vi.resetAllMocks() })
it('renders SQL data as three semantic tables with null samples and real zero rates', async () => {
 render(<ReplySources scope={scope} />)
 const tables = await screen.findAllByRole('table'); expect(tables).toHaveLength(3)
 expect(screen.getByText('First observed text replies')).toBeTruthy()
 expect(screen.getByText('Last 30 days · rolling UTC')).toBeTruthy()
 expect(screen.getAllByText(/Europe\/Warsaw/).length).toBeGreaterThan(0)
 expect(screen.getAllByText('No mature sample').length).toBeGreaterThan(0)
 expect(within(tables[0]).getByRole('rowheader', { name: 'Unknown touch' })).toBeTruthy()
 expect(within(tables[0]).getByRole('rowheader', { name: 'DM5' })).toBeTruthy()
 expect(screen.getByText(/History is incomplete/)).toBeTruthy()
 const zero = structuredClone(fixture.metrics)
 zero.data.touches[1] = { ...zero.data.touches[1], sends: 1, recipients: 1, eligible: 1, mature: 1, pending: 0, replies_7d: 0, rate_pct: 0 }
 rpc.mockResolvedValue({ data: zero, error: null }); fireEvent.click(screen.getByRole('button', { name: '7 days' }))
 await waitFor(() => expect(within(screen.getAllByRole('table')[1]).getByText('0.0%')).toBeTruthy())
 expect(rpc).toHaveBeenLastCalledWith('outreach_reply_sources', { p_client_id: 'ivan', p_days: 7, p_campaign_id: null })
})
it.each([
 ['preview', 'Preview board'], ['not_configured', 'Reply sources are not configured'], ['not_found', 'No reply source data'],
] as const)('shows %s apart from a live numeric payload', async (status, label) => {
 rpc.mockResolvedValue({ data: { status, data: null }, error: null }); render(<ReplySources scope={scope} />)
 expect(await screen.findByText(new RegExp(label))).toBeTruthy(); expect(screen.queryByRole('table')).toBeNull()
})
it('shows an empty configured history with the fixed zero rows and null rates', async () => {
 const empty = structuredClone(fixture.metrics)
 empty.data.totals = { reactions: 0, recipients: 0, first_responders: 0, followup_responders: 0 }
 empty.data.sources.forEach(r => Object.assign(r, { responders: 0, positive: 0, unclassified: 0, share_pct: null }))
 empty.data.touches.forEach(r => Object.assign(r, { sends: 0, recipients: 0, eligible: 0, mature: 0, pending: 0, replies_7d: 0, rate_pct: null, late: 0, repeated: 0 }))
 empty.data.followups = []; rpc.mockResolvedValue({ data: empty, error: null }); render(<ReplySources scope={scope} />)
 expect(await screen.findByText('No qualifying events in this period.')).toBeTruthy(); expect(screen.getAllByRole('table')).toHaveLength(3)
})
it('keeps a preview free of live requests', () => {
 render(<ReplySources scope={{ kind: 'preview' }} />); expect(screen.getByText(/Preview board/)).toBeTruthy(); expect(rpc).not.toHaveBeenCalled()
})
it('offers a working read retry without showing a raw server error', async () => {
 rpc.mockRejectedValueOnce(new Error('secret transport')); render(<ReplySources scope={scope} />)
 const retry = await screen.findByRole('button', { name: 'Retry reply sources' }); expect(screen.queryByText(/secret transport/)).toBeNull()
 retry.focus(); expect(document.activeElement).toBe(retry); fireEvent.click(retry)
 expect(await screen.findAllByRole('table')).toHaveLength(3)
})
it('shows denied and unavailable states without hidden old tables', async () => {
 rpc.mockResolvedValueOnce({ data: null, error: { code: 'PGRST202' } }); const view = render(<ReplySources scope={scope} />)
 expect(await screen.findByText(/Reply sources are unavailable/)).toBeTruthy(); expect(screen.queryByRole('table')).toBeNull()
 rpc.mockResolvedValueOnce({ data: null, error: { code: '42501' } }); view.rerender(<ReplySources scope={{ kind: 'operator', clientId: 'arch' }} />)
 expect(await screen.findByText(/Reply source access is denied/)).toBeTruthy(); expect(screen.queryByRole('table')).toBeNull()
})
it('shows first and latest observed text reply source, product and method from the SQL fixture', async () => {
 rpc.mockResolvedValue({ data: fixture.detail, error: null }); render(<ReplySourceSummary scope={scope} prospectId="p-a" />)
 expect(await screen.findByText('First observed text reply')).toBeTruthy(); expect(screen.getByText('Latest observed text reply')).toBeTruthy()
 expect(screen.getAllByText(/Same chat inference/).length).toBeGreaterThan(0); expect(screen.getAllByText(/LinkedIn DM/).length).toBeGreaterThan(0)
 expect(rpc).toHaveBeenCalledOnce()
})
it('uses a fixed reason label and never exposes an unknown server reason', async () => {
 const detail = structuredClone(fixture.detail); Object.assign(detail.data.first_reply!, { touch: 'unknown', method: 'unknown', reason: 'raw-private-database-error' })
 rpc.mockResolvedValue({ data: detail, error: null }); render(<ReplySourceSummary scope={scope} prospectId="p-a" />)
 expect(await screen.findByText(/Source not established/)).toBeTruthy(); expect(screen.queryByText(/raw-private/)).toBeNull()
})
it('makes no source read for closed details and reads when opened', async () => {
 rpc.mockResolvedValue({ data: fixture.detail, error: null }); const view = render(<ReplySourceSummary scope={scope} prospectId="p-a" enabled={false} />)
 expect(rpc).not.toHaveBeenCalled(); expect(view.container.textContent).toBe('')
 view.rerender(<ReplySourceSummary scope={scope} prospectId="p-a" enabled />); expect(await screen.findByText('First observed text reply')).toBeTruthy()
})
it('keeps reaction-only and no-text source details apart from a reply', async () => {
 rpc.mockResolvedValue({ data: { ...fixture.detail, data: { ...fixture.detail.data, first_reply: null, latest_reply: null } }, error: null })
 render(<ReplySourceSummary scope={scope} prospectId="p-a" />)
 expect(await screen.findByText('No observed text replies. Reactions are separate.')).toBeTruthy()
})

it('renders source timestamps in the supplied board zone without changing the RPC scope', async () => {
 rpc.mockResolvedValue({ data: fixture.detail, error: null })
 render(<ReplySourceSummary scope={{ kind: 'board-token', slug: 'fixture', token: 'test-token' }} prospectId="p-a" displayZone="America/New_York" />)
 await screen.findByText('First observed text reply')
 expect(screen.getByText(/As of 7 Oct 2026, 08:00 · America\/New_York/)).toBeTruthy()
 expect(screen.queryByText(/Europe\/Warsaw/)).toBeNull()
 expect(rpc).toHaveBeenCalledWith('client_board_reply_source', { p_slug: 'fixture', p_token: 'test-token', p_prospect_id: 'p-a' })
})
it.each([
 ['no_prior_send', 'No preceding source send'],
 ['reply_time_tie', 'First reply order is ambiguous'],
 ['outbound_time_tie', 'Source send order is ambiguous'],
 ['unlocated_later_send', 'A later send has no provider chat'],
 ['unfinished_action', 'The source send was incomplete at reply time'],
 ['unknown_channel', 'Channel not established'],
 ['receipt_identity_conflict', 'Conflicting person identity for a provider receipt'],
 ['receipt_scope_conflict', 'Conflicting chat or channel for a provider receipt'],
 ['blocked_or_partial', 'The source send was blocked or partial'],
 ['missing_delivery_evidence', 'Confirmed delivery evidence is missing'],
 ['action_conflict', 'Conflicting send action evidence'],
] as const)('shows a fixed label for SQL reason %s', async (reason, label) => {
 const detail = structuredClone(fixture.detail); Object.assign(detail.data.first_reply!, { method: 'unknown', touch: 'unknown', reason })
 rpc.mockResolvedValue({ data: detail, error: null }); render(<ReplySourceSummary scope={scope} prospectId="p-a" />)
 expect(await screen.findByText(new RegExp(label))).toBeTruthy(); expect(screen.queryByText(new RegExp(reason))).toBeNull()
})

it.each(['interrupted', 'unknown'] as const)('shows episode outcome %s without an attributed follow-up ordinal', async outcome => {
 const detail = structuredClone({ ...fixture.detail, data: { ...fixture.detail.data, latest_reply: null } })
 Object.assign(detail.data.first_reply!, { followup_ordinal: null, episode_outcome: outcome })
 rpc.mockResolvedValue({ data: detail, error: null })
 render(<ReplySourceSummary scope={scope} prospectId="p-a" />)
 expect(await screen.findByText(`Episode: ${outcome}.`)).toBeTruthy()
 expect(screen.queryByText(/Delivered follow-up/)).toBeNull()
})
