import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ContentCalendar, VISIBLE_CHIPS, chipDescription } from './ContentCalendar'
import { buildCalendarItems } from '../../lib/calendarItems'
import { place } from './CalPopover'
import type { ContentDraft, ScheduledQueueRow } from '../../lib/content'

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

const q = (over: Partial<ScheduledQueueRow> = {}): ScheduledQueueRow => ({
  id: 'q1', clickup_task_id: null, post_text: 'A queued post nobody drafted.\n\nRest.',
  scheduled_at: inDays(2), posted_at: null, status: 'pending',
  platform: 'linkedin', is_repost: false, error_message: null,
  created_at: inDays(-3), post_kind: 'reach', unipile_share_url: null, post_format: 'text',
  ...over,
})

// The sentence one chip carries, built the same way the chip builds it.
const describe1 = (over: Partial<ContentDraft> = {}) => chipDescription(buildCalendarItems([d(over)])[0])

const html = (rows: ContentDraft[], queue: ScheduledQueueRow[] = []) => renderToStaticMarkup(
  <ContentCalendar rows={rows} queue={queue} onOpen={() => {}} refresh={() => {}} />,
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
    // Spelled out where it has room. That used to be a `title` attribute and is
    // a popover now, which renderToStaticMarkup cannot open because it fires no
    // events, so the sentence is asserted at its source instead of through the
    // markup. Same claim, one indirection fewer.
    expect(describe1({
      title: 'Went out', status: 'published', source_post_id: 'urn:li:activity:1',
      scheduled_at: inDays(-1, 8), published_at: inDays(-1, 9),
    })).toContain('Posted 09:30')
  })

  it('and says so in the popover when the two disagree', () => {
    expect(describe1({
      title: 'Late', status: 'published', source_post_id: 'urn:li:activity:1',
      scheduled_at: inDays(-1, 8), published_at: inDays(-1, 9),
    })).toContain('was set for 08:30')
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

describe('No date yet', () => {
  it('is the same rail on either lane: datable and undated, whoever owns it', () => {
    const rows = [
      d({ id: 'a', title: 'Mine, no date', status: 'review', scheduled_at: null }),
      d({ id: 'b', title: 'His, no date', status: 'review', scheduled_at: null, client_id: 'risedtc' }),
    ]
    const out = html(rows)
    expect(out).toContain('Mine, no date')
    expect(out).toContain('His, no date')
  })

  it('🔴 THE 89 UNDATED REVIEW DRAFTS REACH IT: the defect this rail shipped with', () => {
    // It filtered on `approved`, a status the date RPC refuses and the live
    // census puts at 0 rows on both lanes, so it rendered its empty line
    // forever while the rows the RPC accepts sat on another tab.
    const out = html([d({ id: 'r', title: 'Undated review row', status: 'review', scheduled_at: null })])
    expect(out).toContain('Undated review row')
    expect(out).not.toContain('Nothing is waiting for a date.')
  })

  it('🔴 EVERY rail row is handed a working control: the rail predicate IS canMoveDate', () => {
    const out = html([d({ title: 'Datable', status: 'review', scheduled_at: null })])
    expect(out).toContain('class="cal-mv"')
    // and the note that used to explain the button-less rows is gone with them
    expect(out).not.toContain('bad_status')
  })

  it('an approved row is NOT in the rail: the date RPC answers bad_status on it', () => {
    const out = html([d({ title: 'Approved and undated', status: 'approved', scheduled_at: null })])
    expect(out).toContain('Nothing is waiting for a date.')
    expect(out).not.toContain('Approved and undated')
  })

  it('a rail row drags onto a day, which is the cheap half of dating it', () => {
    const out = html([d({ title: 'Drag me', status: 'review', scheduled_at: null })])
    expect(out).toMatch(/class="cal-rr" draggable="true"/)
  })

  it('OLDEST FIRST, with how long each has waited on its face', () => {
    const rows = [
      d({ id: 'new', title: 'Fresh one', status: 'review', scheduled_at: null, created_at: inDays(-1) }),
      d({ id: 'old', title: 'Ancient one', status: 'review', scheduled_at: null, created_at: inDays(-35) }),
    ]
    const out = html(rows)
    expect(out.indexOf('Ancient one')).toBeLessThan(out.indexOf('Fresh one'))
    expect(out).toContain('>35d<')
  })

  it('and says nothing at all when the rail is empty', () => {
    const out = html([d()])
    expect(out).toContain('Nothing is waiting for a date.')
    expect(out).not.toContain('bad_status')
  })
})

// ---------------------------------------------------------------------------
// 2026-08-22: ARMED vs PLANNED, and the arm step that used to cost a takeover.
//
// A `review` row with a `scheduled_at` does not publish. Six live risedtc rows
// are exactly that (Aug 24-31) and every one of them drew a chip identical to
// the two armed ones (Sep 1, Sep 7). The rail now offers 89 more rows to date,
// so the chip has to say which of the two a date made it.
// ---------------------------------------------------------------------------

describe('planned versus armed, on the chip and in the count', () => {
  it('🔴 a dated REVIEW chip says Planned, in a word, not only in a colour', () => {
    const out = html([d({ title: 'Dated but dead', status: 'review' })])
    expect(out).toContain('data-arm="planned"')
    expect(out).toContain('>Planned<')
  })

  it('a scheduled chip says Armed', () => {
    const out = html([d({ title: 'Really going out', status: 'scheduled' })])
    expect(out).toContain('data-arm="armed"')
    expect(out).toContain('>Armed<')
  })

  it('🔴 THE MONTH COUNT SPLITS THEM: one figure counted a plan as coverage', () => {
    const rows = [
      d({ id: 'p1', status: 'review', scheduled_at: inDays(1) }),
      d({ id: 'p2', status: 'review', scheduled_at: inDays(2) }),
      d({ id: 'a1', status: 'scheduled', scheduled_at: inDays(3) }),
    ]
    const out = html(rows)
    expect(out).not.toContain('dated this month')
    expect(out).toMatch(/<b>1<\/b><span>armed<\/span>/)
    expect(out).toMatch(/<b>2<\/b><span>planned<\/span>/)
  })

  it('both figures are drawn at zero: a hidden 0 armed is the same lie', () => {
    const out = html([d({ status: 'review', scheduled_at: inDays(1) })])
    expect(out).toMatch(/<b>0<\/b><span>armed<\/span>/)
  })
})

describe('the arm step: 2 interactions instead of 5 and a takeover', () => {
  it('a planned chip on Ivan’s lane carries Arm it', () => {
    const out = html([d({ title: 'Mine, planned', status: 'review', client_id: null })])
    expect(out).toContain('class="cal-chip-armb"')
    expect(out).toContain('Arm it')
  })

  it('🔴 a CLIENT chip never does: its arming RPC also sets board_visible=true', () => {
    const out = html([d({ title: 'His, planned', status: 'review', client_id: 'risedtc' })])
    expect(out).toContain('data-arm="planned"')      // still named
    expect(out).not.toContain('class="cal-chip-armb"')  // never armed from here
  })

  it('an already-armed chip carries none, and neither does a published one', () => {
    expect(html([d({ status: 'scheduled' })])).not.toContain('cal-chip-armb')
    expect(html([d({ status: 'published', source_post_id: 'urn:li:activity:1' })]))
      .not.toContain('cal-chip-armb')
  })

  it('a queue chip carries none: there is no draft row for the write to take', () => {
    expect(html([], [q()])).not.toContain('cal-chip-armb')
  })

  it('the control names the day AND the time it would fire, before it is pressed', () => {
    const at = inDays(1)
    const out = html([d({ title: 'Mine, planned', status: 'review', scheduled_at: at })])
    const stamp = new Date(at).toLocaleString(undefined, {
      weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
    expect(out).toContain(`Arm Mine, planned for ${stamp}`)
  })
})

// ---------------------------------------------------------------------------
// 2026-08-10 — the post that was on LinkedIn and not on the calendar.
//
// scheduled_posts bc8cf413 went out at 12:01Z with no carousel_drafts row
// behind it, and this surface read carousel_drafts alone. 45 posted and 9
// pending queue rows were in the same position. The queue is a second source
// now; these assert the two properties that keep it honest.
// ---------------------------------------------------------------------------

describe('the publish queue as a second source', () => {
  it('THE BUG: a queued post with no draft is drawn', () => {
    const out = html([], [q({ post_text: 'The post Ivan actually saw.' })])
    expect(out).toContain('The post Ivan actually saw.')
    expect(out).toContain('cal-chip-queue')
  })

  it('it is inert — no open button, no move control, and it says why', () => {
    const out = html([], [q({ post_text: 'Queued only.' })])
    expect(out).not.toContain('aria-label="Move Queued only. to another day"')
    expect(out).toContain('cal-chip-t-static')
    expect(out).toContain('publish queue')
  })

  it('a queue row the drafts already draw is NOT drawn twice', () => {
    const at = inDays(3)
    const out = html([d({ id: 'twin', title: 'The twin', scheduled_at: at })], [q({ scheduled_at: at })])
    expect(out).toContain('The twin')
    expect(out).not.toContain('A queued post nobody drafted.')
    expect(out).not.toContain('cal-chip-queue')
  })

  it('the bar names the queue-only count separately, and only when there is one', () => {
    expect(html([], [q()])).toContain('queue only')
    expect(html([d()])).not.toContain('queue only')
  })
})

// ---------------------------------------------------------------------------
// 2026-08-22, phase 3. The chip stopped being 70% of its cell, and the tooltip
// stopped being a native `title`.
//
// Ivan, looking at the month: "look at the calendar pills they look like ugly
// 3d" and "there is a green background that is taking some space from us".
// ---------------------------------------------------------------------------
describe('the cap, and the overflow that carries what it hides', () => {
  const onDay = (n: number, ids: string[]) => ids.map((id, i) =>
    d({ id, title: `Post ${id}`, scheduled_at: inDays(n, 8 + i) }))

  it('a TWO-POST DAY renders both chips, which is the case the old chip could not show', () => {
    const out = html(onDay(2, ['a', 'b']))
    expect(out).toContain('Post a')
    expect(out).toContain('Post b')
    // Two is the cap, so nothing collapses and no "+N" is drawn at all.
    expect(out).not.toContain('cal-more')
  })

  it('a THREE-POST DAY still renders every chip in the DOM, and adds a +1', () => {
    const out = html(onDay(2, ['a', 'b', 'c']))
    // 🔴 ALL THREE ARE PRESENT. The cap is CSS (`wbcal.css §2` hides the third
    // above 767px), never a JS slice, because the same DOM is an agenda list on
    // mobile where there is no height to run out of and every chip must draw.
    // A JS slice would have deleted the third post from the phone as well.
    expect(out).toContain('Post a')
    expect(out).toContain('Post b')
    expect(out).toContain('Post c')
    expect(out).toContain('+1 more')
  })

  it('the +N counts what the cap hides, not what the day holds', () => {
    expect(html(onDay(2, ['a', 'b', 'c', 'd', 'e']))).toContain(`+${5 - VISIBLE_CHIPS} more`)
  })

  it('🔴 NO CHIP CARRIES A NATIVE title ATTRIBUTE any more', () => {
    // The whole defect in one assertion. A native title cannot be styled, waits
    // about a second, is unreachable by keyboard, and lands where the browser
    // likes. Every one of those is why it was replaced.
    const out = html([d({ title: 'Anything' }), ...onDay(3, ['x', 'y', 'z'])])
    expect(out).not.toContain('title="10:30')
    expect(out).not.toContain('title="Posted')
  })
})

describe('the popover lands beside its cell, never on it', () => {
  const cell = { left: 100, right: 220, top: 300, bottom: 420 }
  const chip = { left: 106, right: 214, top: 320, bottom: 352 }
  const size = { w: 240, h: 90 }

  it('sits BELOW the cell when there is room, and clears it entirely', () => {
    const p = place(chip, cell, size, { w: 1440, h: 900 })
    expect(p.side).toBe('below')
    expect(p.top).toBeGreaterThanOrEqual(cell.bottom)
  })

  it('FLIPS above when the bottom edge would clip it', () => {
    const low = { ...cell, top: 700, bottom: 820 }
    const p = place({ ...chip, top: 720, bottom: 752 }, low, size, { w: 1440, h: 900 })
    expect(p.side).toBe('above')
    expect(p.top + size.h).toBeLessThanOrEqual(low.top)
  })

  it('CLAMPS at the right edge, which is where a Saturday cell lives', () => {
    const sat = { left: 1300, right: 1420, top: 300, bottom: 420 }
    const p = place({ ...sat, top: 320, bottom: 352 }, sat, size, { w: 1440, h: 900 })
    expect(p.left + size.w).toBeLessThanOrEqual(1440)
    expect(p.left).toBeGreaterThanOrEqual(0)
  })

  it('CLAMPS at the left edge too, which is a Sunday cell at 390', () => {
    const sun = { left: 4, right: 120, top: 300, bottom: 420 }
    const p = place({ ...sun, top: 320, bottom: 352 }, sun, { w: 360, h: 90 }, { w: 390, h: 844 })
    expect(p.left).toBeGreaterThanOrEqual(0)
    expect(p.left + 360).toBeLessThanOrEqual(390)
  })

  it('stays ON SCREEN when neither side fits, rather than being pushed off the bottom', () => {
    // A tall panel on a short viewport: the flip buys nothing, so it is clamped
    // into view. A description you cannot read is worse than one sitting closer
    // to its cell than the gutter would like.
    const p = place(chip, cell, { w: 240, h: 800 }, { w: 1440, h: 500 })
    expect(p.top).toBeGreaterThanOrEqual(0)
    expect(p.top).toBeLessThan(500)
  })
})
