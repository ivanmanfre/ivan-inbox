import { describe, expect, it } from 'vitest'
import {
  basename, groundedClause, memorySources, printablePath, sourceBasenames, sourcesChipLabel,
  summaryDate,
} from './brainMeta'
import type { TurnSource } from '../../../lib/turns'

/**
 * The live row shape the copy seat measured on `inbox_turns_v`: one real memory
 * file, one summary, five envelope block ids, one placeholder, one blob. The
 * chip used to count all of them ("read 10 memory files") and expand to a list
 * of internal identifiers.
 */
const LIVE: TurnSource[] = [
  { kind: 'memory', path: '/Users/ivanmanfredi/.claude/memory/MEMORY.md' },
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

describe('the sources chip counts only memory files', () => {
  it('reads one memory file out of the live ten-source row', () => {
    expect(sourcesChipLabel(LIVE)).toBe('read 1 memory file')
  })

  it('lists only that file, so no internal block id reaches the DOM', () => {
    const names = sourceBasenames(LIVE)
    expect(names).toEqual(['MEMORY.md'])
    expect(names.join(' · ')).not.toMatch(/P15|P16|B14|auto/)
  })

  it('names the summary in its own clause and never as a file', () => {
    expect(summaryDate(LIVE)).toBe('2026-09-02')
    expect(groundedClause(LIVE)).toBe('grounded on 2026-09-02')
    expect(sourcesChipLabel(LIVE)).not.toMatch(/2026-09-02/)
  })

  it('pluralises off the memory count', () => {
    const two: TurnSource[] = [
      { kind: 'memory', path: 'memory/MEMORY.md' },
      { kind: 'brain', path: 'memory/global/voice.md' },
      { kind: 'block', path: 'P15' },
    ]
    expect(sourcesChipLabel(two)).toBe('read 2 memory files')
    expect(sourceBasenames(two)).toEqual(['MEMORY.md', 'voice.md'])
  })

  it('says nothing rather than "read 0 memory files"', () => {
    expect(sourcesChipLabel([])).toBeNull()
    expect(sourcesChipLabel([{ kind: 'block', path: 'P15' }])).toBeNull()
    expect(sourcesChipLabel(undefined)).toBeNull()
    expect(groundedClause([])).toBeNull()
  })

  it('drops a value carrying whitespace, whatever kind claims it', () => {
    const blob: TurnSource[] = [
      { kind: 'memory', path: 'curl -s "https://example.test" | jq .rows' },
      { kind: 'memory', path: '' },
      { kind: 'memory', path: 'memory/MEMORY.md' },
    ]
    expect(memorySources(blob)).toHaveLength(1)
    expect(sourcesChipLabel(blob)).toBe('read 1 memory file')
    expect(printablePath('a b')).toBe(false)
    expect(printablePath('a/b.md')).toBe(true)
  })

  it('counts one file once, however many times the run opened it', () => {
    const dupes: TurnSource[] = [
      { kind: 'memory', path: '/one/MEMORY.md' },
      { kind: 'memory', path: '/two/MEMORY.md' },
    ]
    expect(sourcesChipLabel(dupes)).toBe('read 1 memory file')
  })

  it('basename survives a bare name', () => {
    expect(basename('MEMORY.md')).toBe('MEMORY.md')
    expect(basename('a/b/c.md')).toBe('c.md')
  })
})
