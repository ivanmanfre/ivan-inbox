import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  DM_FIELDS, SALES_FIELDS, applyThreadTokens, applyTokens, contentFields,
  filterFromTokens, filterStateFromTokens, findField, lastReplyAt, matchToken,
  newToken, salesRowMatches, threadChannel, tokenSentence, tokensForFilter,
  tokensFromFilterState, valueLabel, wantsSpam, hasStatusToken,
  type FilterToken,
} from './filterTokens'
import { filterByStatus, filterThreads, groupThreads, type Filter, type InboxMessage, type Status } from './inbox'

// Same clock treatment as inbox.test.ts: needsAnswer (and therefore
// threadBucket, which the `status` field runs through) reads a 14-day wall
// clock with no injectable `now` on most paths, so the fixtures are dated
// inside a frozen window rather than made relative.
const FROZEN_NOW = new Date('2026-07-22T20:00:00Z')
const NOW = FROZEN_NOW.getTime()

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(FROZEN_NOW) })
afterEach(() => { vi.useRealTimers() })

const base: InboxMessage = {
  id: '1', prospect_id: 'p1', direction: 'outbound', message_text: 'hey',
  message_type: 'dm', channel: 'linkedin', sent_at: null, approved_at: null,
  read_at: null, created_at: '2026-07-22T10:00:00Z', send_blocked_at: null,
  send_blocked_reason: null, unipile_chat_id: null, ai_model: null,
  prospect_name: 'A', prospect_company: null,
  prospect_headline: null, prospect_stage: 'replied', prospect_email: null,
  profile_photo_url: null, campaign_name: 'c', client_id: 'ivan',
  prospect_linkedin_url: 'https://www.linkedin.com/in/a', chat_provider_id: null,
  snoozed_until: null, snoozed_at: null,
}

const msg = (o: Partial<InboxMessage>): InboxMessage => ({ ...base, ...o })

/**
 * THE CORPUS THE SHORTCUT TEST RUNS AGAINST. Deliberately awkward: every lane,
 * both channels the Email chip has ever had to tell apart, a spam row, a
 * lead-magnet row, an outbound-only send echo (which no chip may ever show),
 * an unknown stage, and a thread whose LAST message is a LinkedIn DM but which
 * carries an email earlier in it — the exact row that separates `t.channel`
 * from `threadKind`.
 */
const rows: InboxMessage[] = [
  // p1 · ivan, linkedin, they replied, one unread
  msg({ id: 'a1', prospect_id: 'p1', direction: 'outbound', sent_at: '2026-07-10T09:00:00Z' }),
  msg({ id: 'a2', prospect_id: 'p1', direction: 'inbound', sent_at: '2026-07-20T09:00:00Z', read_at: null }),
  // p2 · risedtc, inmail, replied 20 days ago, read
  msg({ id: 'b1', prospect_id: 'p2', client_id: 'risedtc', channel: 'linkedin_inmail', message_type: 'inmail', direction: 'outbound', sent_at: '2026-07-01T09:00:00Z' }),
  msg({ id: 'b2', prospect_id: 'p2', client_id: 'risedtc', channel: 'linkedin_inmail', direction: 'inbound', sent_at: '2026-07-02T09:00:00Z', read_at: '2026-07-02T10:00:00Z' }),
  // p3 · arch, the last thing that RODE was an email
  msg({ id: 'c1', prospect_id: 'p3', client_id: 'arch', direction: 'inbound', sent_at: '2026-07-19T09:00:00Z', read_at: '2026-07-19T10:00:00Z', prospect_stage: 'dm_sent' }),
  msg({ id: 'c2', prospect_id: 'p3', client_id: 'arch', channel: 'email', direction: 'outbound', sent_at: '2026-07-21T09:00:00Z', prospect_stage: 'dm_sent' }),
  // p4 · ivan, an email EARLIER in the thread but a DM last. threadKind says
  // 'email'; the Email lane has never shown this row and must not start.
  msg({ id: 'd1', prospect_id: 'p4', channel: 'email', direction: 'outbound', sent_at: '2026-07-05T09:00:00Z' }),
  msg({ id: 'd2', prospect_id: 'p4', direction: 'inbound', sent_at: '2026-07-18T09:00:00Z', read_at: '2026-07-18T10:00:00Z' }),
  // p5 · a filed cold pitch
  msg({ id: 'e1', prospect_id: 'p5', direction: 'inbound', sent_at: '2026-07-15T09:00:00Z', read_at: null, prospect_skip_reason: 'inbound_vendor_pitch', prospect_stage: 'disqualified' }),
  // p6 · a lead-magnet delivery, outbound only
  msg({ id: 'f1', prospect_id: 'p6', ai_model: 'lm_gate_v1', direction: 'outbound', sent_at: '2026-07-17T09:00:00Z', prospect_stage: 'connection_sent' }),
  // p7 · a SEND ECHO. No inbound, no draft, not a magnet: no chip shows it.
  msg({ id: 'g1', prospect_id: 'p7', direction: 'outbound', sent_at: '2026-07-16T09:00:00Z', message_type: 'connection_note', prospect_stage: 'connection_sent' }),
  // p8 · arch, a PENDING DRAFT, and a stage this app has not been taught
  msg({ id: 'h1', prospect_id: 'p8', client_id: 'arch', direction: 'inbound', sent_at: '2026-07-21T08:00:00Z', read_at: null, prospect_stage: 'lunar_orbit' }),
  msg({ id: 'h2', prospect_id: 'p8', client_id: 'arch', direction: 'outbound', sent_at: null, created_at: '2026-07-21T09:00:00Z', prospect_stage: 'lunar_orbit' }),
]

const threads = groupThreads(rows)
const byId = (ts: { prospect_id: string }[]) => ts.map(t => t.prospect_id).sort()

/* ==========================================================================
   1 · Every field / operator pair, against a fixture
   ========================================================================== */

const t = (field: string, op: FilterToken['op'], value = ''): FilterToken[] =>
  [{ id: `x-${field}`, field, op, value }]

describe('DM fields — every field, every operator', () => {
  it('lane is / is not', () => {
    expect(byId(applyThreadTokens(threads, t('lane', 'is', 'arch'), NOW))).toEqual(['p3', 'p8'])
    expect(byId(applyThreadTokens(threads, t('lane', 'is', 'risedtc'), NOW))).toEqual(['p2'])
    expect(byId(applyThreadTokens(threads, t('lane', 'is not', 'ivan'), NOW))).toEqual(['p2', 'p3', 'p8'])
  })

  it('channel is / is not, and it is the channel the thread RODE', () => {
    // p3's last sent row is the email. p4 carries an email too, but it is not
    // what the conversation is riding, and the Email lane has never shown it.
    expect(byId(applyThreadTokens(threads, t('channel', 'is', 'email'), NOW))).toEqual(['p3'])
    expect(byId(applyThreadTokens(threads, t('channel', 'is', 'inmail'), NOW))).toEqual(['p2'])
    expect(byId(applyThreadTokens(threads, t('channel', 'is', 'dm'), NOW))).toEqual(['p1', 'p4', 'p6', 'p8'])
    expect(byId(applyThreadTokens(threads, t('channel', 'is not', 'dm'), NOW))).toEqual(['p2', 'p3'])
    const p4 = threads.find(x => x.prospect_id === 'p4')!
    expect(threadChannel(p4)).toBe('dm')
  })

  it('status is — and the field IS filterByStatus, not a second copy of it', () => {
    // The whole point of the `apply` escape hatch: 'needs' and 'all' are
    // predicates over a bucket, not values a row carries, and a second
    // definition here is how the bar and the list start disagreeing. Asserted
    // against the function itself rather than against ids, for every status.
    const lane = applyThreadTokens(threads, [], NOW)
    for (const s of ['needs', 'all', 'answer', 'approve', 'flagged', 'waiting'] as Status[]) {
      expect(byId(applyThreadTokens(threads, t('status', 'is', s), NOW)))
        .toEqual(byId(filterByStatus(lane, s)))
    }
    // And it really narrows: p8 owes a reply, p2 does not.
    expect(byId(applyThreadTokens(threads, t('status', 'is', 'answer'), NOW))).toEqual(['p1', 'p4', 'p8'])
    expect(byId(applyThreadTokens(threads, t('status', 'is', 'waiting'), NOW))).toEqual(['p2', 'p3', 'p6'])
    // 'all' admits the lead magnet even though the ball is with them.
    expect(applyThreadTokens(threads, t('status', 'is', 'all'), NOW).map(x => x.prospect_id)).toContain('p6')
  })

  it('stage is / is not, on the ladder and off it', () => {
    expect(byId(applyThreadTokens(threads, t('stage', 'is', 'replied'), NOW))).toEqual(['p1', 'p2', 'p4'])
    expect(byId(applyThreadTokens(threads, t('stage', 'is', 'messaged'), NOW))).toEqual(['p3'])
    expect(byId(applyThreadTokens(threads, t('stage', 'is', 'invited'), NOW))).toEqual(['p6'])
    // p8's stage is a word this app has not been taught; it answers NEITHER
    // side rather than being guessed onto a rung.
    expect(byId(applyThreadTokens(threads, t('stage', 'is not', 'replied'), NOW))).toEqual(['p3', 'p6'])
    // The off-ladder stages are reachable, and for p5 only inside the spam lane.
    const off = applyThreadTokens(threads, [
      ...t('spam', 'is', 'yes'), { id: 'z', field: 'stage', op: 'is', value: 'disqualified' },
    ], NOW)
    expect(byId(off)).toEqual(['p5'])
  })

  it('spam is yes / no, and yes is the ONLY way to see a filed pitch', () => {
    expect(byId(applyThreadTokens(threads, t('spam', 'is', 'yes'), NOW))).toEqual(['p5'])
    expect(applyThreadTokens(threads, t('spam', 'is', 'no'), NOW).map(x => x.prospect_id)).not.toContain('p5')
    expect(applyThreadTokens(threads, [], NOW).map(x => x.prospect_id)).not.toContain('p5')
  })

  it('draft has / has no', () => {
    expect(byId(applyThreadTokens(threads, t('draft', 'has'), NOW))).toEqual(['p8'])
    expect(byId(applyThreadTokens(threads, t('draft', 'has no'), NOW))).toEqual(['p1', 'p2', 'p3', 'p4', 'p6'])
  })

  it('unread has / has no', () => {
    expect(byId(applyThreadTokens(threads, t('unread', 'has'), NOW))).toEqual(['p1', 'p8'])
    expect(byId(applyThreadTokens(threads, t('unread', 'has no'), NOW))).toEqual(['p2', 'p3', 'p4', 'p6'])
  })

  it('last reply older than / newer than N days', () => {
    // Measured against the frozen clock (2026-07-22T20:00Z), not counted on
    // fingers: p8 1.5d, p1 2.46d, p3 3.46d, p4 4.46d, p2 20.46d. p6 never
    // replied at all.
    expect(byId(applyThreadTokens(threads, t('last reply', 'newer than', '4'), NOW))).toEqual(['p1', 'p3', 'p8'])
    expect(byId(applyThreadTokens(threads, t('last reply', 'newer than', '2'), NOW))).toEqual(['p8'])
    expect(byId(applyThreadTokens(threads, t('last reply', 'older than', '10'), NOW))).toEqual(['p2'])
    // A thread with no reply at all answers neither side.
    const none = applyThreadTokens(threads, t('last reply', 'older than', '0'), NOW).map(x => x.prospect_id)
    expect(none).not.toContain('p6')
  })

  it('lastReplyAt reads the newest INBOUND, not the newest row', () => {
    const p3 = threads.find(x => x.prospect_id === 'p3')!
    // p3's newest row is OUR email on the 21st; the reply is the 19th.
    expect(p3.last.id).toBe('c2')
    expect(lastReplyAt(p3)).toBe('2026-07-19T09:00:00Z')
  })

  it('lead magnet is yes / no', () => {
    expect(byId(applyThreadTokens(threads, t('lead magnet', 'is', 'yes'), NOW))).toEqual(['p6'])
    expect(byId(applyThreadTokens(threads, t('lead magnet', 'is', 'no'), NOW))).toEqual(['p1', 'p2', 'p3', 'p4', 'p8'])
  })

  it('a send echo is never shown by any token, including none at all', () => {
    for (const set of [[], t('lane', 'is', 'ivan'), t('draft', 'has no'), t('spam', 'is', 'yes')]) {
      expect(applyThreadTokens(threads, set, NOW).map(x => x.prospect_id)).not.toContain('p7')
    }
  })

  it('AND across tokens', () => {
    const both = applyThreadTokens(threads, [
      { id: '1', field: 'lane', op: 'is', value: 'arch' },
      { id: '2', field: 'draft', op: 'has', value: '' },
    ], NOW)
    expect(byId(both)).toEqual(['p8'])
  })

  it('a token naming a field this surface does not register narrows nothing', () => {
    expect(byId(applyThreadTokens(threads, t('sentiment', 'is', 'warm'), NOW)))
      .toEqual(byId(applyThreadTokens(threads, [], NOW)))
  })
})

/* ==========================================================================
   2 · The six chips: round trip, and the same rows the chip selected
   ========================================================================== */

const CHIP_FILTERS: Filter[] = ['all', 'ivan', 'risedtc', 'arch', 'email', 'spam']

describe('filterFromTokens round trip', () => {
  it('every one of the six chips writes a set that reads back as itself', () => {
    for (const f of CHIP_FILTERS) {
      expect(filterFromTokens(tokensForFilter(f))).toBe(f)
    }
  })

  it('the spam folder outranks a lane, and a lane outranks a channel', () => {
    expect(filterFromTokens([
      { id: '1', field: 'lane', op: 'is', value: 'arch' },
      { id: '2', field: 'spam', op: 'is', value: 'yes' },
    ])).toBe('spam')
    expect(filterFromTokens([
      { id: '1', field: 'channel', op: 'is', value: 'email' },
      { id: '2', field: 'lane', op: 'is', value: 'ivan' },
    ])).toBe('ivan')
  })

  it('a set with no lane, channel or spam in it is still the All lane', () => {
    expect(filterFromTokens([{ id: '1', field: 'unread', op: 'has', value: '' }])).toBe('all')
    // `is not` is not a lane selection: "not Arch" is two lanes, and the union
    // of two lanes has no name in the Filter type.
    expect(filterFromTokens([{ id: '1', field: 'lane', op: 'is not', value: 'arch' }])).toBe('all')
  })
})

describe('a chip shortcut selects exactly the rows its chip did', () => {
  for (const f of CHIP_FILTERS) {
    it(`${f}`, () => {
      expect(byId(applyThreadTokens(threads, tokensForFilter(f), NOW)))
        .toEqual(byId(filterThreads(threads, f)))
    })
  }

  it('and the corpus is not trivially empty for any of them', () => {
    for (const f of CHIP_FILTERS) {
      expect(filterThreads(threads, f).length).toBeGreaterThan(0)
    }
  })
})

describe('wantsSpam / hasStatusToken', () => {
  it('reads only an explicit spam-is-yes', () => {
    expect(wantsSpam(tokensForFilter('spam'))).toBe(true)
    expect(wantsSpam(t('spam', 'is', 'no'))).toBe(false)
    expect(wantsSpam([])).toBe(false)
  })
  it('says when the token set owns the status axis', () => {
    expect(hasStatusToken(t('status', 'is', 'approve'))).toBe(true)
    expect(hasStatusToken(t('lane', 'is', 'ivan'))).toBe(false)
  })
})

/* ==========================================================================
   3 · The grammar itself
   ========================================================================== */

describe('matchToken null rule', () => {
  const field = findField(DM_FIELDS, 'stage')!
  it('a row with no value answers neither is nor is not', () => {
    const p8 = threads.find(x => x.prospect_id === 'p8')!
    expect(field.of(p8)).toBe(null)
    expect(matchToken(field, p8, t('stage', 'is', 'replied')[0], NOW)).toBe(false)
    expect(matchToken(field, p8, t('stage', 'is not', 'replied')[0], NOW)).toBe(false)
  })
})

describe('newToken / valueLabel / tokenSentence', () => {
  it('a fresh enum token is born on its first value, never empty', () => {
    const lane = findField(DM_FIELDS, 'lane')!
    const tok = newToken(lane)
    expect(tok).toMatchObject({ field: 'lane', op: 'is', value: 'ivan' })
    expect(valueLabel(lane, tok)).toBe('Ivan')
    expect(tokenSentence(lane, tok)).toBe('lane is Ivan')
  })
  it('a flag token has no value slot and reads as the operator alone', () => {
    const draft = findField(DM_FIELDS, 'draft')!
    const tok = newToken(draft)
    expect(tok).toMatchObject({ field: 'draft', op: 'has', value: '' })
    expect(valueLabel(draft, tok)).toBe('')
    expect(tokenSentence(draft, tok)).toBe('draft has')
  })
  it('a days token starts at a week and says the unit', () => {
    const last = findField(DM_FIELDS, 'last reply')!
    const tok = newToken(last)
    expect(tok).toMatchObject({ field: 'last reply', op: 'older than', value: '7' })
    expect(valueLabel(last, tok)).toBe('7 days')
    expect(valueLabel(last, { ...tok, value: '1' })).toBe('1 day')
  })
})

/* ==========================================================================
   4 · Sales
   ========================================================================== */

describe('sales fields', () => {
  const row = { when: 'today', pack: true, report: false }
  it('when is / is not', () => {
    expect(salesRowMatches(row, t('when', 'is', 'today'))).toBe(true)
    expect(salesRowMatches(row, t('when', 'is', 'next'))).toBe(false)
    expect(salesRowMatches(row, t('when', 'is not', 'earlier'))).toBe(true)
  })
  it('pack has / has no — the question this surface was built to ask early', () => {
    expect(salesRowMatches(row, t('pack', 'has'))).toBe(true)
    expect(salesRowMatches(row, t('pack', 'has no'))).toBe(false)
    expect(salesRowMatches({ ...row, pack: false }, t('pack', 'has no'))).toBe(true)
  })
  it('report has / has no', () => {
    expect(salesRowMatches(row, t('report', 'has no'))).toBe(true)
    expect(salesRowMatches({ ...row, report: true }, t('report', 'has'))).toBe(true)
  })
  it('AND across sales tokens', () => {
    const rows2 = [row, { when: 'later', pack: false, report: false }]
    expect(applyTokens(rows2, SALES_FIELDS, [
      { id: '1', field: 'when', op: 'is', value: 'later' },
      { id: '2', field: 'pack', op: 'has no', value: '' },
    ])).toHaveLength(1)
  })
  it('an empty set narrows nothing', () => {
    expect(salesRowMatches(row, [])).toBe(true)
  })
})

/* ==========================================================================
   5 · Content — the tokens ARE the FilterState
   ========================================================================== */

describe('content facets as fields', () => {
  const facets = [
    { key: 'stage', label: 'Stage', options: [{ value: 'review', label: 'Review', n: 9 }, { value: 'idea', label: 'Idea', n: 4 }] },
    { key: 'pillar', label: 'Pillar', options: [{ value: 'moat', label: 'Moat', n: 3 }] },
  ]
  it('derives one is-only field per facet, in the facet order', () => {
    const fields = contentFields(facets)
    expect(fields.map(f => f.key)).toEqual(['stage', 'pillar'])
    expect(fields[0].label).toBe('stage')
    expect(fields[0].ops).toEqual(['is'])
    expect(fields[0].values).toEqual([
      { value: 'review', label: 'Review' }, { value: 'idea', label: 'Idea' },
    ])
  })
  it('a FilterState round trips through tokens unchanged', () => {
    const state = { stage: 'review', pillar: 'moat' }
    const toks = tokensFromFilterState(state, facets)
    expect(toks.map(x => [x.field, x.op, x.value])).toEqual([
      ['stage', 'is', 'review'], ['pillar', 'is', 'moat'],
    ])
    expect(filterStateFromTokens(toks)).toEqual(state)
  })
  it('an empty value is not a token, and a removed token is not a key', () => {
    expect(tokensFromFilterState({ stage: '' }, facets)).toEqual([])
    expect(filterStateFromTokens([{ id: '1', field: 'stage', op: 'is', value: '' }])).toEqual({})
  })
})
