import { describe, it, expect } from 'vitest'
import { readProspect, auditUrl, prettify } from './Prospect'

// Invented prospect. The repo is public; no real slug, name, company, domain or
// line of a real pack appears in this file.
const FIXTURE = JSON.stringify({
  name: 'Sample Person · Sample Co',
  when: 'Mon Sep 7 · 11:00 UTC',
  facts: ['ships weekly', 'two people on content', 'no paid media'],
  table: {
    title: 'Where the reach comes from',
    head: ['Surface', 'Posts', 'Median'],
    rows: [['Feed', '18', '410'], ['Newsletter', '4', '1,900']],
  },
  table_note: 'Median, not mean: one outlier owns the average.',
  walk: 'Open on what they already ship, then the gap.',
  phases: {
    frame: { add: ['name the gap out loud'], note: 'ninety seconds, no longer' },
    context_qualify: { drop: ['the tooling tour'], lines: { opener: 'what changed this quarter' } },
    close: { skip: 'no price this call' },
  },
  insert: [{ after: 'frame', name: 'The proof read', minutes: 4, lines: ['walk one page'], note: 'only if asked' }],
  proof: 'https://inboundonsteroids.com/shared/sample-co',
  their_site: 'https://example.com/about',
})

describe('readProspect', () => {
  it('maps every named section of a well-formed file', () => {
    const v = readProspect(FIXTURE)
    expect(v.ok).toBe(true)
    expect(v.error).toBe('')
    expect(v.facts).toHaveLength(3)
    expect(v.table?.head).toEqual(['Surface', 'Posts', 'Median'])
    expect(v.table?.rows).toHaveLength(2)
    expect(v.tableNote).toContain('Median')
    expect(v.walk).toContain('Open on')
  })

  it('keeps the phases in file order and reads each of the four phase shapes', () => {
    const v = readProspect(FIXTURE)
    expect(v.phases.map(([k]) => k)).toEqual(['frame', 'context_qualify', 'close'])
    const [, frame] = v.phases[0]
    expect(frame.add).toEqual(['name the gap out loud'])
    expect(frame.note).toContain('ninety seconds')
    const [, qualify] = v.phases[1]
    expect(qualify.drop).toEqual(['the tooling tour'])
    expect(qualify.lines).toEqual({ opener: 'what changed this quarter' })
    const [, close] = v.phases[2]
    expect(close.skip).toBe('no price this call')
  })

  it('reads an insert with its minutes as a number', () => {
    const v = readProspect(FIXTURE)
    expect(v.inserts).toHaveLength(1)
    expect(v.inserts[0].name).toBe('The proof read')
    expect(v.inserts[0].minutes).toBe(4)
    expect(v.inserts[0].lines).toEqual(['walk one page'])
    expect(v.inserts[0].after).toBe('frame')
  })

  it('returns the raw text and one error on malformed JSON, and never throws', () => {
    const v = readProspect('{ "name": "half a file"')
    expect(v.ok).toBe(false)
    expect(v.error).not.toBe('')
    expect(v.raw).toContain('half a file')
    expect(v.facts).toEqual([])
    expect(v.phases).toEqual([])
  })

  it('survives a file whose keys are the wrong types', () => {
    const v = readProspect(JSON.stringify({ facts: 'not a list', table: 7, phases: [1, 2], insert: 'no' }))
    expect(v.ok).toBe(true)
    expect(v.facts).toEqual([])
    expect(v.table).toBeNull()
    expect(v.phases).toEqual([])
    expect(v.inserts).toEqual([])
  })

  it('collects every url in the document, deduplicated, in document order', () => {
    const v = readProspect(FIXTURE)
    expect(v.urls).toEqual([
      'https://inboundonsteroids.com/shared/sample-co',
      'https://example.com/about',
    ])
  })
})

describe('auditUrl', () => {
  it('picks the proof-domain url over an unrelated one', () => {
    expect(auditUrl(readProspect(FIXTURE))).toBe('https://inboundonsteroids.com/shared/sample-co')
  })
  it('accepts a url that qualifies on its path alone', () => {
    const v = readProspect(JSON.stringify({ link: 'https://example.com/reports/audit-2026' }))
    expect(auditUrl(v)).toBe('https://example.com/reports/audit-2026')
  })
  it('returns null when nothing in the file looks like an audit', () => {
    const v = readProspect(JSON.stringify({ link: 'https://example.com/pricing' }))
    expect(auditUrl(v)).toBeNull()
  })
})

describe('prettify', () => {
  it('says a snake_case key out loud', () => {
    expect(prettify('context_qualify')).toBe('Context qualify')
    expect(prettify('outbound-upsell')).toBe('Outbound upsell')
    expect(prettify('')).toBe('')
  })
})
