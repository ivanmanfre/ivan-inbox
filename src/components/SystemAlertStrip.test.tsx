import { describe, it, expect } from 'vitest'
import {
  INITIAL_STRIP_STATE, alertStripView, toggleAlertStrip,
  type AlertAutoOpen, type AlertStripState,
} from './SystemAlertStrip'
import { shapeAlerts, type AlertGroup, type Severity, type SystemAlert } from '../lib/systemAlerts'

// The defect these cover, measured on the live build 2026-08-22:
//
//   const isOpen = open || groups.some(g => g.severity === 'critical')
//
// Two bugs in one expression. ONE critical force-expanded ALL 10 groups: 1485
// px of alerts inside a 780px work area, which put the first work-queue item
// at y=1836, 956px under the fold. And because `open` starts false and `||`
// short-circuits, pressing the bar to collapse could never win while any
// critical existed: the control was inert.
//
// A boolean expression cannot represent "the reader closed this", so the fix
// is a state machine and these drive it as one, press by press, with a new
// alert arriving between presses, rather than asserting on rendered markup
// (renderToStaticMarkup fires no events, so it could not reach any of this).

// The four scan-integrity bullet texts the live table actually carries. They
// matter: groups key on the digit-stripped BODY, so warnings that differ only
// by store name collapse into one group and warnings with different bullets do
// not. A fixture whose bodies differ only by a number would fold to a single
// group and would not exercise the thing being tested.
const BULLETS = [
  '- Meta unread, no ad claim shipped: unknown',
  '- all 12 surfaced competitor advertiser(s) judged irrelevant, no strip shipped',
  '- relevance judge dropped 10 of 12 competitor candidates and only 2 survived',
  "- brand name is a single short word; identity matching ran exact-only",
]

let n = 0
function alert(over: Partial<SystemAlert> = {}): SystemAlert {
  n += 1
  return {
    id: `a${n}`, source: 'dtc_scan_integrity', dedupe_key: `k${n}`, severity: 'warn',
    title: `Scan integrity: store-${n}`, body: BULLETS[n % BULLETS.length],
    action_url: null, action_label: null,
    created_at: `2026-08-2${(n % 9) + 1}T10:00:00Z`, resolved_at: null,
    ...over,
  }
}

const critical = (over: Partial<SystemAlert> = {}) =>
  alert({ severity: 'critical' as Severity, source: 'outreach_output_rate', ...over })

// The live shape: two critical members and nineteen warnings, folded by
// shapeAlerts into the ten groups the strip actually renders.
function liveish(): AlertGroup[] {
  const rows: SystemAlert[] = [
    critical({ title: 'Outreach output collapse', body: 'CRITICAL\nMATTAN: 1 sent today' }),
    critical({ title: 'Meta grant expiring', body: 'CRITICAL\nInstagram token lapses in 4 days', source: 'meta_grant' }),
    ...Array.from({ length: 19 }, () => alert()),
  ]
  return shapeAlerts(rows)
}

const sevs = (gs: AlertGroup[]) => gs.map(g => g.severity)

describe('alertStripView: the blast radius', () => {
  it("'critical' opens ONLY the critical groups, warnings stay behind the summary", () => {
    const groups = liveish()
    expect(groups.length).toBeGreaterThan(3)
    const { visible, allShown } = alertStripView(groups, 'critical', INITIAL_STRIP_STATE)
    expect(sevs(visible)).toEqual(['critical', 'critical'])
    expect(visible.length).toBeLessThan(groups.length)
    // there IS more behind the bar, and the chevron has to say so
    expect(allShown).toBe(false)
  })

  it("a critical still opens on sight with no click, the safety property survives", () => {
    const groups = shapeAlerts([critical(), alert(), alert()])
    const { visible } = alertStripView(groups, 'critical', INITIAL_STRIP_STATE)
    expect(visible.length).toBe(1)
    expect(visible[0].severity).toBe('critical')
  })

  it('warnings alone open nothing at all until the reader asks', () => {
    const groups = shapeAlerts([alert(), alert(), alert()])
    const { visible, allShown } = alertStripView(groups, 'critical', INITIAL_STRIP_STATE)
    expect(visible).toEqual([])
    expect(allShown).toBe(false)
  })
})

describe('toggleAlertStrip: a user collapse must win', () => {
  // Drive the machine the way a person does: press, look, press again.
  const press = (groups: AlertGroup[], mode: AlertAutoOpen, s: AlertStripState) =>
    toggleAlertStrip(groups, mode, s)

  it('THE BUG: pressing the bar while a critical exists used to do nothing; now it collapses', () => {
    const groups = liveish()
    // press 1 expands the hidden warnings, press 2 collapses everything
    const expanded = press(groups, 'critical', INITIAL_STRIP_STATE)
    expect(alertStripView(groups, 'critical', expanded).visible.length).toBe(groups.length)

    const collapsed = press(groups, 'critical', expanded)
    const view = alertStripView(groups, 'critical', collapsed)
    expect(view.visible).toEqual([])
    expect(view.allShown).toBe(false)
  })

  it('the collapse STAYS collapsed across a re-render with the same criticals still open', () => {
    const groups = liveish()
    let s = press(groups, 'critical', INITIAL_STRIP_STATE)
    s = press(groups, 'critical', s)
    expect(alertStripView(groups, 'critical', s).visible).toEqual([])
    // the same alerts poll in again, unchanged. shapeAlerts is pure, so the
    // keys are identical and nothing may re-open over the reader
    const repolled = liveish()
    expect(alertStripView(repolled, 'critical', s).visible).toEqual([])
  })

  it('a NEW critical re-opens the strip even after a collapse', () => {
    const groups = liveish()
    let s = press(groups, 'critical', INITIAL_STRIP_STATE)
    s = press(groups, 'critical', s)
    expect(alertStripView(groups, 'critical', s).visible).toEqual([])

    const withNew = shapeAlerts([
      critical({ title: 'Outreach output collapse', body: 'CRITICAL\nMATTAN: 1 sent today' }),
      critical({ title: 'Meta grant expiring', body: 'CRITICAL\nInstagram token lapses in 4 days', source: 'meta_grant' }),
      critical({ title: 'Seat disconnected', body: 'CRITICAL\nthe LinkedIn seat stopped authing', source: 'seat_health' }),
      ...Array.from({ length: 19 }, () => alert()),
    ])
    // It re-opens to the CRITICAL set, not to the one new row: the other two
    // criticals are still live and unresolved, and re-opening over the reader
    // only to hide the alerts they were already shown would be worse than not
    // re-opening at all.
    const view = alertStripView(withNew, 'critical', s)
    expect(sevs(view.visible)).toEqual(['critical', 'critical', 'critical'])
    expect(view.visible.some(g => g.members[0].title.includes('Seat disconnected'))).toBe(true)
    expect(view.allShown).toBe(false)
  })

  it('DISMISSING a critical does not count as a new one arriving', () => {
    const both = liveish()
    let s = press(both, 'critical', INITIAL_STRIP_STATE)
    s = press(both, 'critical', s)
    // one of the two criticals is cleared; the remaining key was already acked
    const fewer = shapeAlerts([
      critical({ title: 'Outreach output collapse', body: 'CRITICAL\nMATTAN: 1 sent today' }),
      ...Array.from({ length: 19 }, () => alert()),
    ])
    expect(alertStripView(fewer, 'critical', s).visible).toEqual([])
  })

  it('a warning arriving after a collapse does not re-open anything', () => {
    const groups = liveish()
    let s = press(groups, 'critical', INITIAL_STRIP_STATE)
    s = press(groups, 'critical', s)
    const more = shapeAlerts([
      critical({ title: 'Outreach output collapse', body: 'CRITICAL\nMATTAN: 1 sent today' }),
      critical({ title: 'Meta grant expiring', body: 'CRITICAL\nInstagram token lapses in 4 days', source: 'meta_grant' }),
      ...Array.from({ length: 25 }, () => alert()),
    ])
    expect(alertStripView(more, 'critical', s).visible).toEqual([])
  })

  it('from collapsed, one press re-opens everything', () => {
    const groups = liveish()
    let s = press(groups, 'critical', INITIAL_STRIP_STATE)
    s = press(groups, 'critical', s)
    s = press(groups, 'critical', s)
    const view = alertStripView(groups, 'critical', s)
    expect(view.visible.length).toBe(groups.length)
    expect(view.allShown).toBe(true)
  })
})

describe("autoOpen 'all': #exp/stock keeps exactly what it had", () => {
  // The escape hatch is a hard gate this run has already verified once. These
  // pin the OLD expression's truth table so a later edit cannot drift it.
  it('one critical still force-opens every group', () => {
    const groups = liveish()
    const { visible, allShown } = alertStripView(groups, 'all', INITIAL_STRIP_STATE)
    expect(visible.length).toBe(groups.length)
    expect(allShown).toBe(true)
  })

  it('warnings alone stay shut until pressed, then open', () => {
    const groups = shapeAlerts([alert(), alert()])
    expect(alertStripView(groups, 'all', INITIAL_STRIP_STATE).visible).toEqual([])
    const s = toggleAlertStrip(groups, 'all', INITIAL_STRIP_STATE)
    expect(alertStripView(groups, 'all', s).visible.length).toBe(groups.length)
  })

  it('pressing to collapse is STILL inert while a critical exists (the old behaviour, kept)', () => {
    const groups = liveish()
    const s = toggleAlertStrip(groups, 'all', INITIAL_STRIP_STATE)
    // unchanged on purpose: fixing this for stock would move stock's pixels
    expect(alertStripView(groups, 'all', s).visible.length).toBe(groups.length)
  })

  it("the workbench's own state never leaks into stock's branch", () => {
    const groups = liveish()
    const collapsedInWorkbench: AlertStripState =
      { choice: 'collapsed', acked: groups.filter(g => g.severity === 'critical').map(g => g.key), open: false }
    expect(alertStripView(groups, 'all', collapsedInWorkbench).visible.length).toBe(groups.length)
  })
})
