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

// ---------------------------------------------------------------------------
// 2026-08-09 — the incident batch.
//
// Ivan's post that morning went out with copy he had not written and no image,
// and the board could not tell him what time any of it happened. The publisher
// half is fixed in n8n; this half is the surface: the clock is on the chip, it
// reads the REAL posted time once a post is out, and a movable chip can be
// dragged.
// ---------------------------------------------------------------------------
describe('the time of posting', () => {
  it('🔴 IS ON THE CHIP — it was display:none above 767px and lived only in a tooltip', () => {
    const out = html([d({ title: 'Timed', scheduled_at: inDays(1, 8) })])
    expect(out).toContain('cal-chip-hh')
    expect(out).toContain('08:30')
  })

  it('🔴 a published chip reads published_at, NOT the slot it was queued for', () => {
    const out = html([d({
      title: 'Went out', status: 'published', source_post_id: 'urn:li:activity:1',
      scheduled_at: inDays(-1, 8), published_at: inDays(-1, 9),
    })])
    // The VISIBLE clock is the posted one. The slot survives in the tooltip
    // only, which is the next assertion's subject.
    expect(out).toContain('<span class="cal-chip-hh">09:30</span>')
    expect(out).not.toContain('<span class="cal-chip-hh">08:30</span>')
    expect(out).toContain('cal-chip-out')          // the published tick
    expect(out).toContain('title="Posted 09:30')   // spelled out where it has room
  })

  it('and says so in the tooltip when the two disagree', () => {
    const out = html([d({
      title: 'Late', status: 'published', source_post_id: 'urn:li:activity:1',
      scheduled_at: inDays(-1, 8), published_at: inDays(-1, 9),
    })])
    expect(out).toContain('was set for 08:30')
  })

  it('falls back to the slot on a published row with no published_at (legacy rows)', () => {
    const out = html([d({
      title: 'Old', status: 'published', source_post_id: 'urn:li:activity:1',
      scheduled_at: inDays(-1, 8), published_at: null,
    })])
    expect(out).toContain('<span class="cal-chip-hh">08:30</span>')
    expect(out).not.toContain('cal-chip-out')
  })
})

describe('drag to another day', () => {
  it('a movable chip is draggable', () => {
    const out = html([d({ title: 'Draggable' })])
    expect(out).toContain('draggable="true"')
  })

  it('🔴 a locked chip is NOT — drag must not offer a write the RPC refuses', () => {
    const out = html([d({ title: 'Gone out', status: 'published', source_post_id: 'urn:li:activity:1' })])
    expect(out).not.toContain('draggable="true"')
  })

  it('keeps the ⇄ button beside it — HTML5 drag does not exist on touch', () => {
    const out = html([d({ title: 'Both ways' })])
    expect(out).toContain('draggable="true"')
    expect(out).toContain('aria-label="Move Both ways to another day"')
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
