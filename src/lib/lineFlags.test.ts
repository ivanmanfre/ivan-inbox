import { describe, expect, it } from 'vitest'
import { cutLine, lineFlagsOf, needsKeep } from './lineFlags'

const body = 'Just back from a wonderful weekend in Kraków.\n\nIt is hard to walk those streets.\n\nThe numbers are remarkable.'
const lf = {
  lines: [
    { text: 'Just back from a wonderful weekend in Kraków.', kind: 'personal', ask: 'Was this your weekend?' },
    { text: 'Just back from a wonderful weekend in Kraków.', kind: 'dated', ask: 'Were you in Kraków that weekend?' },
    { text: 'A line Ivan already cut.', kind: 'personal', ask: 'x' },
  ],
  lines_sha: 'abc',
}

describe('lineFlagsOf', () => {
  it('merges one line flagged twice, prefers the dated ask, drops lines no longer in the text', () => {
    const f = lineFlagsOf(lf, body)!
    expect(f.lines).toHaveLength(1)
    expect(f.lines[0].kinds).toEqual(['personal', 'dated'])
    expect(f.lines[0].ask).toBe('Were you in Kraków that weekend?')
  })
  it('is null with nothing to show (no lines in the text, no failing re-run)', () => {
    expect(lineFlagsOf({ lines: [], rerun: null }, body)).toBeNull()
    expect(lineFlagsOf({ lines: [], rerun: { pass: true, impressions: 2033 } }, body)).toBeNull()
    expect(lineFlagsOf(null, body)).toBeNull()
  })
  it('carries a failing re-run', () => {
    const f = lineFlagsOf({ rerun: { pass: false, impressions: 89, bar: 170, posted_at: '2026-09-30T10:51:44Z', boosted: false } }, 'Owning 100%')!
    expect(f.rerun).toMatchObject({ impressions: 89, bar: 170, boosted: false })
  })
})

describe('needsKeep', () => {
  const f = lineFlagsOf(lf, body)
  it('asks until the exact text is kept', () => {
    expect(needsKeep(f, 'sha1')).toBe(true)
    expect(needsKeep({ ...f!, keptSha: 'sha1' }, 'sha1')).toBe(false)
    expect(needsKeep({ ...f!, keptSha: 'old' }, 'sha1')).toBe(true)
    expect(needsKeep(null, 'sha1')).toBe(false)
  })
})

describe('cutLine', () => {
  it('cuts a whole line with its break', () => {
    expect(cutLine(body, 'Just back from a wonderful weekend in Kraków.')).toBe('It is hard to walk those streets.\n\nThe numbers are remarkable.')
    expect(cutLine(body, 'It is hard to walk those streets.')).toBe('Just back from a wonderful weekend in Kraków.\n\nThe numbers are remarkable.')
  })
  it('cuts a sentence inside a line and keeps one space', () => {
    expect(cutLine('i see a lot of ppl. i have been there 5 times. it is nice', 'i have been there 5 times.')).toBe('i see a lot of ppl. it is nice')
  })
  it('leaves the body alone when the line is gone', () => {
    expect(cutLine(body, 'not here')).toBe(body)
  })
})
