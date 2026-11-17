// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { Schedule } from './Schedule'
import { packIndex, readFortnight, nextCall } from '../model'
import type { WeekEvent, SalesPack, PackKind } from '../../../lib/salesPacks'
afterEach(cleanup)
const now = new Date('2026-10-07T09:00:00Z')
const event: WeekEvent = { id: 'e', title: 'Sebastian', start_time: '2026-10-07T09:30:00Z', end_time: '2026-10-07T10:00:00Z', attendees: ['s@example.com'], meeting_url: 'https://meet.google.com/a', is_all_day: false, is_test: false, meeting_type: null, source: null, referral_token: null, booking_source_path: null }
const row = (kind: PackKind): SalesPack => ({ id: kind, prospect_slug: 'sebastian-studio-nordost', kind, title: 'x', mime: 'text/html', source_path: null, source_mtime: null, call_at: event.start_time, meta: { name: 'Sebastian' }, updated_at: event.start_time })
function draw(kinds: PackKind[]) {
  const idx = packIndex(kinds.map(row))
  const f = readFortnight([event], idx, [], now)
  render(<Schedule f={f} shown={f} now={now} next={nextCall(f)} idx={idx} packs={1} tools={null} filtered="" clear={() => {}} report={() => {}} packsFailed={false} />)
}
it('a next call whose pack has a deck shows an Open deck link to the deck document', () => {
  draw(['card', 'deck'])
  const a = screen.getByRole('link', { name: 'Open deck' })
  expect(a.getAttribute('href')).toBe('#doc?slug=sebastian-studio-nordost&doc=deck')
  expect(a.getAttribute('target')).toBe('_blank')
})
it('a next call with no deck shows no Open deck link and no greyed deck chip', () => {
  draw(['card'])
  expect(screen.queryByRole('link', { name: 'Open deck' })).toBeNull()
  expect(document.querySelector('[data-doc-missing=deck]')).toBeNull()
})
