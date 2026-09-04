import { describe, expect, it } from 'vitest'
import { DEFAULT_ROUTE, parseWbHash, prefixOf, wbHash } from './route'

// The winner-apply build moved from #exp/v2c to #exp/v2 and kept v2c readable so
// tournament-era ballot links do not 404. Both halves of that are asserted here,
// because "the old link still works" is exactly the kind of claim that rots.

describe('parseWbHash', () => {
  it('defaults to DMs with nothing focused', () => {
    expect(parseWbHash('#exp/v2')).toEqual(DEFAULT_ROUTE)
  })

  it('reads a job off the trailing path', () => {
    expect(parseWbHash('#exp/v2/content')).toEqual({ job: 'content', focus: null })
    expect(parseWbHash('#exp/v2/magnets')).toEqual({ job: 'magnets', focus: null })
    expect(parseWbHash('#exp/v2/ops')).toEqual({ job: 'ops', focus: null })
    // Strategy joined the work group 2026-08-19. A job is only addressable
    // because JOBS lists it — the tab would render and still 404 on reload if
    // this half were missed.
    expect(parseWbHash('#exp/v2/strategy')).toEqual({ job: 'strategy', focus: null })
    expect(wbHash('strategy', null)).toBe('#exp/v2/strategy')
    // Money joined 2026-09-01 (goal-run money-truth). Same shape as Strategy —
    // a whole-canvas job, not a list — so it needs the identical fresh-load
    // coverage: JOBS already lists it, so route.ts needs no edit at all, but
    // that guarantee is only real if a test pins it.
    expect(parseWbHash('#exp/v2/money')).toEqual({ job: 'money', focus: null })
    expect(wbHash('money', null)).toBe('#exp/v2/money')
  })

  it('reads a focused chat peer', () => {
    expect(parseWbHash('#exp/v2/dms/chat')).toEqual({ job: 'dms', focus: 'chat' })
  })

  it('treats a bare /chat as chat over the default job', () => {
    expect(parseWbHash('#exp/v2/chat')).toEqual({ job: 'dms', focus: 'chat' })
  })

  it('still reads the tournament-era v2c links', () => {
    expect(parseWbHash('#exp/v2c')).toEqual(DEFAULT_ROUTE)
    expect(parseWbHash('#exp/v2c/sends')).toEqual({ job: 'sends', focus: null })
    expect(parseWbHash('#exp/v2c/dms/chat')).toEqual({ job: 'dms', focus: 'chat' })
  })

  // The Inbox job was absorbed into DMs on 2026-08-03. A bookmark, an open tab
  // or a ballot link on either retired id must land on the surface that now
  // holds those rows — NOT 404, and not "the default happens to be right".
  it('redirects the retired inbox and drafts jobs to DMs', () => {
    expect(parseWbHash('#exp/v2/inbox')).toEqual({ job: 'dms', focus: null })
    expect(parseWbHash('#exp/v2/drafts')).toEqual({ job: 'dms', focus: null })
    expect(parseWbHash('#exp/v2/inbox/chat')).toEqual({ job: 'dms', focus: 'chat' })
    expect(parseWbHash('#exp/v2c/drafts/chat')).toEqual({ job: 'dms', focus: 'chat' })
    // and the alias is never written back out
    expect(wbHash('dms', null)).toBe('#exp/v2/dms')
  })

  it('falls back rather than throwing on an unknown job', () => {
    expect(parseWbHash('#exp/v2/nope')).toEqual(DEFAULT_ROUTE)
  })

  it('falls back on a hash that is not this experiment', () => {
    expect(parseWbHash('#today')).toEqual(DEFAULT_ROUTE)
    expect(parseWbHash('#exp/a')).toEqual(DEFAULT_ROUTE)
  })
})

describe('wbHash', () => {
  it('only ever writes the canonical v2 id', () => {
    expect(wbHash('content', null)).toBe('#exp/v2/content')
    expect(wbHash('dms', 'chat')).toBe('#exp/v2/dms/chat')
    // A context peer's key is a database id; it is deliberately not addressable.
    expect(wbHash('dms', 'thread:abc')).toBe('#exp/v2/dms')
  })

  it('round-trips through parseWbHash', () => {
    expect(parseWbHash(wbHash('ops', null))).toEqual({ job: 'ops', focus: null })
    expect(parseWbHash(wbHash('dms', 'chat'))).toEqual({ job: 'dms', focus: 'chat' })
  })
})

// db/049 made three things addressable: a thread, a turn inside it, and the
// feed. A push notification's url is one of these strings, so what it parses to
// is what Ivan lands on when he taps it at a traffic light.
describe('deep links', () => {
  const TH = '11111111-1111-4111-8111-111111111111'
  const TU = '22222222-2222-4222-8222-222222222222'

  it('reads a thread and a turn off the query', () => {
    expect(parseWbHash(`#exp/v2/dms?thread=${TH}&turn=${TU}`))
      .toEqual({ job: 'dms', focus: null, thread: TH, turn: TU })
  })

  it('reads them with a focus segment in the way', () => {
    expect(parseWbHash(`#exp/v2/dms/chat?thread=${TH}`))
      .toEqual({ job: 'dms', focus: 'chat', thread: TH })
  })

  it('reads the feed flag', () => {
    expect(parseWbHash('#exp/v2/ops?feed=1')).toEqual({ job: 'ops', focus: null, feed: true })
    expect(parseWbHash('#exp/v2/ops?feed=true')).toEqual({ job: 'ops', focus: null, feed: true })
    // Anything else is not the feed. `feed=0` must not open it.
    expect(parseWbHash('#exp/v2/ops?feed=0')).toEqual({ job: 'ops', focus: null })
  })

  it('drops an id that is not one rather than issuing a query for it', () => {
    expect(parseWbHash('#exp/v2/dms?thread=../../etc&turn=1')).toEqual({ job: 'dms', focus: null })
  })

  it('leaves an ordinary hash exactly as it parsed before', () => {
    // The whole contract of this change: the new fields are absent, not
    // undefined-but-present, so every existing caller is untouched.
    expect(parseWbHash('#exp/v2/content')).toEqual({ job: 'content', focus: null })
    expect(Object.keys(parseWbHash('#exp/v2/content'))).toEqual(['job', 'focus'])
  })

  it('does not mistake a query for a job or a focus', () => {
    expect(parseWbHash('#exp/v2?feed=1')).toEqual({ job: 'dms', focus: null, feed: true })
    expect(parseWbHash('#exp/v2/chat?feed=1')).toEqual({ job: 'dms', focus: 'chat', feed: true })
  })
})

// The three tournament candidates mount behind their own experiment ids. They
// share this grammar, and each one has to keep writing its OWN prefix back or it
// navigates out of itself on the first tab click.
describe('the brain-candidate prefixes', () => {
  it('reads the same job / focus / query grammar', () => {
    expect(parseWbHash('#exp/brain-a/content?feed=1'))
      .toEqual({ job: 'content', focus: null, feed: true })
    expect(parseWbHash('#exp/brain-b/dms/chat')).toEqual({ job: 'dms', focus: 'chat' })
    expect(parseWbHash('#exp/brain-c')).toEqual(DEFAULT_ROUTE)
    expect(parseWbHash('#exp/brain-c/inbox')).toEqual({ job: 'dms', focus: null })
  })

  it('writes back the prefix the page was loaded with', () => {
    expect(wbHash('content', null, 'brain-a')).toBe('#exp/brain-a/content')
    expect(wbHash('dms', 'chat', 'brain-c')).toBe('#exp/brain-c/dms/chat')
    // Default stays the shipped surface, so nothing that omits the argument moves.
    expect(wbHash('content', null)).toBe('#exp/v2/content')
  })

  it('prefixOf rewrites the read-only v2c shim to v2 and passes a candidate through', () => {
    expect(prefixOf('#exp/brain-a/content?feed=1')).toBe('brain-a')
    expect(prefixOf('#exp/brain-b')).toBe('brain-b')
    expect(prefixOf('#exp/v2c/dms')).toBe('v2')
    expect(prefixOf('#exp/v2/dms')).toBe('v2')
    expect(prefixOf('')).toBe('v2')
    // Not a candidate id, however much it looks like one.
    expect(prefixOf('#exp/brain-d/dms')).toBe('v2')
    expect(prefixOf('#exp/brain-ax/dms')).toBe('v2')
  })
})

describe('ask deep link', () => {
  it('#exp/v2/ask?thread=… focuses chat over the default job and keeps the ids', () => {
    const r = parseWbHash('#exp/v2/ask?thread=e53d8fb8-382c-43fd-87a9-f0f668f408d4&turn=0b3e74fc-d702-4a3b-9984-7549b1eb0148')
    expect(r.job).toBe('dms')
    expect(r.focus).toBe('chat')
    expect(r.thread).toBe('e53d8fb8-382c-43fd-87a9-f0f668f408d4')
    expect(r.turn).toBe('0b3e74fc-d702-4a3b-9984-7549b1eb0148')
  })
})
