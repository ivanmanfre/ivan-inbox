// @vitest-environment jsdom
// content-brain-06 C04: the phone mounts the lazy StrategyView AFTER Shell has
// stripped `?lane=&section=` from the hash. The lane the link named must still
// win, delivered as `initialLane` from Shell's boot parse, not re-read from a
// hash that no longer carries it.
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
vi.mock('../../hooks/useStrategy', () => ({ useStrategy: () => ({ error: null, loading: false, dirty: false, sections: [], updatedAt: null, refresh: vi.fn() }) }))
vi.mock('../../hooks/usePullToRefresh', () => ({ usePullToRefresh: () => ({ pull: 0, refreshing: false, trigger: 70 }) }))
vi.mock('../../hooks/useLanes', async original => ({ ...await original<typeof import('../../hooks/useLanes')>(), useLanes: () => ({ lanes: [{ client_id: 'ivan', display_name: 'Ivan' }, { client_id: 'risedtc', display_name: 'RISE' }, { client_id: 'arch', display_name: 'ARCH' }], state: 'registry', message: null }) }))
vi.mock('../chrome/ConfirmSheet', () => ({ useConfirm: () => vi.fn() }))
vi.mock('./ProposalsBlock', () => ({ ProposalsBlock: () => null }))
vi.mock('./BenchmarkBlock', () => ({ BenchmarkBlock: () => null }))
vi.mock('./AudienceBlock', () => ({ AudienceBlock: () => null }))
vi.mock('./ThemesBlock', () => ({ ThemesBlock: () => null }))
vi.mock('./EditorialThisWeekPanel', () => ({ EditorialThisWeekPanel: () => null }))
vi.mock('./research/ResearchWorkspace', () => ({ ResearchPanel: () => createElement('div', { className: 'a-research-list' }), ThisWeekPanel: () => null }))
vi.mock('./EditorialResultsPanel', () => ({ EditorialResultsPanel: () => null }))
vi.mock('./ClientDirectionPanel', () => ({ ClientDirectionPanel: () => null }))
vi.mock('../../lib/supabase', () => ({ supabase: {} }))
import { StrategyView } from './strategy'

let root: Root, host: HTMLDivElement
beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove(); location.hash = '' })

it('restores the deep-linked lane from Shell\'s boot parse when the hash was already stripped', async () => {
  location.hash = '#exp/brain-b/strategy' // Shell's [job] effect has already run: no query left
  const setLane = vi.fn()
  await act(async () => { root.render(createElement(StrategyView, { lane: 'ivan', setLane, initialLane: 'risedtc', initialSection: 'research' })) })
  expect(setLane).toHaveBeenCalledWith('risedtc')
  expect(host.querySelector('.a-research-list')).not.toBeNull()
})

it('ignores an unregistered initialLane and keeps the booted lane', async () => {
  location.hash = '#exp/brain-b/strategy'
  const setLane = vi.fn()
  await act(async () => { root.render(createElement(StrategyView, { lane: 'ivan', setLane, initialLane: 'nope' })) })
  expect(setLane).not.toHaveBeenCalled()
})
