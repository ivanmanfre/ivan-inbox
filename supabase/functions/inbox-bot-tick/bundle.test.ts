// Unit for the tick's pure half. Vitest, not deno test: vitest.config.ts
// includes supabase/**/*.test.ts and the repo's other edge-function units
// (inbox-claude/assembler.test.ts, inbox-turn-run/completion.test.ts) are
// written this way, so a Deno.test-only file would be run by nothing here.
//
// What these pin is the two rules that decide whether a feed row gets told to
// Ivan twice: the open-turn exclusion, and "only what fits gets stamped".
import { describe, expect, it } from 'vitest'
import { buildBundle, BUNDLE_MAX_CHARS, type FeedRow, MUTED_FAMILIES, selectRows } from './bundle.ts'

function row(over: Partial<FeedRow> & { id: string; created_at: string }): FeedRow {
  return {
    family: 'outreach_engine_ops',
    severity: 'info',
    tenant: null,
    count: 1,
    title: `row ${over.id}`,
    body: null,
    url: null,
    group_key: null,
    ...over,
  }
}

describe('selectRows', () => {
  it('keeps rows oldest first', () => {
    const rows = [
      row({ id: 'c', created_at: '2026-09-11T12:00:00Z' }),
      row({ id: 'a', created_at: '2026-09-11T10:00:00Z' }),
      row({ id: 'b', created_at: '2026-09-11T11:00:00Z' }),
    ]
    expect(selectRows(rows, []).map((r) => r.id)).toEqual(['a', 'b', 'c'])
  })

  it('excludes a row grouped under a bot turn that is still open', () => {
    const open = '11111111-1111-4111-8111-111111111111'
    const rows = [
      row({ id: 'held', created_at: '2026-09-11T10:00:00Z', group_key: `bot:${open}` }),
      row({ id: 'free', created_at: '2026-09-11T10:01:00Z' }),
    ]
    expect(selectRows(rows, [open]).map((r) => r.id)).toEqual(['free'])
  })

  it('includes a row grouped under a bot turn that has closed', () => {
    // The errored-turn path: its group_key still points at the turn, but the
    // turn is no longer queued or running, so the row is eligible again.
    const closed = '22222222-2222-4222-8222-222222222222'
    const open = '33333333-3333-4333-8333-333333333333'
    const rows = [row({ id: 'again', created_at: '2026-09-11T10:00:00Z', group_key: `bot:${closed}` })]
    expect(selectRows(rows, [open]).map((r) => r.id)).toEqual(['again'])
  })

  it('excludes the muted families', () => {
    const rows = [
      row({ id: 'chat', created_at: '2026-09-11T10:00:00Z', family: 'chat' }),
      row({ id: 'turn', created_at: '2026-09-11T10:01:00Z', family: 'claude_turn' }),
      row({ id: 'health', created_at: '2026-09-11T10:02:00Z', family: 'health_reminder' }),
      row({ id: 'real', created_at: '2026-09-11T10:03:00Z', family: 'booking_notice' }),
    ]
    expect(selectRows(rows, []).map((r) => r.id)).toEqual(['real'])
  })

  it('never reads family bot: the bot must not be handed its own notification', () => {
    // From 2026-09-12 an actionable bot message writes one row in family 'bot'
    // (decision D5). If the tick could select it, the next bundle would contain
    // the bot's own push and it would answer itself every 30 minutes.
    const rows = [
      row({ id: 'own', created_at: '2026-09-11T10:00:00Z', family: 'bot', title: 'Mattan seat under floor' }),
      row({ id: 'real', created_at: '2026-09-11T10:01:00Z', family: 'lane_supply_alarm' }),
    ]
    expect(selectRows(rows, []).map((r) => r.id)).toEqual(['real'])
    // The SQL in index.ts filters on this same constant
    // (.not('family','in',`(${MUTED_FAMILIES.join(',')})`)), so the row never
    // even reaches selectRows in production. One definition, two enforcements.
    expect(MUTED_FAMILIES).toContain('bot')
  })
})

describe('buildBundle', () => {
  it('renders one line per row, in order, with the header and the last head', () => {
    const rows = [
      row({
        id: 'a', created_at: '2026-09-11T10:00:00Z', family: 'booking_notice',
        severity: 'attention', tenant: 'rise', count: 2,
        title: 'Alan booked', body: 'Good Candy, Thursday', url: './#today',
      }),
      row({ id: 'b', created_at: '2026-09-11T10:01:00Z', title: 'Pace is fine' }),
      row({ id: 'c', created_at: '2026-09-11T10:02:00Z', title: 'Pool topped up' }),
    ]
    const out = buildBundle(rows, 'Nothing needs you. 4 routine rows folded.')
    expect(out.included).toEqual(['a', 'b', 'c'])

    const lines = out.text.split('\n')
    expect(lines[0]).toBe('Feed rows since my last message (3 rows, oldest first):')
    expect(lines[1]).toBe('[booking_notice · attention · rise · 2x] Alan booked : Good Candy, Thursday (./#today)')
    expect(lines[2]).toBe('[outreach_engine_ops · info · ivan · 1x] Pace is fine')
    expect(lines[3]).toBe('[outreach_engine_ops · info · ivan · 1x] Pool topped up')
    expect(out.text).toContain('What I said last time (first 300 chars):\nNothing needs you. 4 routine rows folded.')
  })

  it('says so when there is no previous answer', () => {
    const out = buildBundle([row({ id: 'a', created_at: '2026-09-11T10:00:00Z' })], null)
    expect(out.text).toContain('(nothing yet)')
  })

  it('stops under the cap on 300 rows and returns only the ids it included', () => {
    const rows = Array.from({ length: 300 }, (_, i) =>
      row({
        id: `row-${String(i).padStart(3, '0')}`,
        created_at: `2026-09-11T10:${String(i % 60).padStart(2, '0')}:00Z`,
        title: `probe ${i} `.padEnd(60, 'x'),
        body: 'y'.repeat(400), // clipped to 240 by the renderer
      }))
    const out = buildBundle(rows, null)

    expect(out.text.length).toBeLessThanOrEqual(BUNDLE_MAX_CHARS)
    // A real stop, not "everything fitted" and not "nothing fitted": the bundle
    // must carry some rows and leave the rest for the next tick.
    expect(out.included.length).toBeGreaterThan(0)
    expect(out.included.length).toBeLessThan(300)
    // Every included id is a real row id, and they are the FIRST n rows in the
    // order given: the rows that did not fit stay unread rather than being
    // dropped from the middle.
    const wanted = rows.slice(0, out.included.length).map((r) => r.id)
    expect(out.included).toEqual(wanted)
    // One line per included row, plus the header and the two tail lines.
    expect(out.text.split('\n').length).toBe(out.included.length + 4)
  })
})
