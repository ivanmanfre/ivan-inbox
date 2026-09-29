// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen } from '@testing-library/react'
import { renderInFrame } from '../test-utils'
import type { IdeaBanks } from './Ideas'
import { fromCandidate } from './ideaModel'
import type { IdeaCandidate } from '../../lib/content'

vi.mock('../../hooks/useContent', () => ({ useIdeaCandidates: vi.fn(), useClientIdeas: vi.fn() }))
import { Ideas, filtered } from './Ideas'

const cand = (n: number, o: Partial<IdeaCandidate> = {}) => ({ id: `i${n}`, normalized_topic: `Idea ${n}`, raw_topic: null, composite_score: 100 - n, source: n % 2 ? 'manual' : 'ivan_call',
  icp_fit_score: null, virality_score: null, gap_score: null, beat_fit_score: null, signal_strength: null, why_score: null, post_angle: null, format_recommendation: null,
  ingested_at: null, content_type: 'post', ivan_engaged: null, source_ref: null, slack_permalink: null, scored_at: null, status: 'reviewing', ...o } as unknown as IdeaCandidate)
const empty = { items: [], n: 0, loading: false, error: null, refresh: vi.fn(), scores: { ok: false, byRef: new Map(), validated: false }, facets: [], chip: { ok: false, weekStart: null, byRef: new Map(), slots: [] } }
afterEach(cleanup)

describe('ideas parity', () => {
  it('no 40 cap: pages of 40 until every idea is reachable; lead-magnet ideas are counted apart', () => {
    const items = Array.from({ length: 95 }, (_, i) => fromCandidate(cand(i)))
    const banks = { ivan: { ...empty, items, n: 95, lm: 7 }, risedtc: empty, arch: empty } as unknown as IdeaBanks
    renderInFrame(<Ideas banks={banks} phone={false} />)
    expect(screen.getByText('40 of 95 shown')).toBeTruthy()
    expect(screen.getByText(/7 lead-magnet ideas decide in/)).toBeTruthy()
    fireEvent.click(screen.getByText('Show 40 more of 55'))
    fireEvent.click(screen.getByText('Show 15 more of 15'))
    expect(screen.getByText('95 of 95 shown')).toBeTruthy()
  })
  it('filters narrow a channel through today’s facet specs', () => {
    const items = [fromCandidate(cand(1)), fromCandidate(cand(2))]
    expect(filtered(items, 'ivan', { source: 'manual' }).map(i => i.id)).toEqual(['i1'])
  })
  it('the open idea shows its outlier score, source and Slack links', () => {
    const it0 = fromCandidate(cand(1, { source_ref: 'https://x.test/a', slack_permalink: 'https://slack.test/p' }))
    const scores = { ok: true, validated: false, byRef: new Map([['i1', { idea_table: 'lm_idea_candidates', idea_ref: 'i1', model_version: null, stage: 'idea', score: 0.82, validated: false, contributions: [], recommended_format: null, scored_at: null }]]) }
    const banks = { ivan: { ...empty, items: [it0], n: 1, scores }, risedtc: empty, arch: empty } as unknown as IdeaBanks
    renderInFrame(<Ideas banks={banks} phone={false} />)
    expect(screen.getAllByText(/Outlier 0.82 \(unvalidated\)/).length).toBeGreaterThan(0)
    expect(document.querySelector('[data-verb="source"]')!.getAttribute('href')).toBe('https://x.test/a')
    expect(document.querySelector('[data-verb="slack"]')).toBeTruthy()
  })
  it('desktop shows one lane at a time, with whole titles, score ranges and tags', () => {
    const ivanItems = [fromCandidate(cand(1)), fromCandidate(cand(40, { composite_score: null }))]
    const scores = { ok: true, validated: false, byRef: new Map([['i1', { idea_table: 'lm_idea_candidates', idea_ref: 'i1', model_version: null, stage: 'idea', score: 2.03, validated: false, contributions: [], recommended_format: 'single_image', scored_at: null }]]) }
    const rise = [fromCandidate(cand(7, { normalized_topic: 'Rise idea' }))].map(i => ({ ...i, lane: 'risedtc' as const }))
    const banks = { ivan: { ...empty, items: ivanItems, n: 2, scores }, risedtc: { ...empty, items: rise, n: 1 }, arch: empty } as unknown as IdeaBanks
    renderInFrame(<Ideas banks={banks} phone={false} />)
    expect(screen.queryByText('Rise idea')).toBeNull()
    const r1 = document.querySelector('.cn-iq[data-idea-id="i1"]')!
    expect(r1.querySelector('.cn-pill.cn-t-top')!.textContent).toBe('99')
    expect(r1.querySelector('.cn-tag.cn-ot.cn-t-top.cn-unv')!.textContent).toBe('Outlier 2.03')
    expect(r1.querySelector('.cn-tag.cn-h-grey')!.textContent).toBe('Manual')
    expect(document.querySelector('.cn-iq[data-idea-id="i40"] .cn-pill.cn-t-none')!.textContent).toBe('–')
    fireEvent.click(document.querySelector('[data-verb="lane"][data-lane="risedtc"]')!)
    expect(screen.getAllByText('Rise idea').length).toBeGreaterThan(0)
    expect(document.querySelector('.cn-iq[data-idea-id="i1"]')).toBeNull()
  })
})
