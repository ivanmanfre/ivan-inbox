import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
const { notes } = vi.hoisted(() => ({ notes: { error: 'Notes unavailable', loading: false, dirty: false, sections: [], updatedAt: null, refresh: vi.fn() } }))
vi.mock('../hooks/useStrategy', () => ({ useStrategy: () => notes }))
vi.mock('../hooks/usePullToRefresh', () => ({ usePullToRefresh: () => ({ pull: 0, refreshing: false, trigger: 70 }) }))
vi.mock('../wb/chrome/ConfirmSheet', () => ({ useConfirm: () => vi.fn() }))
vi.mock('../wb/content/ProposalsBlock', () => ({ ProposalsBlock: () => createElement('div', null, 'Recommendation shortlist') }))
vi.mock('../wb/content/BenchmarkBlock', () => ({ BenchmarkBlock: () => createElement('div', null, 'Evidence measurement') }))
vi.mock('../wb/content/AudienceBlock', () => ({ AudienceBlock: () => null }))
vi.mock('../wb/content/ThemesBlock', () => ({ ThemesBlock: () => null }))
vi.mock('./supabase', () => ({ supabase: {} }))
import { StrategyView } from '../wb/content/strategy'
describe('Strategy independent views', () => {
 it('opens recommendations even when the separate notes source fails', () => {
  const html = renderToStaticMarkup(createElement(StrategyView, { lane: 'ivan', setLane: () => {} }))
  expect(html).toContain('Recommendation shortlist')
  expect(html).toContain('Competitors')
  expect(html).toContain('Results')
  expect(html).toContain('Notes')
  expect(html).not.toContain('Notes unavailable')
 })
})
