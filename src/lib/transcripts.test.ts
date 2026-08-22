import { describe, it, expect } from 'vitest'
import {
  actionItems, callStats, callTitle, callTopics, hasOpenBusiness, leadLine, owedByMe,
  ownerIsMine, parseAgentItem, people, rankCalls, segmentCalls, splitBody,
  type CallRow,
} from './transcripts'

const NOW = new Date('2026-08-22T12:00:00Z')

const row = (over: Partial<CallRow> = {}): CallRow => ({
  id: 't1', title: 'A call', date: '2026-08-21T10:00:00+00:00',
  duration_minutes: 30, participants: [], summary: null,
  action_items: null, topics: null, follow_up_draft: null, follow_up_sent: false,
  source: 'fireflies', meeting_type: null, brief: null, ...over,
})

// The live shape: jsonb array of JSON STRINGS, not objects.
const AI = (o: Record<string, unknown>) => JSON.stringify(o)

describe('parseAgentItem', () => {
  it('parses the stringified-object shape the extractor actually writes', () => {
    const p = parseAgentItem(AI({ owner: 'Ivan', action: 'Send the link', deadline: null }))
    expect(p.owner).toBe('Ivan')
    expect(p.action).toBe('Send the link')
  })
  it('accepts a real object too', () => {
    expect(parseAgentItem({ action: 'x' }).action).toBe('x')
  })
  it('keeps a plain non-JSON string as the action rather than dropping it', () => {
    expect(parseAgentItem('just do the thing').action).toBe('just do the thing')
  })
  it('does not throw on a string that starts like JSON and is not', () => {
    expect(parseAgentItem('{broken').action).toBe('{broken')
  })
  it('returns an empty record for null', () => {
    expect(parseAgentItem(null as unknown as string)).toEqual({})
  })
})

describe('actionItems', () => {
  it('reads action, owner, due and why off the stringified shape', () => {
    const items = actionItems(row({
      action_items: [AI({ owner: 'Client', action: 'Sign up for the tool', deadline: 'Friday', context: 'so we can start' })],
    }))
    expect(items).toHaveLength(1)
    expect(items[0]).toEqual({
      action: 'Sign up for the tool', owner: 'Client', mine: false,
      due: 'Friday', why: 'so we can start',
    })
  })
  it('skips an element with no readable action instead of rendering an empty row', () => {
    expect(actionItems(row({ action_items: [AI({ owner: 'Ivan' }), AI({ action: 'real' })] })))
      .toHaveLength(1)
  })
  it('is empty for null, which is 84 of the 96 rows', () => {
    expect(actionItems(row())).toEqual([])
  })
  it('falls back through the alternate action keys', () => {
    expect(actionItems(row({ action_items: [AI({ task: 'from task key' })] }))[0].action)
      .toBe('from task key')
  })
  it('treats whitespace-only fields as absent, not as an empty label', () => {
    const items = actionItems(row({ action_items: [AI({ action: 'a', owner: '   ', deadline: '' })] }))
    expect(items[0].owner).toBeNull()
    expect(items[0].due).toBeNull()
  })
})

describe('ownerIsMine', () => {
  it('matches the owner value the extractor writes for Ivan, case folded', () => {
    expect(ownerIsMine('Ivan')).toBe(true)
    expect(ownerIsMine(' ivan ')).toBe(true)
    expect(ownerIsMine('Ivan Manfredi')).toBe(true)
  })
  it('does not claim the other side of the call', () => {
    expect(ownerIsMine('Client')).toBe(false)
    expect(ownerIsMine('Mattan')).toBe(false)
    expect(ownerIsMine(null)).toBe(false)
  })
  it('does not substring-match a longer name that merely contains ivan', () => {
    expect(ownerIsMine('Ivanka Petrov')).toBe(false)
  })
})

describe('owedByMe', () => {
  it('counts only the items whose owner is Ivan', () => {
    const r = row({ action_items: [
      AI({ owner: 'Ivan', action: 'a' }), AI({ owner: 'Client', action: 'b' }), AI({ owner: 'Ivan', action: 'c' }),
    ] })
    expect(owedByMe(r)).toBe(2)
    expect(actionItems(r)).toHaveLength(3)
  })
})

describe('callTopics', () => {
  it('reads the extracted content topic and its format', () => {
    const t = callTopics(row({ topics: [AI({ title: 'Posting more suppresses reach', post_format: 'Carousel', status: 'POST-READY' })] }))
    expect(t[0].title).toBe('Posting more suppresses reach')
    expect(t[0].format).toBe('Carousel')
    expect(t[0].status).toBe('POST-READY')
  })
  it('drops an element with no title', () => {
    expect(callTopics(row({ topics: [AI({ post_format: 'Carousel' })] }))).toEqual([])
  })
})

describe('people', () => {
  it('drops Google Calendar room resources, which are furniture and not attendees', () => {
    expect(people([
      'davorinsmit@arch.agency',
      'c_1886b651hfvjsh7fi4o0fbvbe8baq@resource.calendar.google.com',
      'Mattan Danino',
    ])).toEqual(['davorinsmit@arch.agency', 'Mattan Danino'])
  })
  it('drops blanks and trims', () => {
    expect(people(['  Matt Moore ', '', '   '])).toEqual(['Matt Moore'])
  })
  it('handles a null column', () => {
    expect(people(null)).toEqual([])
  })
})

describe('splitBody', () => {
  it('leaves a plain transcript alone', () => {
    expect(splitBody('  Ivan: hello\nThem: hi  ')).toEqual({ spoken: 'Ivan: hello\nThem: hi', screen: null })
  })
  it('splits the screen narration off the end of the spoken part', () => {
    const out = splitBody('Ivan: hello\n--- SCREEN CONTEXT ---\nthey opened the dashboard')
    expect(out.spoken).toBe('Ivan: hello')
    expect(out.screen).toBe('they opened the dashboard')
  })
  it('returns null screen when the marker has nothing after it', () => {
    expect(splitBody('Ivan: hello\n--- SCREEN CONTEXT ---\n   ').screen).toBeNull()
  })
})

describe('callStats', () => {
  it('matches the four numbers the old surface printed', () => {
    const rows = [
      row({ id: 'a', date: '2026-08-21T10:00:00Z', duration_minutes: 40, action_items: [AI({ action: 'x' })] }),
      row({ id: 'b', date: '2026-08-20T10:00:00Z', duration_minutes: 20 }),
      row({ id: 'c', date: '2026-06-01T10:00:00Z', duration_minutes: 60 }),
    ]
    expect(callStats(rows, NOW)).toEqual({ total: 3, week: 2, withActions: 1, meanMinutes: 40 })
  })
  it('reports zero rather than NaN on an empty archive', () => {
    expect(callStats([], NOW)).toEqual({ total: 0, week: 0, withActions: 0, meanMinutes: 0 })
  })
  it('treats a null duration as zero rather than skipping the row from the mean', () => {
    expect(callStats([row({ duration_minutes: null }), row({ id: 'b', duration_minutes: 40 })], NOW).meanMinutes).toBe(20)
  })
})

describe('rankCalls', () => {
  it('puts unfinished business first even when it is older', () => {
    const fresh = row({ id: 'fresh', date: '2026-08-22T09:00:00Z' })
    const old = row({ id: 'old', date: '2026-05-01T09:00:00Z', action_items: [AI({ action: 'owed' })] })
    expect(rankCalls([fresh, old]).map(r => r.id)).toEqual(['old', 'fresh'])
  })
  it('is newest first inside each group', () => {
    const rows = [
      row({ id: 'n1', date: '2026-08-01T09:00:00Z' }),
      row({ id: 'a1', date: '2026-07-01T09:00:00Z', action_items: [AI({ action: 'x' })] }),
      row({ id: 'n2', date: '2026-08-10T09:00:00Z' }),
      row({ id: 'a2', date: '2026-07-20T09:00:00Z', action_items: [AI({ action: 'y' })] }),
    ]
    expect(rankCalls(rows).map(r => r.id)).toEqual(['a2', 'a1', 'n2', 'n1'])
  })
  it('does not mutate the array it was given', () => {
    const rows = [row({ id: 'a' }), row({ id: 'b', date: '2026-08-22T09:00:00Z' })]
    rankCalls(rows)
    expect(rows.map(r => r.id)).toEqual(['a', 'b'])
  })
  it('sorts an unparseable date last rather than throwing', () => {
    const bad = row({ id: 'bad', date: 'not a date' })
    const good = row({ id: 'good', date: '2026-08-01T09:00:00Z' })
    expect(rankCalls([bad, good]).map(r => r.id)).toEqual(['good', 'bad'])
  })
})

describe('hasOpenBusiness', () => {
  it('is false for a row whose action_items array is present but empty', () => {
    expect(hasOpenBusiness(row({ action_items: [] }))).toBe(false)
  })
  it('is false for a row whose only item has no readable action', () => {
    expect(hasOpenBusiness(row({ action_items: [AI({ owner: 'Ivan' })] }))).toBe(false)
  })
})

describe('segmentCalls', () => {
  const rows = [
    row({ id: 'openOld', date: '2026-01-01T09:00:00Z', action_items: [AI({ action: 'x' })] }),
    row({ id: 'quietNew', date: '2026-08-20T09:00:00Z' }),
    row({ id: 'quietOld', date: '2026-02-01T09:00:00Z' }),
  ]
  it('open keeps only the rows with something left to do', () => {
    expect(segmentCalls(rows, 'open', NOW).map(r => r.id)).toEqual(['openOld'])
  })
  it('recent is the last seven days and still ranks inside itself', () => {
    expect(segmentCalls(rows, 'recent', NOW).map(r => r.id)).toEqual(['quietNew'])
  })
  it('all is everything, ranked', () => {
    expect(segmentCalls(rows, 'all', NOW).map(r => r.id)).toEqual(['openOld', 'quietNew', 'quietOld'])
  })
})

describe('leadLine', () => {
  it('leads with the next step when the brief has one', () => {
    expect(leadLine(row({
      summary: 'we talked', brief: { next_step: 'send pricing', objections: ['too dear'] },
      action_items: [AI({ owner: 'Ivan', action: 'send pricing' })],
    }))).toEqual({ kind: 'next', text: 'send pricing' })
  })
  it('falls to an objection before an action item', () => {
    expect(leadLine(row({
      summary: 'we talked', brief: { objections: ['too dear'] },
      action_items: [AI({ owner: 'Ivan', action: 'send pricing' })],
    }))).toEqual({ kind: 'objection', text: 'too dear' })
  })
  it('prefers the item Ivan owes over the first item in the array', () => {
    expect(leadLine(row({
      action_items: [AI({ owner: 'Client', action: 'they do this' }), AI({ owner: 'Ivan', action: 'I do this' })],
    }))).toEqual({ kind: 'action', text: 'I do this' })
  })
  it('uses the first item when none of them is Ivan', () => {
    expect(leadLine(row({ action_items: [AI({ owner: 'Client', action: 'they do this' })] })))
      .toEqual({ kind: 'action', text: 'they do this' })
  })
  it('falls all the way to the summary', () => {
    expect(leadLine(row({ summary: 'we talked' }))).toEqual({ kind: 'summary', text: 'we talked' })
  })
  it('returns null rather than inventing a line, which is the common case', () => {
    expect(leadLine(row())).toBeNull()
  })
  it('skips a blank objection entry instead of leading with an empty string', () => {
    expect(leadLine(row({ summary: 'we talked', brief: { objections: ['  ', ''] } })))
      .toEqual({ kind: 'summary', text: 'we talked' })
  })
})

describe('callTitle', () => {
  it('strips the trailing separator a recorder left behind', () => {
    expect(callTitle('Shantanu Verma and Ivan Manfredi /')).toBe('Shantanu Verma and Ivan Manfredi')
  })
  it('names a row whose title is nothing but that separator, which renders blank otherwise', () => {
    expect(callTitle(' / ')).toBe('Untitled call')
  })
  it('names a blank and a null title', () => {
    expect(callTitle('')).toBe('Untitled call')
    expect(callTitle(null)).toBe('Untitled call')
  })
  it('leaves a real title alone, including an internal slash', () => {
    expect(callTitle('RISE DTC // Mace & Mattan')).toBe('RISE DTC // Mace & Mattan')
  })
})
