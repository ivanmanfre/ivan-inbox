import { describe, expect, it } from 'vitest'
import { groundedOnLine, sessionStateLine, sourceBasename, sourceBasenames, sourcesChipLabel } from './brainMeta'

describe('sourceBasename', () => {
  it('takes the last path segment', () => {
    expect(sourceBasename('memory/global/brand-visual-system.md')).toBe('brand-visual-system.md')
  })
  it('handles a bare filename', () => {
    expect(sourceBasename('MEMORY.md')).toBe('MEMORY.md')
  })
})

describe('sourcesChipLabel', () => {
  it('is null with no sources', () => {
    expect(sourcesChipLabel([])).toBeNull()
    expect(sourcesChipLabel(undefined)).toBeNull()
  })
  it('singular for one source', () => {
    expect(sourcesChipLabel([{ kind: 'memory', path: 'a.md' }])).toBe('read 1 memory file')
  })
  it('plural for more than one', () => {
    expect(sourcesChipLabel([{ kind: 'memory', path: 'a.md' }, { kind: 'memory', path: 'b.md' }])).toBe('read 2 memory files')
  })
})

describe('sourceBasenames', () => {
  it('deduplicates while preserving order', () => {
    const out = sourceBasenames([
      { kind: 'memory', path: 'x/a.md' }, { kind: 'memory', path: 'y/a.md' }, { kind: 'memory', path: 'z/b.md' },
    ])
    expect(out).toEqual(['a.md', 'b.md'])
  })
})

describe('groundedOnLine', () => {
  it('is null with no date', () => {
    expect(groundedOnLine(null)).toBeNull()
  })
  it('names the date when present', () => {
    expect(groundedOnLine('2026-09-02')).toBe('Grounded on memory from 2026-09-02')
  })
})

describe('sessionStateLine', () => {
  it('says fresh when the thread has never held a session', () => {
    expect(sessionStateLine(null)).toMatch(/fresh/i)
  })
  it('says continuing once the thread has', () => {
    expect(sessionStateLine('2026-09-04T10:00:00Z')).toMatch(/continuing/i)
  })
})
