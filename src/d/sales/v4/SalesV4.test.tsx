// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import type { CallRow } from '../../../lib/transcripts'

const now = new Date('2026-11-17T10:00:00Z')
const mk = (id: string, ivanPct: number | null): CallRow => ({
  id, title: 'Meet', date: '2026-11-10T13:00:00Z', duration_minutes: 30, participants: ['Ivan Manfredi', 'Ada'],
  talk_stats: ivanPct == null ? null : { words: { 'Ivan Manfredi': 10, Ada: 5 }, total: 15, ivan_pct: ivanPct },
  summary: 'S', action_items: null, topics: null, follow_up_draft: null, follow_up_sent: false,
  source: 'ivan-listener', meeting_type: null, brief: null,
})
const calls = [mk('a', 70), mk('b', null)]
vi.mock('../useSalesData', () => ({
  useSalesData: () => ({
    now, week: { from: '2026-11-16', to: '2026-11-22' }, events: [], packs: [], calls,
    state: { events: 'ok', packs: 'ok', calls: 'ok' }, saved: {}, eventsError: '', retry: () => {},
  }),
}))
import SalesPage from './SalesV4'

afterEach(cleanup)
const route = (q = '') => ({ place: 'sales', sub: null, query: new URLSearchParams(q) }) as never

it('opens on the Mine segment; the row shows a talk line only when the share is known', () => {
  render(<SalesPage layout="desktop" route={route()} navigate={() => {}} />)
  expect(document.querySelector('.sl4-segments [aria-selected="true"]')?.textContent).toContain('Mine')
  const rows = document.querySelectorAll('[data-call]')
  expect(rows.length).toBe(2)
  const talk = document.querySelectorAll('.sl4-cr [data-talk]')
  expect(talk).toHaveLength(1)
  expect(talk[0].textContent).toBe('You 70% of the talking')
})

it('the phone back bar names the default segment honestly', () => {
  render(<SalesPage layout="phone" route={route('call=a')} navigate={() => {}} />)
  expect(document.querySelector('.sl-back')?.textContent).toContain('your calls, last 60 days')
})
