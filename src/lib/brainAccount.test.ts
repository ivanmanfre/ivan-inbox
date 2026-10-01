import { describe, expect, it, vi } from 'vitest'
vi.mock('./supabase', () => ({ supabase: { rpc: vi.fn() } }))
import { parseBrainScoreboard, parseRepeatEngagers, parseOutlierLabels, setOutlierLabel, undoOutlierLabel, fetchBrainScoreboard, fetchOutlierLabels } from './brainAccount'
import { supabase } from './supabase'
const metric = { published_n: 0, engagement_n: 0, engagement_median: null, impressions_n: 0, impressions_median: null, above_floor_p75_n: 0, above_floor_p75_eligible_n: 0, above_floor_p75_share: null, relevant_scored_engager_posts_n: 0, scored_engagers_total: null, relevant_engagers_total: null, relevant_engagers_per_post: null }
const board = { ok: true, client: 'ivan', refresh_status: 'ready', as_of: '2026-10-01', refreshed_at: '2026-10-01', stale: false, floor: null, cohort: { status: 'no_cohort', brain_published_n: 0, unlinked_brain_n: 0, weeks_utc: [], comparison_status: 'no_cohort', comparison_available: false, brain: metric, other: metric }, rolling_4w: { start_at: '2026-09-03', end_exclusive: '2026-10-01', account: metric, engagement_vs_floor_delta: null, engagement_vs_floor_ratio: null, engagement_ratio_reason: 'no_metrics', impressions_vs_floor_delta: null, impressions_vs_floor_ratio: null, impressions_ratio_reason: 'no_metrics' }, limitations: [null, 'Fixture only'] }
describe('scoreboard scope and missing data', () => {
 it('keeps measured zero distinct from missing and preserves all denominators', () => {
  const account = { ...metric, published_n: 1, engagement_n: 1, engagement_median: 0, above_floor_p75_eligible_n: 1, above_floor_p75_share: 0 }
  const d = parseBrainScoreboard({ ...board, rolling_4w: { ...board.rolling_4w, account } }, 'ivan')
  expect(d.rolling_4w?.account.engagement_median).toBe(0)
  expect(d.rolling_4w?.account.impressions_median).toBeNull()
  expect(d.rolling_4w?.account.above_floor_p75_share).toBe(0)
  expect(d.limitations).toEqual(['Fixture only'])
 })
 it('rejects malformed counts and mismatched client rather than defaulting to zero', () => {
  expect(() => parseBrainScoreboard(board, 'arch')).toThrow(/client/)
  expect(() => parseBrainScoreboard({ ...board, rolling_4w: { ...board.rolling_4w, account: { ...metric, engagement_n: undefined } } }, 'ivan')).toThrow(/count/)
  expect(() => parseBrainScoreboard({ ...board, rolling_4w: { ...board.rolling_4w, account: { ...metric, engagement_n: 1 } } }, 'ivan')).toThrow(/coverage/)
 })
 it('accepts explicit never-refreshed state without claiming an empty cohort', () => {
  const d = parseBrainScoreboard({ ...board, refresh_status: 'not_refreshed', as_of: null, refreshed_at: null, cohort: null, rolling_4w: null }, 'ivan')
  expect(d.cohort).toBeNull(); expect(d.refresh_status).toBe('not_refreshed')
 })
 it('rejects a no-cohort claim that contradicts its stored publication count', () => {
  expect(() => parseBrainScoreboard({ ...board, cohort: { ...board.cohort, brain_published_n: 2 } }, 'ivan')).toThrow(/contradicts/)
 })
 it('keeps an unavailable floor-p75 count null without inventing zero', () => {
  const d = parseBrainScoreboard({ ...board, rolling_4w: { ...board.rolling_4w, account: { ...metric, above_floor_p75_n: null } } }, 'ivan')
  expect(d.rolling_4w?.account.above_floor_p75_n).toBeNull()
 })
 it('calls only the frozen read RPC with explicit client and propagates errors', async () => {
  vi.mocked(supabase.rpc).mockResolvedValueOnce({ data: null, error: { message: 'Fixture unavailable' } } as never)
  await expect(fetchBrainScoreboard('arch')).rejects.toThrow('Fixture unavailable')
  expect(supabase.rpc).toHaveBeenCalledWith('cb34_scoreboard', expect.objectContaining({ p_client: 'arch' }))
 })
})
const repeats = { ok: true, client: 'ivan', state: 'source_unavailable', reason: 'Current relationship cannot be established', rows: [], returned: 0, next_after_person: null, limitation: 'Fixture limitation', send_capable: false }
it('keeps unavailable repeat evidence separate from a confirmed empty eligible list', () => {
 expect(parseRepeatEngagers(repeats, 'ivan').state).toBe('source_unavailable')
 expect(() => parseRepeatEngagers({ ...repeats, send_capable: true }, 'ivan')).toThrow(/unsupported/)
 expect(() => parseRepeatEngagers(repeats, 'arch')).toThrow(/client/)
})
const human = { client_id: 'ivan', platform: 'x', post_ref: '123', label: 'keep', reason: 'relevant', actor_uid: 'fixture-human', created_at: '2026-10-01', updated_at: '2026-10-01', revision: 'fixture-revision', can_edit: true }
const calibration = { state: 'waiting_for_labels', label_n: 1, required_n: 30, reason: 'Waiting for actual human labels' }
it('rejects labels for another source and derives no human default truth', () => {
 const raw = { ok: true, client: 'ivan', rows: [human], calibration }
 const d = parseOutlierLabels(raw, 'ivan', [{ platform: 'x', post_ref: '123' }])
 expect(d.rows[0].verdict).toBe('keep'); expect(d.rows[0].undoInvocationId).toBeNull()
 expect(() => parseOutlierLabels(raw, 'ivan', [{ platform: 'x', post_ref: '999' }])).toThrow(/unexpected/)
 expect(() => parseOutlierLabels({ ...raw, rows: [{ ...human, client_id: 'arch' }] }, 'ivan', [{ platform: 'x', post_ref: '123' }])).toThrow(/client/)
})
it('does not claim automatic calibration runs when the saved truth needs review', () => {
 const raw = { ok: true, client: 'ivan', rows: [], calibration: { state: 'review_required', label_n: 30, required_n: 30, runner_ready: false, reason: 'automatic_calibration_worker_not_available' } }
 expect(parseOutlierLabels(raw, 'ivan', []).calibration).toMatchObject({ state: 'review_required', labelN: 30, runnerReady: false })
 expect(() => parseOutlierLabels({ ...raw, calibration: { ...raw.calibration, state: 'running' } }, 'ivan', [])).toThrow(/not been confirmed/)
})
it('an undeployed RPC has an unavailable message instead of a false empty result', async () => {
 vi.mocked(supabase.rpc).mockResolvedValueOnce({ data: null, error: { code: 'PGRST202', message: 'Fixture missing function details' } } as never)
 await expect(fetchBrainScoreboard('ivan')).rejects.toThrow('This Brain service is not available yet.')
})
it('one-word reasons fail locally and undo without a durable receipt does not issue a mutation', async () => {
 const before = vi.mocked(supabase.rpc).mock.calls.length
 await expect(setOutlierLabel('ivan', { platform: 'x', post_ref: '123' }, 'drop', 'two words')).rejects.toThrow(/one word/)
 const label = parseOutlierLabels({ ok: true, client: 'ivan', rows: [human], calibration }, 'ivan', [{ platform: 'x', post_ref: '123' }]).rows[0]
 await expect(undoOutlierLabel('ivan', label)).rejects.toThrow(/Undo receipt/)
 expect(vi.mocked(supabase.rpc).mock.calls).toHaveLength(before)
})
it('a set requires matching durable invocation/audit/Undo receipt before it reports saved', async () => {
 vi.mocked(supabase.rpc).mockImplementationOnce((_name, args) => {
  const id = (args as Record<string, unknown>).p_invocation_id
  return Promise.resolve({ data: { ok: true, client: 'ivan', label: human, calibration, invocation_id: id, audit_id: 4, mutation_at: '2026-10-01', undo: { invocation_id: id, revision: human.revision } }, error: null }) as never
 })
 const result = await setOutlierLabel('ivan', { platform: 'x', post_ref: '123' }, 'keep', 'relevant')
 expect(result.label?.undoInvocationId).toBe(result.invocationId)
 expect(supabase.rpc).toHaveBeenLastCalledWith('cb34_outlier_label_set', expect.objectContaining({ p_client: 'ivan', p_post_ref: '123', p_reason: 'relevant' }))
})

it('reads catalogue labels beyond 250 visible rows serially without dropping a source', async () => {
 const refs = Array.from({ length: 1025 }, (_, n) => ({ platform: 'x' as const, post_ref: String(n) }))
 let active = 0, peak = 0
 vi.mocked(supabase.rpc).mockImplementation((_name, args) => {
  active++; peak = Math.max(peak, active)
  const batch = (args as { p_refs: typeof refs }).p_refs
  return Promise.resolve().then(() => { active--; return { data: { ok: true, client: 'ivan', rows: batch.map(r => ({ ...human, post_ref: r.post_ref })), calibration }, error: null } }) as never
 })
 const before = vi.mocked(supabase.rpc).mock.calls.length
 const result = await fetchOutlierLabels('ivan', refs)
 const batches = vi.mocked(supabase.rpc).mock.calls.slice(before).map(call => (call[1] as { p_refs: typeof refs }).p_refs)
 expect(batches.map(batch => batch.length)).toEqual([250, 250, 250, 250, 25])
 expect(result.rows.map(r => r.post_ref)).toEqual(refs.map(r => r.post_ref))
 expect(peak).toBe(1)
})

it('rejects a foreign-source label in a later catalogue chunk rather than returning partial truth', async () => {
 const refs = Array.from({ length: 251 }, (_, n) => ({ platform: 'x' as const, post_ref: String(n) }))
 vi.mocked(supabase.rpc).mockImplementationOnce(() => Promise.resolve({ data: { ok: true, client: 'ivan', rows: [], calibration }, error: null }) as never)
 vi.mocked(supabase.rpc).mockImplementationOnce(() => Promise.resolve({ data: { ok: true, client: 'ivan', rows: [{ ...human, post_ref: 'foreign' }], calibration }, error: null }) as never)
 await expect(fetchOutlierLabels('ivan', refs)).rejects.toThrow(/unexpected source/)
})
