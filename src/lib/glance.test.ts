import { describe, it, expect } from 'vitest'
import { isClamped, mergeAlerts, norm, splitReviewByLane } from './glance'
import { rollup } from '../exp/v2c/Rail'

// The glance layer shipped 230 lines of derivation and no tests. These are the
// four traps that were documented as live-database decisions and never asserted:
// the lane fold, the roll-up's containment rule, the cross-view dedupe, and the
// silence rules. Nothing here touches the network; every input is a literal.

describe('splitReviewByLane', () => {
  it('folds NULL client_id onto ivan, never onto other', () => {
    // 🔴 This is the whole reason the count read "2" while 93 drafts sat one
    // lane away. Ivan is `client_id IS NULL`, never the literal 'ivan'.
    const s = splitReviewByLane([
      { client_id: null }, { client_id: null },
      { client_id: 'risedtc' }, { client_id: 'arch' },
    ])
    expect(s.byLane).toEqual({ ivan: 2, risedtc: 1, arch: 1 })
    expect(s.other).toBe(0)
  })

  it('reproduces the 2026-08-22 live split: NULL 2 / risedtc 54 / arch 39', () => {
    const rows = [
      ...Array.from({ length: 2 }, () => ({ client_id: null })),
      ...Array.from({ length: 54 }, () => ({ client_id: 'risedtc' })),
      ...Array.from({ length: 39 }, () => ({ client_id: 'arch' })),
    ]
    const s = splitReviewByLane(rows)
    expect(s.byLane).toEqual({ ivan: 2, risedtc: 54, arch: 39 })
    // The headline is every lane, not Ivan's. A lane-scoped read of the same
    // rows would have said 2, which was the defect.
    const total = s.byLane.ivan + s.byLane.risedtc + s.byLane.arch + s.other
    expect(total).toBe(95)
    expect(total).not.toBe(s.byLane.ivan)
  })

  it('an unknown lane is counted in other, never dropped', () => {
    // The vocabulary has grown twice already (risedtc, then arch). A fourth
    // client must show up in the total on the day it is created.
    const s = splitReviewByLane([{ client_id: 'newclient' }, { client_id: null }])
    expect(s.other).toBe(1)
    expect(s.byLane).toEqual({ ivan: 1, risedtc: 0, arch: 0 })
  })

  it('the literal string ivan lands on the ivan lane too, not on other', () => {
    // Defensive: nothing writes the literal today, but if a row ever carries it
    // the count must not silently move to `other`.
    const s = splitReviewByLane([{ client_id: 'ivan' }])
    expect(s.byLane.ivan).toBe(1)
    expect(s.other).toBe(0)
  })

  it('no rows is three zeros, not an empty map', () => {
    expect(splitReviewByLane([])).toEqual({
      byLane: { ivan: 0, risedtc: 0, arch: 0 }, other: 0,
    })
  })
})

describe('rollup', () => {
  it('equals the sum of the visible rail counts and nothing else', () => {
    const counts = { dms: 7, content: 95, magnets: 3 }
    const r = rollup(counts)
    expect(r.n).toBe(105)
    expect(r.n).toBe(Object.values(counts).reduce((a, b) => a + b, 0))
  })

  it('names every summand, so the arithmetic is checkable on the screen', () => {
    const r = rollup({ dms: 7, content: 95 })
    expect(r.note).toContain('7')
    expect(r.note).toContain('95')
    // The parts are all present, so no number in the total is invisible below it.
    const named = [...r.note.matchAll(/\b(\d+)\b/g)].map(m => Number(m[1]))
    expect(named).toContain(7)
    expect(named).toContain(95)
  })

  it('a zero count is not a summand and is not named', () => {
    // A permanently blank slot is the defect the port audit found on 17 of the
    // old sidebar's 21 rows. A count of zero renders nothing at all.
    const r = rollup({ dms: 0, content: 4 })
    expect(r.n).toBe(4)
    // Exactly one summand is named, so the zero lane never appears in the note.
    expect(r.note.split('. ')[0]).not.toContain('+')
    expect(r.note).not.toMatch(/\b0\b/)
  })

  it('states what it does NOT cover, because a global number invites the wrong assumption', () => {
    const r = rollup({ content: 4 })
    expect(r.note).toMatch(/does not cover/i)
  })

  it('all zero is silence, and silence is information', () => {
    const r = rollup({ dms: 0, content: 0, magnets: 0 })
    expect(r.n).toBe(0)
    expect(r.note).toBe('Nothing waiting on the rail.')
  })

  it('an empty counts map is the same silence', () => {
    expect(rollup({}).n).toBe(0)
  })

  it('a key that is not a rail job cannot enter the total', () => {
    // The containment rule: the roll-up is the RAIL's counts added up. A number
    // with no row beneath it is impossible by construction, and this asserts it
    // rather than trusting the comment.
    const r = rollup({ content: 4, notARailJob: 999 } as Record<string, number>)
    expect(r.n).toBe(4)
    expect(r.note).not.toContain('999')
  })
})

describe('mergeAlerts', () => {
  const CUT = '2026-08-08T00:00:00Z'
  const wfRow = (name: string, at: string) => ({
    workflow_name: name, last_execution_at: at,
    last_error_message: 'boom', error_acknowledged: false,
  })
  const jobRow = (label: string, at: string) => ({
    label, source: 'n8n', category: 'outreach',
    last_run_at: at, last_error_message: null,
  })

  it('dedupes by name across the two views: a naive sum over-counts', () => {
    // The shape of the live reading on 2026-08-22: 10 errored, 15 stalled, 6
    // names present in both. A naive sum says 25 automations are broken. 19 are.
    const shared = Array.from({ length: 6 }, (_, i) => `Shared job ${i}`)
    const wf = [
      ...shared.map(n => wfRow(n, '2026-08-20T10:00:00Z')),
      ...Array.from({ length: 4 }, (_, i) => wfRow(`Errored only ${i}`, '2026-08-20T10:00:00Z')),
    ]
    const jobs = [
      ...shared.map(n => jobRow(n, '2026-08-21T10:00:00Z')),
      ...Array.from({ length: 9 }, (_, i) => jobRow(`Stalled only ${i}`, '2026-08-21T10:00:00Z')),
    ]
    const naiveSum = wf.length + jobs.length
    const { alerts } = mergeAlerts(wf, jobs, CUT)
    expect(naiveSum).toBe(25)
    expect(alerts.length).toBe(19)
    expect(alerts.filter(a => a.kind === 'both').length).toBe(6)
    expect(alerts.filter(a => a.kind === 'errored').length).toBe(4)
    expect(alerts.filter(a => a.kind === 'stalled').length).toBe(9)
  })

  it('matches on the normalised name, so casing and padding do not split a row in two', () => {
    const { alerts } = mergeAlerts(
      [wfRow('Rise Sender', '2026-08-20T10:00:00Z')],
      [jobRow('  rise sender  ', '2026-08-21T10:00:00Z')],
      CUT,
    )
    expect(alerts.length).toBe(1)
    expect(alerts[0].kind).toBe('both')
    // The DISPLAY name keeps the workflow view's spelling; only the key is folded.
    expect(alerts[0].name).toBe('Rise Sender')
    expect(alerts[0].key).toBe('rise sender')
  })

  it('a both row keeps the errored detail and takes the scheduled view category', () => {
    const { alerts } = mergeAlerts(
      [wfRow('Sender', '2026-08-20T10:00:00Z')],
      [jobRow('Sender', '2026-08-21T10:00:00Z')],
      CUT,
    )
    expect(alerts[0]).toMatchObject({
      kind: 'both', detail: 'boom', source: 'n8n', category: 'outreach',
    })
  })

  it('counts what the window excluded instead of hiding it', () => {
    // The 7 corpses aged 72 to 167 days are not alarms, and the number of them
    // is still stated. An unwindowed read rebuilds the permanent error shelf
    // Ivan cut from Today.
    const { alerts, olderErrored, olderStalled } = mergeAlerts(
      [wfRow('Old TEMP job', '2026-04-01T00:00:00Z'), wfRow('Live job', '2026-08-21T00:00:00Z')],
      [jobRow('Old scheduled', '2026-03-11T00:00:00Z')],
      CUT,
    )
    expect(alerts.map(a => a.name)).toEqual(['Live job'])
    expect(olderErrored).toBe(1)
    expect(olderStalled).toBe(1)
  })

  it('a row with no timestamp counts as older, never as a live alarm', () => {
    const { alerts, olderErrored, olderStalled } = mergeAlerts(
      [{ workflow_name: 'No stamp', last_execution_at: null }],
      [{ label: 'No stamp job', last_run_at: null }],
      CUT,
    )
    expect(alerts).toEqual([])
    expect(olderErrored).toBe(1)
    expect(olderStalled).toBe(1)
  })

  it('sorts newest first', () => {
    const { alerts } = mergeAlerts(
      [wfRow('Older', '2026-08-10T00:00:00Z'), wfRow('Newer', '2026-08-21T00:00:00Z')],
      [], CUT,
    )
    expect(alerts.map(a => a.name)).toEqual(['Newer', 'Older'])
  })

  it('no rows is no alerts and two zeros, not an alarm', () => {
    expect(mergeAlerts([], [], CUT)).toEqual({ alerts: [], olderErrored: 0, olderStalled: 0 })
  })

  it('carries the acknowledged flag through rather than dropping the row', () => {
    const { alerts } = mergeAlerts(
      [{ ...wfRow('Ack me', '2026-08-21T00:00:00Z'), error_acknowledged: true }],
      [], CUT,
    )
    expect(alerts[0].acknowledged).toBe(true)
  })
})

describe('isClamped', () => {
  it('is true when the server count exceeds the rows it sent', () => {
    // PostgREST clamps a select at 1,000 rows whatever `limit` says. The number
    // on screen is then a floor, and the surface has to say so.
    expect(isClamped(1500, 1000)).toBe(true)
  })

  it('is false when the count and the row length agree', () => {
    expect(isClamped(95, 95)).toBe(false)
  })

  it('a missing count is not a clamp', () => {
    expect(isClamped(null, 0)).toBe(false)
    expect(isClamped(undefined, 12)).toBe(false)
  })

  it('zero rows and zero count is not a clamp', () => {
    expect(isClamped(0, 0)).toBe(false)
  })
})

describe('norm', () => {
  it('trims and lowercases, and treats null as empty', () => {
    expect(norm('  Rise Sender ')).toBe('rise sender')
    expect(norm(null)).toBe('')
    expect(norm(undefined)).toBe('')
  })
})
