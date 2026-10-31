// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { PostPerformance } from './PostPerformance'
import type { PostAudienceRow } from '../../lib/reach'

afterEach(cleanup)
const NOW = Date.parse('2026-10-31T12:00:00Z')
const row = (id: string, at: string, impressions: number): PostAudienceRow => ({ activity_id: id, post_url: `https://www.linkedin.com/feed/update/urn:li:activity:${id}`, published_at: at, title: `Hook ${id}`, impressions, in_pct: null, out_pct: null, members_reached: null, demographics: null, captured_at: null, source: 'tracker', reactions: 5, comments: 1, shares: 0 })

it('shows the stats, best day and time, and every post ranked with its number against the typical post', () => {
  const rows = [row('1', '2026-10-06T07:30:00Z', 300), row('2', '2026-10-13T07:30:00Z', 400), row('3', '2026-10-20T07:30:00Z', 500), row('4', '2026-10-30T07:30:00Z', 40), row('5', '2026-07-01T07:30:00Z', 100)]
  render(<PostPerformance lane="ivan" read={{ kind: 'ready', rows, followers: null, readAt: '' }} onRetry={() => {}} now={NOW} />)
  expect(screen.getByText('Typical post')).toBeTruthy()
  expect(screen.getByText('Typical impressions by time (Warsaw)')).toBeTruthy()
  const titles = [...document.querySelectorAll('.cn-perf-title')].map(e => e.textContent)
  expect(titles).toEqual(['Hook 3', 'Hook 2', 'Hook 1', 'Hook 4'])
  expect(screen.getByText('still counting')).toBeTruthy()
  expect(screen.getByText(/1 post is under 3 days old/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'All time' }))
  expect(document.querySelectorAll('.cn-perf-title')).toHaveLength(5)
  fireEvent.click(screen.getByRole('button', { name: 'Newest' }))
  expect(document.querySelector('.cn-perf-title')?.textContent).toBe('Hook 4')
})

it('says SwishDM posts are not tracked instead of failing', () => {
  render(<PostPerformance lane="swishdm" read={null} onRetry={() => {}} now={NOW} />)
  expect(screen.getByText(/posts are not tracked yet/)).toBeTruthy()
})
