// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
vi.mock('../../../lib/supabase', () => ({ supabase: {} }))
vi.mock('../../../lib/editorialSources', () => ({ readResearch: vi.fn() }))
vi.mock('../../../lib/editorialBriefs', async original => ({
  ...await original<typeof import('../../../lib/editorialBriefs')>(), requestDraft: vi.fn(),
}))
import { readResearch } from '../../../lib/editorialSources'
import { requestDraft } from '../../../lib/editorialBriefs'
import { brief } from '../../../lib/editorialBriefs.fixtures'
import { BriefCard, ResearchPanel, SourceDetail } from './ResearchWorkspace'
import type { SourcePage } from '../../../lib/editorialTypes'
import { sourceSnapshot } from '../../../lib/editorialSources.fixtures'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let host: HTMLDivElement, root: Root
beforeEach(() => {
  vi.clearAllMocks(); sessionStorage.clear()
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove() })
function page(total: number): SourcePage {
  return { client_id: 'ivan', state: 'ready', items: [], total,
    independent_source_count: 0, next_cursor: null, gaps: [], health: {
      last_successful_collection: 'unknown', source_cutoff: 'unknown',
      new_evidence_awaiting_refresh: 0, stale_inputs: 0,
    } }
}
const button = (label: string) => [...host.querySelectorAll('button')].find(b => b.textContent === label)!

it('does not replace the selected research filter with a slower previous response', async () => {
  let oldResponse!: (p: SourcePage) => void
  vi.mocked(readResearch).mockResolvedValueOnce(page(100))
    .mockImplementationOnce(() => new Promise(resolve => { oldResponse = resolve }))
    .mockResolvedValueOnce(page(7))
  await act(async () => root.render(<ResearchPanel lane="ivan" />))
  const select = host.querySelector('select')!
  await act(async () => { select.value = 'call'; select.dispatchEvent(new Event('change', { bubbles: true })) })
  // The filter must remain operable while a slower read is pending.
  const current = host.querySelector('select')!
  await act(async () => { current.value = 'own_post'; current.dispatchEvent(new Event('change', { bubbles: true })) })
  await act(async () => oldResponse(page(99)))
  expect(host.textContent).toContain('7 records')
  expect(host.textContent).not.toContain('99 records')
})

it('keeps an existing reviewed version draftable after reload and retries its same request identity', async () => {
  const b = brief({ readiness: 'ready_to_draft', missing_material: [], effective_status: 'shortlisted' })
  b.review = { reviewer_seat: 'independent-reviewer', reviewer_model: 'human',
    reviewed_at: '2026-09-21T00:00:00Z', verdict: 'pass', notes: 'Reviewed evidence.' }
  vi.mocked(requestDraft).mockRejectedValue(new Error('connection interrupted'))
  await act(async () => root.render(<BriefCard brief={b} lane="ivan" reload={() => {}} />))
  expect(host.textContent).toContain('shortlisted')
  expect(button('Create draft').disabled).toBe(false)
  await act(async () => button('Create draft').click())
  const first = vi.mocked(requestDraft).mock.calls[0][5]
  await act(async () => root.render(<div />))
  await act(async () => root.render(<BriefCard brief={b} lane="ivan" reload={() => {}} />))
  await act(async () => button('Create draft').click())
  expect(vi.mocked(requestDraft).mock.calls[1][5]).toBe(first)
})

it('offers held carousel copy only after review and retains its production hold', async () => {
  const base = brief()
  const b = brief({ editorial_direction: { ...base.editorial_direction, format: 'carousel' },
    readiness: 'needs_material', missing_material: ['4-6 slide visual sequence design'] })
  b.review = { reviewer_seat: 'independent-reviewer', reviewer_model: 'human',
    reviewed_at: '2026-09-21T00:00:00Z', verdict: 'pass', notes: 'Copy-only evidence reviewed.' }
  vi.mocked(requestDraft).mockResolvedValue({ state: 'accepted' } as never)
  await act(async () => root.render(<BriefCard brief={b} lane="ivan" reload={() => {}} />))
  expect(host.textContent).toContain('Production holds:')
  expect(host.textContent).toContain('4-6 slide visual sequence design')
  expect(button('Create internal copy').disabled).toBe(false)
  await act(async () => button('Create internal copy').click())
  expect(vi.mocked(requestDraft).mock.calls[0][6]).toBe('internal_copy')
  expect(host.textContent).toContain('does not approve publication')
})


it('requests ready image posts as internal copy with their image holds intact', async () => {
  const base = brief()
  const b = brief({ editorial_direction: { ...base.editorial_direction, format: 'single_image' },
    readiness: 'ready_to_draft', missing_material: [],
    production: { ...base.production, required_materials: ['Owned image still required'] } })
  b.review = { reviewer_seat: 'independent-reviewer', reviewer_model: 'human',
    reviewed_at: '2026-09-21T00:00:00Z', verdict: 'pass', notes: 'Internal copy reviewed.' }
  vi.mocked(requestDraft).mockResolvedValue({ state: 'accepted' } as never)
  await act(async () => root.render(<BriefCard brief={b} lane="ivan" reload={() => {}} />))
  expect(host.textContent).toContain('Owned image still required')
  expect(button('Create internal copy')).toBeDefined()
  await act(async () => button('Create internal copy').click())
  expect(vi.mocked(requestDraft).mock.calls[0][6]).toBe('internal_copy')
  expect(vi.mocked(requestDraft).mock.calls[0].slice(1,5)).toEqual(['ivan', b.identity.brief_id, b.identity.version, b.identity.content_hash])
})

it('does not offer an internal-copy escape for image posts missing factual proof', async () => {
  const base = brief()
  const b = brief({ editorial_direction: { ...base.editorial_direction, format: 'single_image' },
    readiness: 'needs_material', missing_material: ['Verified measurement unavailable'] })
  await act(async () => root.render(<BriefCard brief={b} lane="ivan" reload={() => {}} />))
  expect(button('Create internal copy')).toBeUndefined()
  expect(button('Create draft').disabled).toBe(true)
  expect(vi.mocked(requestDraft)).not.toHaveBeenCalled()
})

it('renders source body state, native identity, metrics and measurement provenance in the detail ledger', async () => {
  const source = sourceSnapshot({ body_state: 'excerpt',
    source_identity: { platform: 'linkedin', native_id: 'urn:li:activity:fixture', collector_row_id: 'metric-row-1' },
    observed_metrics: { impressions: 271, reactions: 0, comments: 5 },
    metric_provenance: { source: 'client_post_metrics', denominator: 'one exact own post',
      observation_window: { published_at: '2026-09-15', captured_at: '2026-09-20' } } })
  await act(async () => root.render(<SourceDetail source={source} close={() => {}} lane="risedtc" previewLinked={[]} readOnly />))
  expect(host.textContent).toContain('Body completeness')
  expect(host.textContent).toContain('excerpt')
  expect(host.textContent).toContain('linkedin:urn:li:activity:fixture')
  expect(host.textContent).toContain('impressions: 271; reactions: 0; comments: 5')
  expect(host.textContent).toContain('source: client_post_metrics; denominator: one exact own post')
  expect(host.textContent).toContain('captured_at: 2026-09-20')
})

it('links source usage to the exact brief identity in its own client lane', async () => {
  const b = brief(); const source = sourceSnapshot()
  await act(async () => root.render(<SourceDetail source={source} close={() => {}} lane="ivan" previewLinked={[b]} readOnly />))
  const link = host.querySelector<HTMLAnchorElement>('a[href*="brief_id="]')
  expect(link?.getAttribute('href')).toContain(`lane=ivan&section=this-week&brief_id=${b.identity.brief_id}&brief_version=${b.identity.version}`)
  expect(host.textContent).toContain(`Open exact brief ${b.identity.brief_id} v${b.identity.version}`)
})

it('marks a brief linked to an earlier direction without changing its immutable version', async () => {
  const b = brief()
  await act(async () => root.render(<BriefCard brief={b} lane="ivan" reload={() => {}} readOnly currentDirectionVersion="newer-direction" />))
  expect(host.textContent).toContain('earlier direction')
  expect(host.textContent).toContain(`This brief is linked to direction ${b.purpose.direction_version}`)
  expect(host.textContent).toContain('Existing drafts retain their original link.')
  expect(b.purpose.direction_version).not.toBe('newer-direction')
})
