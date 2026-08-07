import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ContentCalendar } from './ContentCalendar'
import type { ContentDraft } from '../../lib/content'

// WHICH CONTROLS GET DRAWN — asserted on the markup, not on a prop.
//
// 🔴 Nothing here can reach the database: renderToStaticMarkup runs no effects
// and fires no events, so this file cannot move a real row. It only answers the
// question the surface answers — does this chip offer a move — which is the half
// of the change that lives in the component rather than in canMoveDate.
//
// A row's own `scheduled_at` decides which month it lands in, so the fixtures
// are dated relative to today: the calendar opens on the current month.

const inDays = (n: number, h = 10) => {
  const d = new Date()
  d.setDate(d.getDate() + n)
  d.setHours(h, 30, 0, 0)
  return d.toISOString()
}

const d = (over: Partial<ContentDraft> = {}): ContentDraft => ({
  id: 'd1', client_id: null, status: 'scheduled', type: 'text',
  title: 'A post', topic: null, post_body: 'body',
  scheduled_at: inDays(1), source_post_id: null, image_urls: null,
  taxonomy: {}, updated_at: inDays(-30), created_at: inDays(-30),
  ...over,
})

const html = (rows: ContentDraft[]) => renderToStaticMarkup(
  <ContentCalendar rows={rows} onOpen={() => {}} refresh={() => {}} />,
)

describe('the move control', () => {
  it('🔴 IVAN’S OWN CHIP CARRIES ONE — the date RPC accepts client_id IS NULL', () => {
    const out = html([d({ title: 'My own post', client_id: null })])
    expect(out).toContain('My own post')
    expect(out).toContain('aria-label="Move My own post to another day"')
  })

  it('a client chip carries the same one — same control, same lane-free rule', () => {
    const out = html([d({ id: 'c', title: 'Mattan post', client_id: 'risedtc', status: 'review' })])
    expect(out).toContain('aria-label="Move Mattan post to another day"')
  })

  it('a published chip carries none, and is drawn locked instead', () => {
    const out = html([d({ title: 'Gone out', status: 'published', source_post_id: 'urn:li:activity:1' })])
    expect(out).toContain('Gone out')
    expect(out).not.toContain('aria-label="Move Gone out to another day"')
    expect(out).toContain('cal-chip-lock')
  })
})

describe('what the surface no longer says', () => {
  it('🔴 the Ivan-lane “not editable here” notice is GONE — it named a rule that no longer exists', () => {
    const out = html([d({ client_id: null })])
    expect(out).not.toContain('not editable here')
    expect(out).not.toContain('not_a_client_draft')
  })

  it('the move panel’s side-effect warning is gone with it — this write has none', () => {
    const out = html([d({ client_id: null })])
    expect(out).not.toContain('marks it scheduled')
    expect(out).not.toContain('board')
  })
})

describe('Ready, no date', () => {
  it('is the same rail on either lane — approved and undated, whoever owns it', () => {
    const rows = [
      d({ id: 'a', title: 'Mine, no date', status: 'approved', scheduled_at: null }),
      d({ id: 'b', title: 'His, no date', status: 'approved', scheduled_at: null, client_id: 'risedtc' }),
    ]
    const out = html(rows)
    expect(out).toContain('Mine, no date')
    expect(out).toContain('His, no date')
  })

  it('🔴 says WHY an approved row has no button rather than just omitting it', () => {
    // db/032 takes `review`/`scheduled` only, so `approved` answers bad_status.
    const out = html([d({ status: 'approved', scheduled_at: null })])
    expect(out).not.toContain('class="cal-mv"')   // no button
    expect(out).toContain('bad_status')           // but the reason is on screen
  })

  it('and says nothing at all when the rail is empty', () => {
    const out = html([d()])
    expect(out).toContain('Nothing approved is sitting without a date.')
    expect(out).not.toContain('bad_status')
  })
})
