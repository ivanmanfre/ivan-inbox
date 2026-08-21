import { describe, expect, it } from 'vitest'
import {
  SYSTEM_ALERTS_TABLE, alertSummary, bodyPreview, cleanTitle, dedupeAlerts, groupAlerts,
  groupHeadline, rankAlerts, shapeAlerts, splitConcatenated, type Severity, type SystemAlert,
} from './systemAlerts'

const alert = (o: Partial<SystemAlert>): SystemAlert => ({
  id: 'a', source: 'zernio_token_watch', dedupe_key: 'k', severity: 'warn' as Severity,
  title: 't', body: null, action_url: null, action_label: null,
  created_at: '2026-08-05T09:00:00.000Z', resolved_at: null, ...o,
})

describe('table', () => {
  it('pins the table name the n8n watcher writes to', () => {
    expect(SYSTEM_ALERTS_TABLE).toBe('system_alerts')
  })
})

describe('rankAlerts', () => {
  // The whole point of the strip is that the worst thing is the first thing.
  // Sorting by created_at alone would bury a dead OAuth grant under a note.
  it('puts severity ahead of recency', () => {
    const rows = [
      alert({ id: 'note', severity: 'info', created_at: '2026-08-05T09:00:00.000Z' }),
      alert({ id: 'dead', severity: 'critical', created_at: '2026-08-01T09:00:00.000Z' }),
      alert({ id: 'warn', severity: 'warn', created_at: '2026-08-04T09:00:00.000Z' }),
    ]
    expect(rankAlerts(rows).map(r => r.id)).toEqual(['dead', 'warn', 'note'])
  })

  it('breaks a severity tie with the newer row', () => {
    const rows = [
      alert({ id: 'old', severity: 'critical', created_at: '2026-08-01T09:00:00.000Z' }),
      alert({ id: 'new', severity: 'critical', created_at: '2026-08-05T09:00:00.000Z' }),
    ]
    expect(rankAlerts(rows).map(r => r.id)).toEqual(['new', 'old'])
  })

  it('does not mutate its input', () => {
    const rows = [alert({ id: 'a', severity: 'info' }), alert({ id: 'b', severity: 'critical' })]
    rankAlerts(rows)
    expect(rows.map(r => r.id)).toEqual(['a', 'b'])
  })
})

describe('alertSummary', () => {
  // "1 alert" and "1 critical" are different sentences; only one says whether
  // to stop what you are doing.
  it('names the severities rather than a bare total', () => {
    const rows = [
      alert({ severity: 'critical' }), alert({ severity: 'warn' }), alert({ severity: 'warn' }),
    ]
    expect(alertSummary(rows)).toBe('1 critical · 2 warnings')
  })

  it('singularises and drops empty buckets', () => {
    expect(alertSummary([alert({ severity: 'warn' })])).toBe('1 warning')
    expect(alertSummary([alert({ severity: 'info' })])).toBe('1 note')
  })

  it('is empty for no rows, which is when the strip renders nothing at all', () => {
    expect(alertSummary([])).toBe('')
  })
})

// Fixtures below are pulled from the live system_alerts payload on
// 2026-08-21 (fetchSystemAlerts, 20 rows) — not invented shapes. See
// phase3-today.md for the full dump.

describe('cleanTitle', () => {
  it('strips the leading emoji this pass retires as a severity signal', () => {
    expect(cleanTitle('🔴 Outreach output collapse')).toBe('Outreach output collapse')
    expect(cleanTitle('⚠ Outreach output down')).toBe('Outreach output down')
  })

  it('leaves a title with no leading glyph untouched', () => {
    expect(cleanTitle('Scan integrity: bennett-ca')).toBe('Scan integrity: bennett-ca')
  })
})

describe('splitConcatenated', () => {
  const concatCritical = alert({
    id: 'crit-1', source: 'outreach_output_rate', severity: 'critical',
    title: '🔴 Outreach output collapse',
    body: 'CRITICAL\nMATTAN: 1 sent today, ~50.3 expected 15h into the window (baseline 53.7/day)\n'
      + 'WARN\nIVAN: 23.5/day vs 45.8 baseline = 51%\n\n'
      + 'MATTAN today 1 (exp ~50.3) · 2d 60/day · baseline 53.7/day (112%)\n'
      + 'IVAN today 0 (exp ~0) · 2d 23.5/day · baseline 45.8/day (51%)\n'
      + 'inventory (context): rise_engager 3 · rise_cold dormant · rise_orbit 0 · rise_engager_ads_first 0',
  })

  it('splits a CRITICAL card that concatenates a WARN block into two alerts', () => {
    const out = splitConcatenated(concatCritical)
    expect(out).toHaveLength(2)
    expect(out[0].severity).toBe('critical')
    expect(out[0].body).toContain('MATTAN: 1 sent today')
    expect(out[1].severity).toBe('warn')
    expect(out[1].body).toContain('IVAN: 23.5/day')
  })

  it('duplicates the shared trailing telemetry onto both halves rather than dropping it from either', () => {
    const [crit, warn] = splitConcatenated(concatCritical)
    expect(crit.body).toContain('inventory (context): rise_engager 3')
    expect(warn.body).toContain('inventory (context): rise_engager 3')
  })

  it('keeps the same real row id on both halves — it is one database row, not two', () => {
    const out = splitConcatenated(concatCritical)
    expect(out[0].id).toBe('crit-1')
    expect(out[1].id).toBe('crit-1')
  })

  it('never invents a title for the split half — it quotes the row’s own first line', () => {
    const [, warn] = splitConcatenated(concatCritical)
    expect(warn.title).toBe('Also flagged: IVAN: 23.5/day vs 45.8 baseline = 51%')
  })

  it('does not split a body with no embedded second marker', () => {
    const plain = alert({ severity: 'warn', body: '- Meta unread, no ad claim shipped: unknown' })
    expect(splitConcatenated(plain)).toEqual([plain])
  })

  it('does not split when the body’s own first marker disagrees with the declared severity', () => {
    // A row marked warn whose body happens to start with the word "CRITICAL"
    // as prose, not as its own severity marker, must not be torn in two.
    const decoy = alert({ severity: 'warn', body: 'CRITICAL\nsome prose\nWARN\nmore prose' })
    expect(splitConcatenated(decoy)).toEqual([decoy])
  })

  it('does not split on a bare single marker with nothing after it', () => {
    const single = alert({ severity: 'critical', body: 'CRITICAL\njust one line, no second block' })
    expect(splitConcatenated(single)).toEqual([single])
  })
})

describe('dedupeAlerts', () => {
  // The real bennett-ca pair: same source, same title, byte-identical body,
  // two different dedupe_keys a day apart.
  const bennettA = alert({
    id: 'b-19', source: 'dtc_scan_integrity', severity: 'warn',
    dedupe_key: 'scan-integrity:bennett-ca:2026-08-19',
    title: 'Scan integrity: bennett-ca',
    body: '- all 12 surfaced competitor advertiser(s) judged irrelevant — no strip shipped; category keywords may be off',
    created_at: '2026-08-19T11:33:03.039629+00:00',
  })
  const bennettB = alert({
    id: 'b-18', source: 'dtc_scan_integrity', severity: 'warn',
    dedupe_key: 'scan-integrity:bennett-ca:2026-08-18',
    title: 'Scan integrity: bennett-ca',
    body: '- all 12 surfaced competitor advertiser(s) judged irrelevant — no strip shipped; category keywords may be off',
    created_at: '2026-08-18T18:17:40.107151+00:00',
  })

  it('collapses a byte-identical duplicate (same title AND body) into one member', () => {
    const out = dedupeAlerts([bennettA, bennettB])
    expect(out).toHaveLength(1)
    expect(out[0].title).toBe('Scan integrity: bennett-ca')
  })

  it('keeps both real ids on the collapsed member, so dismissing it resolves both underlying rows', () => {
    const out = dedupeAlerts([bennettA, bennettB])
    expect(out[0].ids.sort()).toEqual(['b-18', 'b-19'])
  })

  it('keeps the newest body’s created_at on the collapsed member', () => {
    const out = dedupeAlerts([bennettA, bennettB])
    expect(out[0].created_at).toBe(bennettA.created_at)
  })

  // The pair that must NOT dedupe: same body text, different subject
  // (different store). Six of these exist live; this is two of them.
  it('does NOT collapse two different stores that happen to share a body — that is grouping’s job', () => {
    const storeA = alert({
      id: 's-a', source: 'dtc_scan_integrity', title: 'Scan integrity: arthcrafted-80',
      body: '- Meta unread, no ad claim shipped: unknown',
    })
    const storeB = alert({
      id: 's-b', source: 'dtc_scan_integrity', title: 'Scan integrity: skd-fashion-revolution-92',
      body: '- Meta unread, no ad claim shipped: unknown',
    })
    const out = dedupeAlerts([storeA, storeB])
    expect(out).toHaveLength(2)
    expect(out.map(m => m.ids[0]).sort()).toEqual(['s-a', 's-b'])
  })
})

describe('groupAlerts', () => {
  const meta = (id: string, store: string): SystemAlert => alert({
    id, source: 'dtc_scan_integrity', title: `Scan integrity: ${store}`,
    body: '- Meta unread, no ad claim shipped: unknown',
  })

  it('the pair that MUST group: same source + severity + shape, different store names', () => {
    const members = dedupeAlerts([meta('m1', 'arthcrafted-80'), meta('m2', 'skd-fashion-revolution-92')])
    const groups = groupAlerts(members)
    expect(groups).toHaveLength(1)
    expect(groups[0].count).toBe(2)
  })

  it('the pair that must NOT group: same source + severity, different failure shape', () => {
    const metaUnread = meta('m1', 'arthcrafted-80')
    const allIrrelevant = alert({
      id: 'm3', source: 'dtc_scan_integrity', title: 'Scan integrity: paleonola-3d',
      body: '- all 12 surfaced competitor advertiser(s) judged irrelevant — no strip shipped; category keywords may be off',
    })
    const groups = groupAlerts(dedupeAlerts([metaUnread, allIrrelevant]))
    expect(groups).toHaveLength(2)
    expect(groups.map(g => g.count)).toEqual([1, 1])
  })

  it('groups the same recurring check fired on two different days — digits stripped from the shape comparison only', () => {
    const day1 = alert({
      id: 'w1', source: 'outreach_output_rate', severity: 'warn', title: '⚠ Outreach output down',
      body: 'WARN\nIVAN: 23.5/day vs 45.8 baseline = 51%\n\nMATTAN today 5 (exp ~0) · 2d 60/day\ninventory (context): rise_engager 7',
      created_at: '2026-08-21T04:00:51.556112+00:00',
    })
    const day2 = alert({
      id: 'w2', source: 'outreach_output_rate', severity: 'warn', title: '⚠ Outreach output down',
      body: 'WARN\nIVAN: 36/day vs 65.8 baseline = 55%\n\nMATTAN today 8 (exp ~0) · 2d 93.5/day\ninventory (context): rise_engager 49',
      created_at: '2026-08-17T04:00:54.429939+00:00',
    })
    const groups = groupAlerts(dedupeAlerts([day1, day2]))
    expect(groups).toHaveLength(1)
    expect(groups[0].count).toBe(2)
    // the displayed digits ("23.5/day", "45.8", "51%"…) must survive on the members —
    // stripping is for the comparison only, never for what is shown.
    expect(groups[0].members.map(m => m.body).join('')).toContain('23.5/day')
    expect(groups[0].members.map(m => m.body).join('')).toContain('36/day')
  })

  it('never merges two different severities into one group, even with a matching body shape', () => {
    const w = alert({ id: 'sv-w', severity: 'warn', source: 'x', body: 'thing failed 3 times' })
    const c = alert({ id: 'sv-c', severity: 'critical', source: 'x', body: 'thing failed 9 times' })
    const groups = groupAlerts(dedupeAlerts([w, c]))
    expect(groups).toHaveLength(2)
  })
})

describe('groupHeadline', () => {
  it('leads with the count as a figure and names the shared shape, inventing no new fact', () => {
    const store = (id: string, s: string) => alert({
      id, source: 'dtc_scan_integrity', title: `Scan integrity: ${s}`,
      body: '- Meta unread, no ad claim shipped: unknown',
    })
    const groups = groupAlerts(dedupeAlerts([
      store('1', 'a'), store('2', 'b'), store('3', 'c'), store('4', 'd'), store('5', 'e'), store('6', 'f'),
    ]))
    expect(groupHeadline(groups[0])).toBe('Scan integrity · 6 stores, same failure')
  })

  it('falls back to the generic noun for a source with no known domain word', () => {
    const groups = groupAlerts(dedupeAlerts([
      alert({ id: '1', source: 'zernio_token_watch', title: 'Grant expiring', body: 'token lapses in 3 days' }),
      alert({ id: '2', source: 'zernio_token_watch', title: 'Grant expiring', body: 'token lapses in 9 days' }),
    ]))
    expect(groupHeadline(groups[0])).toBe('Grant expiring · 2 alerts, same failure')
  })
})

describe('bodyPreview', () => {
  it('skips a leading severity-marker line — it is not a sentence a reader should see as the row text', () => {
    const { preview, rest } = bodyPreview('CRITICAL\nMATTAN: 1 sent today, ~50.3 expected 15h into the window')
    expect(preview).toBe('MATTAN: 1 sent today, ~50.3 expected 15h into the window')
    expect(rest).toEqual([])
  })

  it('strips a leading bullet dash from the preview line', () => {
    const { preview } = bodyPreview('- Meta unread, no ad claim shipped: unknown')
    expect(preview).toBe('Meta unread, no ad claim shipped: unknown')
  })

  it('keeps every other line for the raw disclosure, in order, nothing dropped', () => {
    const { rest } = bodyPreview('WARN\nIVAN: 23.5/day vs 45.8 baseline = 51%\n\nMATTAN today 1 · IVAN today 0')
    expect(rest).toEqual(['MATTAN today 1 · IVAN today 0'])
  })

  it('is null for a row with no body at all', () => {
    expect(bodyPreview(null)).toEqual({ preview: null, rest: [] })
  })
})

describe('shapeAlerts (the full pipeline)', () => {
  // A cut of the live payload: the concatenated critical, both standalone
  // warns of the same shape, the byte-identical bennett-ca duplicate, and one
  // more distinct scan-integrity row that must stay on its own.
  const rows: SystemAlert[] = [
    alert({
      id: 'crit', source: 'outreach_output_rate', severity: 'critical', title: '🔴 Outreach output collapse',
      body: 'CRITICAL\nMATTAN: 1 sent today, ~50.3 expected 15h into the window (baseline 53.7/day)\n'
        + 'WARN\nIVAN: 23.5/day vs 45.8 baseline = 51%\n\nMATTAN today 1 · IVAN today 0',
      created_at: '2026-08-21T00:00:58.124916+00:00',
    }),
    alert({
      id: 'warn21', source: 'outreach_output_rate', severity: 'warn', title: '⚠ Outreach output down',
      body: 'WARN\nIVAN: 23.5/day vs 45.8 baseline = 51%\n\nMATTAN today 5 · IVAN today 4',
      created_at: '2026-08-21T04:00:51.556112+00:00',
    }),
    alert({
      id: 'warn17', source: 'outreach_output_rate', severity: 'warn', title: '⚠ Outreach output down',
      body: 'WARN\nIVAN: 36/day vs 65.8 baseline = 55%\n\nMATTAN today 8 · IVAN today 7',
      created_at: '2026-08-17T04:00:54.429939+00:00',
    }),
    alert({
      id: 'bennett-19', source: 'dtc_scan_integrity', severity: 'warn', title: 'Scan integrity: bennett-ca',
      body: '- all 12 surfaced competitor advertiser(s) judged irrelevant — no strip shipped; category keywords may be off',
      created_at: '2026-08-19T11:33:03.039629+00:00',
    }),
    alert({
      id: 'bennett-18', source: 'dtc_scan_integrity', severity: 'warn', title: 'Scan integrity: bennett-ca',
      body: '- all 12 surfaced competitor advertiser(s) judged irrelevant — no strip shipped; category keywords may be off',
      created_at: '2026-08-18T18:17:40.107151+00:00',
    }),
    alert({
      id: 'noisy', source: 'dtc_scan_integrity', severity: 'warn', title: 'Scan integrity: noisy-clan-e9',
      body: '- relevance judge dropped 11 of 12 competitor candidates and only 1 survived — category keywords may be off; eyeball what remains',
      created_at: '2026-08-17T21:41:43.239798+00:00',
    }),
  ]

  it('renders one row per distinct shape — no duplicate bodies anywhere in the output', () => {
    const groups = shapeAlerts(rows)
    // crit(1) + outreach-warn-group(1, count 3) + bennett-group(1, count 1, ids merged) + noisy(1) = 4 rows
    expect(groups).toHaveLength(4)
    const bodies = groups.map(g => g.members.map(m => m.body).join('␟'))
    expect(new Set(bodies).size).toBe(bodies.length)
  })

  it('the outreach warn group carries all three instances, including the one split out of the critical row', () => {
    const groups = shapeAlerts(rows)
    const outreachWarn = groups.find(g => g.severity === 'warn' && g.members[0].source === 'outreach_output_rate')
    expect(outreachWarn?.count).toBe(3)
  })

  it('the critical half survives on its own, carrying only the MATTAN line', () => {
    const groups = shapeAlerts(rows)
    const critical = groups.find(g => g.severity === 'critical')
    expect(critical?.count).toBe(1)
    expect(critical?.members[0].body).toContain('MATTAN: 1 sent today')
    expect(critical?.members[0].body).not.toContain('WARN\nIVAN')
  })

  it('the bennett-ca duplicate collapses to one row carrying both real ids', () => {
    const groups = shapeAlerts(rows)
    const bennett = groups.find(g => g.members[0].title === 'Scan integrity: bennett-ca')
    expect(bennett?.count).toBe(1)
    expect(bennett?.members[0].ids.sort()).toEqual(['bennett-18', 'bennett-19'])
  })

  it('a genuinely distinct alert (noisy-clan-e9) is never folded into another group', () => {
    const groups = shapeAlerts(rows)
    const noisy = groups.find(g => g.members[0].title === 'Scan integrity: noisy-clan-e9')
    expect(noisy?.count).toBe(1)
  })
})
