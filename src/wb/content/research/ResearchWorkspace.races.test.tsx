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
import { BriefCard, ResearchPanel } from './ResearchWorkspace'
import type { SourcePage } from '../../../lib/editorialTypes'

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
