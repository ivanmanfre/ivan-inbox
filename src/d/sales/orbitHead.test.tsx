// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defaultFilters, type OrbitFilters } from '../../orbit/filters'
import type { OrbitHeadProps } from '../../orbit/Orbit'
import { renderInFrame } from '../test-utils'
import { filterWords, laneWords, OrbitHead, rangeWords } from './OrbitHead'

// Orbit's head in D: an answer row with the four numbers and "read HH:MM" in
// words, and ONE mono filter line (tenant · range · filter · lane) with the
// current key marked. No chip rows, no dot.

afterEach(() => { cleanup(); document.body.innerHTML = '' })

const lanes = [
  { id: 'c1', name: 'Agency Owners & Founders', lane: 'warm', active: true, n: 113 },
  { id: 'c2', name: 'Cold v2 — Influencer', lane: 'cold', active: false, n: 0 },
] as unknown as OrbitHeadProps['laneChips']

function props(p: Partial<OrbitHeadProps> = {}, f: Partial<OrbitFilters> = {}): OrbitHeadProps {
  return {
    filters: { ...defaultFilters('arch'), ...f }, setFilters: vi.fn(), setTenant: vi.fn(), setPreset: vi.fn(),
    custom: { open: false, from: '', to: '', setFrom: vi.fn(), setTo: vi.fn(), apply: vi.fn(), cancel: vi.fn() },
    laneChips: lanes, toggleLane: vi.fn(), nrCounts: { icpUnasked: 1, judgedOut: 94, unjudged: 3 },
    stats: { people: 1151, reached: 300, replied: 48, booked: 5 } as OrbitHeadProps['stats'],
    loading: false, error: null, loadedAt: '2026-09-27T14:55:00Z', refresh: vi.fn(), retry: vi.fn(), hasGraph: true, ...p,
  }
}

describe('Orbit head words', () => {
  it('names range, filters and lanes in words', () => {
    expect(rangeWords({ ...defaultFilters(), preset: '7d' })).toBe('7 days')
    expect(rangeWords({ ...defaultFilters(), preset: 'custom', from: '2026-09-01', to: '2026-09-10' })).toBe('2026-09-01 to 2026-09-10')
    expect(filterWords(defaultFilters())).toBe('none')
    expect(filterWords({ ...defaultFilters(), movedFirst: true, icpMin: 7 })).toBe('moved first, ICP 7+')
    expect(filterWords({ ...defaultFilters(), movedFirst: true, icpMin: 7, contentOnly: true })).toBe('3 on')
    expect(laneWords({ filters: defaultFilters(), laneChips: lanes })).toBe('all')
    expect(laneWords({ filters: { ...defaultFilters(), lanes: new Set(['c1']) }, laneChips: lanes })).toBe('Agency Owners &')
  })
})

describe('OrbitHead', () => {
  it('answer row: "Orbit · Arch · 30 days" and one summary line with the read time in words', () => {
    renderInFrame(<OrbitHead {...props()} />, { layout: 'phone' })
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Orbit · Arch · 30 days')
    expect(screen.getByText(/^1,151 people, 300 reached, 48 replied, 5 booked · read \d\d:\d\d$/)).toBeTruthy()
  })
  it('one filter line, current keys marked, no chip rows and no dot', () => {
    renderInFrame(<OrbitHead {...props()} />, { layout: 'phone' })
    expect(document.querySelectorAll('.ob-line')).toHaveLength(1)
    expect(document.querySelector('.a-orbit-filterrow, .a-orbit-lanerow, .ds-chip, [class*="LiveDot"], .ds-livedot')).toBeNull()
    const on = [...document.querySelectorAll('.ob-line [aria-pressed="true"]')].map(b => b.textContent)
    expect(on).toEqual(['Arch', '30d'])
  })
  it('tenant and range pick in place; filter and lane open a sheet', () => {
    const p = props()
    renderInFrame(<OrbitHead {...p} />, { layout: 'phone' })
    fireEvent.click(screen.getByText('Rise'))
    expect(p.setTenant).toHaveBeenCalledWith('risedtc')
    fireEvent.click(screen.getByText('90d'))
    expect(p.setPreset).toHaveBeenCalledWith('90d')
    fireEvent.click(document.querySelector('[data-verb="orbit-lane"]')!)
    fireEvent.click(screen.getByText('Agency Owners & Founders'))
    expect(p.toggleLane).toHaveBeenCalledWith('c1')
    fireEvent.click(screen.getByText('Done'))
    fireEvent.click(document.querySelector('[data-verb="orbit-filter"]')!)
    expect(screen.getByText('94')).toBeTruthy()
  })
  it('says reading and failure in words, and never shows a zero without a graph', () => {
    renderInFrame(<OrbitHead {...props({ loading: true })} />, { layout: 'phone' })
    expect(screen.getByText(/· reading…$/)).toBeTruthy()
    cleanup()
    const zeros = { people: 0, reached: 0, replied: 0, booked: 0 } as OrbitHeadProps['stats']
    renderInFrame(<OrbitHead {...props({ loading: true, hasGraph: false, loadedAt: null, stats: zeros })} />, { layout: 'phone' })
    expect(screen.getByText('Reading the graph…')).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/0 people/)
    cleanup()
    const p = props({ error: 'signal_graph 500', hasGraph: false, loadedAt: null, stats: zeros })
    renderInFrame(<OrbitHead {...p} />, { layout: 'phone' })
    expect(screen.getByText('The graph could not be read. No number is shown until it is.')).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/\b0 (people|reached|replied|booked)/)
    fireEvent.click(document.querySelector('[data-verb="retry"]')!)
    expect(p.retry).toHaveBeenCalled()
  })
})
