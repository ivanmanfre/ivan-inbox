import { describe, expect, it } from 'vitest'
import { groundedOnLine, sessionStateLine, sourceBasename, sourceBasenames, sourceSummaryClause, sourcesChipLabel } from './brainMeta'

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

// The shape a REAL turn carries: one memory file, the summary date, the
// assembler's own block ids, and its `auto` bookkeeping row. Only the file is
// a memory file, and only the file may be printed.
const LIVE_SOURCES = [
  { kind: 'memory', path: 'project/MEMORY.md' },
  { kind: 'summary', path: '2026-09-02' },
  { kind: 'block', path: 'B14-header' },
  { kind: 'block', path: 'B5' },
  { kind: 'block', path: 'B4' },
  { kind: 'block', path: 'B10a' },
  { kind: 'block', path: 'B10b' },
  { kind: 'block', path: 'P16' },
  { kind: 'block', path: 'P15' },
  { kind: 'file', path: 'auto' },
]

describe('a live turn row', () => {
  it('counts only the memory files', () => {
    expect(sourcesChipLabel(LIVE_SOURCES)).toBe('read 1 memory file')
  })
  it('lists only the memory files, so no block id reaches the DOM', () => {
    const out = sourceBasenames(LIVE_SOURCES)
    expect(out).toEqual(['MEMORY.md'])
    expect(out.join(' · ')).not.toMatch(/P15|P16|B14|auto/)
  })
  it('puts the summary date in its own clause', () => {
    expect(sourceSummaryClause(LIVE_SOURCES)).toBe('grounded on 2026-09-02')
  })
  it('never prints a shell blob a container pushed as a source', () => {
    const blob = { kind: 'memory', path: 'curl -H "apikey: $KEY" claude_memory' }
    expect(sourceBasenames([blob])).toEqual([])
    expect(sourcesChipLabel([blob])).toBeNull()
  })
  it('says nothing at all when no file was read', () => {
    expect(sourcesChipLabel([{ kind: 'block', path: 'P15' }, { kind: 'file', path: 'auto' }])).toBeNull()
    expect(sourceSummaryClause([{ kind: 'block', path: 'P15' }])).toBeNull()
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
  it('says fresh when the thread has turns but has never held a session', () => {
    expect(sessionStateLine(null)).toMatch(/fresh/i)
  })
  it('says continuing once the thread has', () => {
    expect(sessionStateLine('2026-09-04T10:00:00Z')).toMatch(/continuing/i)
  })
  it('agrees with the last turn saying it resumed, even before the thread flag is written', () => {
    expect(sessionStateLine(null, 'resumed')).toMatch(/continuing/i)
  })
  it('agrees with the thread flag even when the last turn opened a new session', () => {
    expect(sessionStateLine('2026-09-04T10:00:00Z', 'new')).toMatch(/continuing/i)
  })
  it('claims nothing on a thread with no turns yet', () => {
    expect(sessionStateLine(null, null, false)).toBe('New thread. Nothing carries over yet.')
  })
})
