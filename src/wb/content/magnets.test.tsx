// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Resource } from '../../lib/styles'
import type { IdeaCandidate } from '../../lib/content'
import { MagnetsList } from './magnets'

const data = vi.hoisted(() => ({ resources: [] as Resource[], ideas: [] as IdeaCandidate[] }))
vi.mock('../../hooks/useContent', () => ({
  useResources: () => ({ rows: data.resources, loading: false, error: null, loadedAt: '2026-09-30T12:00:00Z', refresh() {} }),
  useIdeaCandidates: () => ({ split: { lead_magnet: data.ideas }, counts: { lead_magnet: data.ideas.length }, loading: false, error: null, loadedAt: '2026-09-30T12:00:00Z', refresh() {} }),
}))
vi.mock('../../hooks/useLanes', () => ({ useLanes: () => ({ state: 'registry', lanes: [
  { client_id: 'ivan', display_name: 'Ivan' }, { client_id: 'risedtc', display_name: 'RISE DTC' }, { client_id: 'arch', display_name: 'ARCH' },
] }) }))

const resource = (id = '12345678-aaaa-bbbb-cccc-000000000001', topic: string | null = 'Review guide'): Resource => ({
  id, topic, format: 'guide', status: 'review', resource_url: null,
  landing_url: 'https://example.test/guide', cover_url: null, landing_slug: null, updated_at: '2026-09-30T12:00:00Z',
})
const idea: IdeaCandidate = {
  id: 'bank-idea', source: null, raw_topic: 'Bank concept', normalized_topic: 'Bank concept',
  signal_strength: null, icp_fit_score: null, virality_score: null, gap_score: null, beat_fit_score: null, composite_score: null,
  why_score: null, format_recommendation: null, offer_ladder_map: null, content_type: 'lead_magnet', post_angle: null,
  ivan_engaged: null, source_ref: null, slack_permalink: null, ingested_at: null, scored_at: null,
  promoted_draft_id: null, promoted_draft_table: null, promoted_clickup_task_id: null,
}
beforeEach(() => {
  localStorage.clear(); data.resources = [resource()]; data.ideas = []
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('Lead-magnet stage context', () => {
  it('keeps the idea bank on the Idea stage and retains its review controls there', () => {
    data.ideas = [idea]
    render(<MagnetsList lane="ivan" setLane={() => {}} onOpen={() => {}} />)
    expect(screen.queryByText('Bank concept')).toBeNull()
    expect(screen.getByRole('button', { name: 'Review guide' })).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: 'Idea' }))
    fireEvent.click(screen.getByRole('button', { name: 'Bank concept' }))
    expect(screen.getByRole('button', { name: /Approve/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Reject/ })).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: /Needs review/ }))
    expect(screen.queryByText('Bank concept')).toBeNull()
  })

  it('retains Idea access when the resource pipeline has no rows', () => {
    data.resources = []
    data.ideas = [idea]
    render(<MagnetsList lane="ivan" setLane={() => {}} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Idea' }))
    expect(screen.getByText('Bank concept')).toBeTruthy()
  })

  it('gives titleless resources distinct stable labels when opening them', () => {
    data.resources = [resource('12345678-aaaa-bbbb-cccc-000000000001', null), resource('87654321-aaaa-bbbb-cccc-000000000002', '')]
    const open = vi.fn()
    render(<MagnetsList lane="ivan" setLane={() => {}} onOpen={open} />)
    const first = screen.getByRole('button', { name: /guide.*12345678/i })
    const second = screen.getByRole('button', { name: /guide.*87654321/i })
    expect(first.textContent).not.toBe(second.textContent)
    fireEvent.click(first)
    expect(open).toHaveBeenCalledWith('12345678-aaaa-bbbb-cccc-000000000001', first.textContent, data.resources)
  })

  it('restores the selected stage per client instead of carrying the previous client stage', () => {
    localStorage.setItem('wb-lm-tab-ivan', 'idea')
    localStorage.setItem('wb-lm-tab-risedtc', 'review')
    const view = render(<MagnetsList lane="ivan" setLane={() => {}} />)
    expect(screen.getByRole('tab', { name: 'Idea' }).getAttribute('aria-selected')).toBe('true')
    view.rerender(<MagnetsList lane="risedtc" setLane={() => {}} />)
    expect(screen.getByRole('tab', { name: /Needs review/ }).getAttribute('aria-selected')).toBe('true')
  })

  it('reveals the active tab by moving only the stage strip', async () => {
    const pageScroll = vi.fn()
    const intoView = vi.fn()
    vi.stubGlobal('scrollTo', pageScroll)
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => window.setTimeout(() => cb(0), 0))
    vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id))
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains('a-ct-tabsbar')) return { left: 0, right: 375, width: 375, top: 0, bottom: 44, height: 44, x: 0, y: 0, toJSON() {} }
      if (this.getAttribute('aria-selected') === 'true') {
        const left = 344 - (this.closest('.a-ct-tabsbar')?.scrollLeft ?? 0)
        return { left, right: left + 126, width: 126, top: 0, bottom: 44, height: 44, x: left, y: 0, toJSON() {} }
      }
      return { left: 0, right: 0, width: 0, top: 0, bottom: 0, height: 0, x: 0, y: 0, toJSON() {} }
    })
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: intoView })
    const { container } = render(<MagnetsList lane="ivan" setLane={() => {}} />)
    const strip = container.querySelector<HTMLElement>('.a-ct-tabsbar')!
    await waitFor(() => expect(strip.scrollLeft).toBeGreaterThanOrEqual(95))
    expect(screen.getByRole('tab', { name: /Needs review/ }).getBoundingClientRect().right).toBeLessThanOrEqual(375)
    expect(pageScroll).not.toHaveBeenCalled()
    expect(intoView).not.toHaveBeenCalled()
  })
})
