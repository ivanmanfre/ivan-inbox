// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { CallRow } from '../../../lib/transcripts'
import type { DRoute } from '../../route'

const now = new Date('2026-11-17T10:00:00Z')
const mk = (id: string, ivanPct: number | null): CallRow => ({
  id, title: 'Meet', date: '2026-11-10T13:00:00Z', duration_minutes: 30, participants: ['Ivan Manfredi', 'Ada'],
  talk_stats: ivanPct == null ? null : { words: { 'Ivan Manfredi': 10, Ada: 5 }, total: 15, ivan_pct: ivanPct },
  summary: 'S', action_items: null, topics: null, follow_up_draft: null, follow_up_sent: false,
  source: 'ivan-listener', meeting_type: null, brief: null,
})
const calls = [mk('a', 70), mk('b', null)]
vi.mock('../../../lib/supabase', () => ({
  supabase: {
    rpc: vi.fn(async () => ({ error: null, data: [
      { meeting_id: 'missed', name: 'Prospect A', starts_at: '2026-11-18T23:30:00Z', outcome: 'NO_SHOW', deal_status: null, prospect_id: null },
      { meeting_id: 'unknown', name: 'Prospect B', starts_at: '2026-11-17T11:00:00Z', outcome: null, deal_status: 'open', prospect_id: 'prospect-b' },
    ] })),
  },
}))
vi.mock('../../ui/AnswerRow', () => ({
  AnswerRow: ({ title, tools }: { title: ReactNode; tools: ReactNode }) => <><h1>{title}</h1>{tools}</>,
}))
vi.mock('../useSalesData', () => ({
  useSalesData: () => ({
    now, week: { from: '2026-11-16', to: '2026-11-22' }, events: [], packs: [], calls,
    state: { events: 'ok', packs: 'ok', calls: 'ok' }, saved: {}, eventsError: '', retry: () => {},
  }),
}))
import SalesPage from './SalesV4'

afterEach(cleanup)
const route = (q = '', sub: string | null = null): DRoute => ({ place: 'sales', sub, query: new URLSearchParams(q) })

it('opens on the Mine segment; the row shows a talk line only when the share is known', () => {
  render(<SalesPage layout="desktop" route={route()} navigate={() => {}} />)
  expect(document.querySelector('.sl4-segments [aria-selected="true"]')?.textContent).toContain('Mine')
  expect(screen.getByRole('link', { name: 'Call results' }).getAttribute('href')).toBe('#exp/d/sales/results')
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

it('shows a recorded no-show without a transcript and keeps missing outcomes unconfirmed', async () => {
  render(<SalesPage layout="phone" route={route('', 'results')} navigate={() => {}} />)
  expect(await screen.findByText('No-show')).toBeTruthy()
  expect(screen.getByText('2026-11-19')).toBeTruthy()
  expect(screen.getByText('Unconfirmed')).toBeTruthy()
  expect(screen.getByText('Follow-up open')).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Prospect B' }).getAttribute('href')).toBe('#exp/d/dms?seat=ivan&thread=prospect-b')
})
