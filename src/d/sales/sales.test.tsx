// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent } from '@testing-library/react'
import type { SalesPack, WeekEvent } from '../../lib/salesPacks'
import type { CallRow } from '../../lib/transcripts'
import { renderInFrame } from '../test-utils'
import { CallWindow } from './CallWindow'
import { nextCall, packIndex, readFortnight } from './model'
import { NextCallPlate } from './NextCall'

const NOW = new Date('2026-09-18T14:40:00Z') // Fri, 16:40 Warsaw
const ev = (id: string, start: string, end: string | null, extra: Partial<WeekEvent> = {}): WeekEvent => ({
  id, title: 'Call', start_time: start, end_time: end, attendees: ['im@ivanmanfredi.com', 'leighton@leadingsocial.com'],
  meeting_url: 'https://meet.google.com/x', is_all_day: false, is_test: false, meeting_type: null, source: null,
  referral_token: null, booking_source_path: null, ...extra,
})
const pack = (kind: SalesPack['kind']): SalesPack => ({
  id: kind, prospect_slug: 'leighton-leadingsocial', kind, title: kind, mime: 'text/html', source_path: null, source_mtime: null,
  call_at: null, meta: { name: 'Leighton Penrose', company: 'Leading Social' }, updated_at: '2026-09-10T00:00:00Z',
})
const idx = packIndex([pack('card'), pack('call_sheet')])

afterEach(cleanup)

describe('Sales model', () => {
  it('a running call stays live until its end, with both clocks', () => {
    const f = readFortnight([ev('a', '2026-09-18T14:30:00Z', '2026-09-18T15:30:00Z')], idx, [], NOW)
    const n = nextCall(f)!
    expect(n).toMatchObject({ phase: 'running', live: true, name: 'Leighton Penrose', warsaw: '16:30', utc: '14:30', endWarsaw: '17:30', endUtc: '15:30' })
  })
  it('Join lights an hour before, not earlier; a finished call loses it', () => {
    const soon = readFortnight([ev('b', '2026-09-18T15:20:00Z', null)], idx, [], NOW)
    const later = readFortnight([ev('c', '2026-09-18T16:00:00Z', null)], idx, [], NOW)
    const done = readFortnight([ev('d', '2026-09-18T12:00:00Z', '2026-09-18T13:00:00Z')], idx, [], NOW)
    expect(nextCall(soon)!.live).toBe(true)
    expect(nextCall(later)!.live).toBe(false)
    expect(done.today[0]).toMatchObject({ past: true, live: false, rel: 'done' })
    expect(nextCall(done)).toBeNull()
  })
})

describe('Sales parts', () => {
  it('the plate draws pack links as new tabs on the #doc page, compare on the note line', () => {
    const n = nextCall(readFortnight([ev('a', '2026-09-18T14:30:00Z', '2026-09-18T15:30:00Z')], idx, [], NOW))!
    renderInFrame(<NextCallPlate r={n} through="Sun 27 Sep" from="Mon 14 Sep" />, { hash: '#exp/d/sales' })
    const docs = [...document.querySelectorAll('a[data-doc]')].map(a => [a.getAttribute('data-doc'), a.getAttribute('href'), a.getAttribute('target')])
    expect(docs).toEqual([
      ['card', '#doc?slug=leighton-leadingsocial&doc=card', '_blank'],
      ['call_sheet', '#doc?slug=leighton-leadingsocial&doc=call_sheet', '_blank'],
      ['compare', '#doc?slug=leighton-leadingsocial&doc=compare', '_blank'],
    ])
    const join = document.querySelector('[data-verb="join"]')!
    expect(join.getAttribute('target')).toBe('_blank')
    expect(join.textContent).toContain('live until 17:30')
  })
  it('the call window shows the whole follow-up draft and steps with j / k', () => {
    const long = 'x '.repeat(600) + 'the end.'
    const row: CallRow = { id: 'c1', title: 'Meet', date: '2026-09-22T17:00:00Z', duration_minutes: 36, participants: [], summary: 'S',
      action_items: ['{"action":"Do it","owner":"Ivan"}'], topics: null, follow_up_draft: long, follow_up_sent: false, source: null, meeting_type: null, brief: null }
    const step = vi.fn()
    renderInFrame(<CallWindow row={row} at={2} of={5} onStep={step} layout="desktop" />, { hash: '#exp/d/sales' })
    expect(document.body.textContent).toContain('the end.')
    expect(document.body.textContent).toContain('You said you would')
    fireEvent.keyDown(window, { key: 'j' })
    fireEvent.keyDown(window, { key: 'k' })
    expect(step.mock.calls).toEqual([[1], [-1]])
  })
})
