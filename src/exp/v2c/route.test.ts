import { describe, expect, it } from 'vitest'
import { DEFAULT_ROUTE, parseWbHash, wbHash } from './route'

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
