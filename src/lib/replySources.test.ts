import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fixture from './reply-source-v1.fixture.json'
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('./supabase', () => ({ supabase: { rpc } }))
import { loadReplySources, loadReplySource, formatReplyPct, touchLabel } from './replySources'
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(fixture.metrics.data.as_of)) })
afterEach(() => { vi.useRealTimers(); vi.resetAllMocks() })
const operator = { kind: 'operator', clientId: 'risedtc', campaignId: 'campaign-a' } as const
const clone = () => structuredClone(fixture.metrics)
describe('reply source API boundary', () => {
 it('keeps a null rate apart from a real zero', () => {
  expect(formatReplyPct(null)).toBe('—'); expect(formatReplyPct(0)).toBe('0.0%'); expect(formatReplyPct(25)).toBe('25.0%')
  expect(touchLabel('dm4')).toBe('DM4'); expect(touchLabel('recycle')).toBe('Recycle')
 })
 it('accepts the real SQL metrics envelope and exact operator arguments without a gate', async () => {
  rpc.mockResolvedValue({ data: fixture.metrics, error: null })
  expect(await loadReplySources(operator, 30)).toEqual({ kind: 'ready', data: fixture.metrics.data })
  expect(rpc).toHaveBeenCalledWith('outreach_reply_sources', { p_client_id: 'risedtc', p_days: 30, p_campaign_id: 'campaign-a' })
 })
 it.each([
  [{ kind: 'board-token', slug: 'fixture', token: 'test-token' }, 'client_board_reply_sources', { p_slug: 'fixture', p_token: 'test-token', p_days: 7 }],
  [{ kind: 'board-session', slug: 'fixture', session: 'test-session' }, 'client_board_reply_sources_v2', { p_slug: 'fixture', p_session: 'test-session', p_days: 7 }],
 ] as const)('uses the board credential wrapper for %o', async (scope, name, params) => {
  rpc.mockResolvedValue({ data: fixture.metrics, error: null }); await loadReplySources(scope, 7)
  expect(rpc).toHaveBeenCalledWith(name, params)
 })
 it.each([
  [operator, 'inbox_reply_source', { p_prospect_id: 'p-a' }],
  [{ kind: 'board-token', slug: 'fixture', token: 'test-token' }, 'client_board_reply_source', { p_slug: 'fixture', p_token: 'test-token', p_prospect_id: 'p-a' }],
  [{ kind: 'board-session', slug: 'fixture', session: 'test-session' }, 'client_board_reply_source_v2', { p_slug: 'fixture', p_session: 'test-session', p_prospect_id: 'p-a' }],
 ] as const)('uses the narrow source wrapper for %o', async (scope, name, params) => {
  rpc.mockResolvedValue({ data: fixture.detail, error: null })
  expect(await loadReplySource(scope, 'p-a')).toEqual({ kind: 'ready', data: fixture.detail.data })
  expect(rpc).toHaveBeenCalledWith(name, params)
 })
 it('makes no RPC for a preview', async () => {
  expect(await loadReplySources({ kind: 'preview' }, 30)).toEqual({ kind: 'preview' })
  expect(await loadReplySource({ kind: 'preview' }, 'p-a')).toEqual({ kind: 'preview' }); expect(rpc).not.toHaveBeenCalled()
 })
 it.each(['preview', 'not_configured', 'not_found'] as const)('maps %s with no data', async status => {
  rpc.mockResolvedValue({ data: { status, data: null }, error: null })
  expect(await loadReplySource(operator, 'p-a')).toEqual({ kind: status === 'not_found' ? 'empty' : status })
 })
 it.each(['PGRST202', '42883'])('maps missing RPC %s to unavailable', async code => {
  rpc.mockResolvedValue({ data: null, error: { code, message: 'internal database detail' } })
  expect(await loadReplySources(operator, 30)).toEqual({ kind: 'unavailable' })
 })
 it.each(['42501', 'PGRST301', 'PGRST302', 'PGRST303', '401', '403'])('maps access error %s to denied', async code => {
  rpc.mockResolvedValue({ data: null, error: { code, message: 'internal database detail' } })
  expect(await loadReplySources(operator, 30)).toEqual({ kind: 'denied' })
 })
 it('maps a rejected network request to a fixed read error', async () => {
  rpc.mockRejectedValue(new Error('private transport details'))
  expect(await loadReplySources(operator, 30)).toEqual({ kind: 'error', message: 'Could not read reply sources. Try again.' })
 })
 it.each([
  (v: any) => { v.data = null },
  (v: any) => { v.data.schema_version = 2 },
  (v: any) => { v.data.sources.pop() },
  (v: any) => { v.data.touches[1].touch = 'unknown' },
  (v: any) => { v.data.touches[0].sends = '1' },
  (v: any) => { v.data.totals.reactions = -1 },
  (v: any) => { v.data.sources[0].share_pct = 101 },
  (v: any) => { v.data.coverage.history_complete = true },
  (v: any) => { delete v.data.coverage.unknown_sources },
  (v: any) => { v.data.period.basis = 'calendar_month' },
  (v: any) => { v.data.as_of = 'bad timestamp' },
 ])('rejects malformed or incomplete metrics %s', async change => {
  const data = clone(); change(data); rpc.mockResolvedValue({ data, error: null })
  expect(await loadReplySources(operator, 30)).toEqual({ kind: 'unavailable' })
 })
 it('rejects a detail with an invalid method instead of showing false attribution', async () => {
  const data = structuredClone(fixture.detail); (data.data.first_reply as any).method = 'explicit'
  rpc.mockResolvedValue({ data, error: null }); expect(await loadReplySource(operator, 'p-a')).toEqual({ kind: 'unavailable' })
 })
})

it.each(['aggregate', 'source'] as const)('parses explicit unavailable for %s with no numeric payload', async kind => {
 rpc.mockResolvedValue({ data: { status: 'unavailable', data: null }, error: null })
 expect(await (kind === 'aggregate' ? loadReplySources(operator, 30) : loadReplySource(operator, 'p-a'))).toEqual({ kind: 'unavailable' })
})
it.each(['aggregate', 'source'] as const)('rejects future and expired %s snapshots with unchanged schema', async kind => {
 const envelope = kind === 'aggregate' ? fixture.metrics : fixture.detail
 rpc.mockResolvedValue({ data: envelope, error: null })
 vi.setSystemTime(new Date(Date.parse(envelope.data.as_of) - 1))
 expect((await (kind === 'aggregate' ? loadReplySources(operator, 30) : loadReplySource(operator, 'p-a'))).kind).toBe('unavailable')
 vi.setSystemTime(new Date(Date.parse(envelope.data.as_of) + 900000))
 expect((await (kind === 'aggregate' ? loadReplySources(operator, 30) : loadReplySource(operator, 'p-a'))).kind).toBe('ready')
 vi.setSystemTime(new Date(Date.parse(envelope.data.as_of) + 900001))
 expect((await (kind === 'aggregate' ? loadReplySources(operator, 30) : loadReplySource(operator, 'p-a'))).kind).toBe('unavailable')
})
it.each(['invalid', '2026-10-07T12:00:00', '2026-02-30T12:00:00Z'])('rejects an invalid or unzoned snapshot timestamp %s', async as_of => {
 rpc.mockResolvedValue({ data: { ...fixture.detail, data: { ...fixture.detail.data, as_of } }, error: null })
 expect(await loadReplySource(operator, 'p-a')).toEqual({ kind: 'unavailable' })
})
