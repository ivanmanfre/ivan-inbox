// @vitest-environment jsdom
// Sales parity 09-27: the call window's dropped reads, the plate's type/source/more-this-week,
// greyed unpublished docs, compare on rows, filter tokens, phone "show them", phone j / k.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent } from '@testing-library/react'
import type { SalesPack, WeekEvent } from '../../lib/salesPacks'
import type { CallRow } from '../../lib/transcripts'
import { renderInFrame } from '../test-utils'
import { CallsOnRecord } from './Calls'
import { CallWindow } from './CallWindow'
import { filterFortnight, tokenLine } from './Filter'
import { FortnightList } from './Fortnight'
import { moreThisWeek, nextCall, packIndex, readFortnight } from './model'
import { NextCallPlate } from './NextCall'

const NOW = new Date('2026-09-18T10:00:00Z')
const ev = (id: string, start: string, extra: Partial<WeekEvent> = {}): WeekEvent => ({
  id, title: 'Discovery call with Leighton', start_time: start, end_time: null, attendees: ['im@ivanmanfredi.com', 'leighton@leadingsocial.com', 'ops@leadingsocial.com', 'cfo@leadingsocial.com'],
  meeting_url: 'https://meet.google.com/x', is_all_day: false, is_test: false, meeting_type: null, source: 'calendly',
  referral_token: null, booking_source_path: null, ...extra,
})
const pack = (kind: SalesPack['kind']): SalesPack => ({
  id: kind, prospect_slug: 'leighton-leadingsocial', kind, title: kind, mime: 'text/html', source_path: null, source_mtime: null,
  call_at: null, meta: { name: 'Leighton Penrose', company: 'Leading Social' }, updated_at: '2026-09-10T00:00:00Z',
})
const idx = packIndex([pack('card')])
const call = (id: string, extra: Partial<CallRow> = {}): CallRow => ({
  id, title: `Call ${id}`, date: '2026-09-15T12:00:00Z', duration_minutes: 30, participants: ['A One', 'B Two', 'C Three', 'D Four'], summary: 'S',
  action_items: null, topics: null, follow_up_draft: null, follow_up_sent: false, source: null, meeting_type: null, brief: null, ...extra,
})

afterEach(cleanup)

describe('Next-call plate', () => {
  it('names the type, "via Calendly", every attendee, the end time and the calls left this week', () => {
    const f = readFortnight([ev('a', '2026-09-18T13:00:00Z'), ev('b', '2026-09-18T16:00:00Z', { title: 'Other' })], idx, [], NOW)
    const n = nextCall(f)!
    renderInFrame(<NextCallPlate r={n} through="Sun 27 Sep" from="Mon 14 Sep" more={moreThisWeek(f, n)} />, { hash: '#exp/d/sales' })
    const facts = document.querySelector('[data-next-facts]')!.textContent!
    expect(facts).toContain('Discovery · via Calendly · Google Meet')
    expect(facts).toContain('with leighton@leadingsocial.com, ops@leadingsocial.com, cfo@leadingsocial.com')
    expect(facts).toContain('1 more call this week')
    expect(document.querySelector('.sl-nxl')!.textContent).toContain('until 16:00 Warsaw')
    // Unpublished docs are greyed, not left out.
    expect(document.querySelector('[data-doc="card"]')).toBeTruthy()
    expect([...document.querySelectorAll('[data-doc-missing]')].map(x => x.getAttribute('data-doc-missing'))).toEqual(['call_sheet', 'audience_audit', 'asset_ideas', 'prospect'])
  })
})

describe('Fortnight', () => {
  it('a row carries compare; the filter narrows with today\'s tokens and says so', () => {
    const f = readFortnight([ev('a', '2026-09-18T13:00:00Z'), ev('b', '2026-09-21T13:00:00Z', { title: 'Unknown person', attendees: [] })], idx, [], NOW)
    const tokens = [{ id: '1', field: 'pack', op: 'has no' as const, value: '' }]
    const shown = filterFortnight(f, tokens)
    const onClear = vi.fn()
    renderInFrame(<FortnightList f={shown} from={new Date('2026-09-14T00:00:00Z')} onReport={() => {}} packs={1} filtered={tokenLine(tokens)} onClear={onClear} />, { hash: '#exp/d/sales' })
    expect(document.querySelectorAll('[data-cal-id]')).toHaveLength(1)
    expect(document.querySelector('[data-cal-id="b"]')).toBeTruthy()
    expect(document.querySelector('[data-filter-line]')!.textContent).toContain('pack has no')
    expect(document.querySelector('.sl-cnt')!.textContent).toContain('1 call · 1 pack')
    fireEvent.click(document.querySelector('[data-filter-line] [data-verb="filter-clear"]')!)
    expect(onClear).toHaveBeenCalled()
    cleanup()
    renderInFrame(<FortnightList f={f} from={new Date('2026-09-14T00:00:00Z')} onReport={() => {}} />, { hash: '#exp/d/sales' })
    expect(document.querySelector('[data-cal-id="a"] a[data-doc="compare"]')).toBeTruthy()
  })
})

describe('Call window', () => {
  it('carries the proposal hook, the content pulled out, the read of the room, Kind, the year and every name', () => {
    const row = call('c1', {
      meeting_type: 'discovery_sales', topics: [{ title: 'Why audits beat ads', format: 'carousel' }] as unknown as CallRow['topics'],
      action_items: ['{"action":"Send the deck","owner":"Ivan"}'],
      brief: { proposal_hook: 'Open with the 3 lost deals', fit_score: 4, decision_maker: 'Yes, the CEO', pain: ['No pipeline'], stack: ['HubSpot'], triggers: ['New CMO'] },
    })
    renderInFrame(<CallWindow row={row} at={1} of={1} onStep={() => {}} layout="phone" />, { hash: '#exp/d/sales' })
    const t = document.body.textContent!
    for (const s of ['The hook to open a proposal with', 'Open with the 3 lost deals', 'Content pulled out of this call (1)', 'Why audits beat ads', 'Read of the room',
      'Fit', '4 out of 5', 'What hurts', 'No pipeline', 'What they run on', 'What set this off', 'Kind', '2026', 'D Four', '1 still open', 'Reading only.']) expect(t).toContain(s)
  })
  it('an unknown call id says it did not load, and j / k step on the phone too', () => {
    const step = vi.fn()
    renderInFrame(<CallWindow row={null} at={0} of={3} onStep={step} layout="phone" missing />, { hash: '#exp/d/sales' })
    expect(document.querySelector('[data-call-missing]')!.textContent).toContain("This call didn't load")
    cleanup()
    renderInFrame(<CallWindow row={call('c2')} at={1} of={3} onStep={step} layout="phone" />, { hash: '#exp/d/sales' })
    fireEvent.keyDown(window, { key: 'j' })
    expect(step).toHaveBeenCalledWith(1)
  })
})

describe('Calls on record, phone', () => {
  it('past six, "show them" opens the rest', () => {
    const calls = Array.from({ length: 9 }, (_, i) => call(`r${i}`))
    renderInFrame(<CallsOnRecord calls={calls} state="ok" seg="all" setSeg={() => {}} openId={null} onOpen={() => {}} onRetry={() => {}} limit={6} />, { hash: '#exp/d/sales', layout: 'phone' })
    expect(document.querySelectorAll('[data-call]')).toHaveLength(6)
    fireEvent.click(document.querySelector('[data-verb="show-more"]')!)
    expect(document.querySelectorAll('[data-call]')).toHaveLength(9)
  })
})
