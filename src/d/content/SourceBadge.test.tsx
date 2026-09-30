// @vitest-environment jsdom
//
// CB-22 offline evidence: no live idea currently carries an outlier
// source_ref, so a live-DOM check of the "Content brain · Outlier" badge has
// no positive case to click through. This proves — with fixture ideas shaped
// like the real rows (evidence[] for lm_idea_candidates, score_breakdown for
// client_ideas) — that outlierSource()/SourceBadge render correctly, both in
// isolation and inside the real Ideas list row + IdeaDetail pane, and that
// every other source_ref renders no badge at all.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { renderInFrame } from '../test-utils'
import type { IdeaBanks } from './Ideas'
import { fromCandidate, fromClient } from './ideaModel'
import type { IdeaCandidate } from '../../lib/content'
import type { ClientIdea } from '../../lib/clientIdeas'
import { outlierSource } from '../../lib/cb22'
import { SourceBadge } from './SourceBadge'

vi.mock('../../hooks/useContent', () => ({ useIdeaCandidates: vi.fn(), useClientIdeas: vi.fn() }))
import { Ideas } from './Ideas'

afterEach(cleanup)

const cand = (n: number, o: Partial<IdeaCandidate> = {}) => ({
  id: `i${n}`, normalized_topic: `Idea ${n}`, raw_topic: null, composite_score: 100 - n, source: 'manual',
  icp_fit_score: null, virality_score: null, gap_score: null, beat_fit_score: null, signal_strength: null,
  why_score: null, post_angle: null, format_recommendation: null, ingested_at: null, content_type: 'post',
  ivan_engaged: null, source_ref: null, slack_permalink: null, scored_at: null, status: 'reviewing', ...o,
} as unknown as IdeaCandidate)

const clientIdea = (n: number, o: Partial<ClientIdea> = {}): ClientIdea => ({
  id: `c${n}`, title: `Client idea ${n}`, hook: null, source_label: null, source_ref: null, pillar: null,
  format: null, status: 'reviewing', created_at: null, icp_score: null, funnel_stage: null, funnel_source: null,
  score_breakdown: null, reuse_of: null, eligible_at: null, ...o,
})

const empty = {
  items: [], n: 0, loading: false, error: null, refresh: vi.fn(),
  scores: { ok: false, byRef: new Map(), validated: false }, facets: [],
  chip: { ok: false, weekStart: null, byRef: new Map(), slots: [] },
}

describe('SourceBadge (CB-22), direct render from outlierSource()', () => {
  it('a "Use this" outlier ref (lm_idea_candidates shape: evidence[0].author/lift/url)', () => {
    const src = outlierSource('outlier:linkedin:111222333', {
      evidence: [{ author: 'Jane Doe', lift: 3.4, url: 'https://www.linkedin.com/feed/update/urn:li:activity:111222333/' }],
    })
    render(<SourceBadge src={src} />)
    const a = document.querySelector('a[data-source-badge="cb-outlier"]')!
    expect(a).toBeTruthy()
    expect(a.getAttribute('data-badge-platform')).toBe('linkedin')
    expect(a.getAttribute('data-badge-author')).toBe('Jane Doe')
    expect(Number(a.getAttribute('data-badge-lift'))).toBeCloseTo(3.4)
    expect(a.textContent).toContain('Content brain · Outlier')
    const href = a.getAttribute('href')!
    expect(href).toMatch(/linkedin\.com/)
    expect(href).toContain('111222333')
  })

  it('a weekly-promoted ref (cb22:x:<id>), no url in evidence: falls back to the built post url', () => {
    const src = outlierSource('cb22:x:987654321', { evidence: [{ author: 'John Smith', lift: 1.8 }] })
    render(<SourceBadge src={src} />)
    const a = document.querySelector('a[data-source-badge="cb-outlier"]')!
    expect(a.getAttribute('data-badge-platform')).toBe('x')
    expect(a.getAttribute('data-badge-author')).toBe('John Smith')
    expect(Number(a.getAttribute('data-badge-lift'))).toBeCloseTo(1.8)
    expect(a.textContent).toContain('Content brain · Outlier')
    const href = a.getAttribute('href')!
    expect(href).toMatch(/x\.com/)
    expect(href).toContain('987654321')
  })

  it('a client_ideas-shaped outlier ref (score_breakdown.source_author/lift, no evidence)', () => {
    const src = outlierSource('outlier:x:555000111', { breakdown: { source_author: 'Mattan K.', lift: 2.1 } })
    render(<SourceBadge src={src} />)
    const a = document.querySelector('a[data-source-badge="cb-outlier"]')!
    expect(a.getAttribute('data-badge-platform')).toBe('x')
    expect(a.getAttribute('data-badge-author')).toBe('Mattan K.')
    expect(Number(a.getAttribute('data-badge-lift'))).toBeCloseTo(2.1)
    expect(a.textContent).toContain('Content brain · Outlier')
    const href = a.getAttribute('href')!
    expect(href).toMatch(/x\.com/)
    expect(href).toContain('555000111')
  })

  it('every non-outlier source_ref (calls:, ffc-, null) renders no badge', () => {
    for (const ref of ['calls:abc', 'ffc-123', null]) {
      const src = outlierSource(ref, {})
      expect(src).toBeNull()
      cleanup()
      render(<SourceBadge src={src} />)
      expect(document.querySelector('a[data-source-badge="cb-outlier"]')).toBeNull()
    }
  })
})

describe('SourceBadge inside the real Ideas list row + IdeaDetail pane (fixture ideas)', () => {
  it('an outlier idea gets the badge in its list row and its open detail pane; a plain idea in the same bank gets neither', () => {
    const outlierItem = fromCandidate(cand(1, {
      source_ref: 'outlier:linkedin:111222333',
      evidence: [{ author: 'Jane Doe', lift: 3.4, url: 'https://www.linkedin.com/feed/update/urn:li:activity:111222333/' }],
    }))
    const callsItem = fromCandidate(cand(2, { source_ref: 'calls:abc' }))
    const ffcItem = fromCandidate(cand(3, { source_ref: 'ffc-123' }))
    const nullRefItem = fromCandidate(cand(4, { source_ref: null }))
    const items = [outlierItem, callsItem, ffcItem, nullRefItem]
    const banks = { ivan: { ...empty, items, n: items.length }, risedtc: empty, arch: empty } as unknown as IdeaBanks
    renderInFrame(<Ideas banks={banks} phone={false} />)

    // List row: only the outlier idea's row carries the cn-cbrow badge wrapper.
    const outlierRow = document.querySelector('.cn-cbrow[data-idea-id="i1"]')
    expect(outlierRow).toBeTruthy()
    expect(outlierRow!.querySelector('a[data-source-badge="cb-outlier"]')).toBeTruthy()
    expect(document.querySelector('.cn-cbrow[data-idea-id="i2"]')).toBeNull()
    expect(document.querySelector('.cn-cbrow[data-idea-id="i3"]')).toBeNull()
    expect(document.querySelector('.cn-cbrow[data-idea-id="i4"]')).toBeNull()

    // Detail opens in one tap from the new best-five row.
    fireEvent.click(screen.getByText('Idea 1'))
    const detail1 = document.querySelector('[data-idea-detail="i1"]')!
    expect(detail1.querySelector('a[data-source-badge="cb-outlier"]')).toBeTruthy()

    // Select the plain (calls:) idea's row instead -> its detail pane carries no badge.
    fireEvent.click(screen.getByText('Idea 2'))
    const detail2 = document.querySelector('[data-idea-detail="i2"]')!
    expect(detail2.querySelector('a[data-source-badge="cb-outlier"]')).toBeNull()
  })

  it('a client_ideas outlier row (risedtc lane) also gets the badge in its list row', () => {
    const outlierClientItem = fromClient(
      clientIdea(1, { source_ref: 'outlier:x:555000111', score_breakdown: { source_author: 'Mattan K.', lift: 2.1 } }),
      'risedtc',
    )
    const banks = { ivan: empty, risedtc: { ...empty, items: [outlierClientItem], n: 1 }, arch: empty } as unknown as IdeaBanks
    renderInFrame(<Ideas banks={banks} phone={false} />)
    fireEvent.click(document.querySelector('[data-verb="lane"][data-lane="risedtc"]')!)
    const row = document.querySelector('.cn-cbrow[data-idea-id="c1"]')
    expect(row).toBeTruthy()
    const a = row!.querySelector('a[data-source-badge="cb-outlier"]')!
    expect(a.getAttribute('data-badge-platform')).toBe('x')
    expect(a.getAttribute('data-badge-author')).toBe('Mattan K.')
    expect(Number(a.getAttribute('data-badge-lift'))).toBeCloseTo(2.1)
    const href = a.getAttribute('href')!
    expect(href).toMatch(/x\.com/)
    expect(href).toContain('555000111')
  })
})
