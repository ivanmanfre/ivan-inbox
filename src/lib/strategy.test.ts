import { describe, expect, it } from 'vitest'
import {
  addSection, blankCount, moveSection, removeSection, sectionIsBlank, updateSection,
  type StrategySection,
} from './strategy'

const s = (key: string, body = 'written'): StrategySection => ({ key, title: key, body })

describe('section edits', () => {
  it('never mints a duplicate key, so React cannot reuse the wrong textarea', () => {
    // add, remove the original, add again — the naive `note` / `note-2` counter
    // that keys off length would hand out `note` twice here.
    let rows = addSection([s('a')], null)
    expect(rows.map(r => r.key)).toEqual(['a', 'note'])
    rows = addSection(rows, null)
    rows = removeSection(rows, 'note')
    rows = addSection(rows, null)
    expect(new Set(rows.map(r => r.key)).size).toBe(rows.length)
  })

  it('inserts directly after the section the + was pressed on', () => {
    const rows = addSection([s('a'), s('b'), s('c')], 'a')
    expect(rows.map(r => r.key)).toEqual(['a', 'note', 'b', 'c'])
  })

  it('appends when the anchor is gone rather than dropping the section', () => {
    const rows = addSection([s('a')], 'missing')
    expect(rows.map(r => r.key)).toEqual(['a', 'note'])
  })

  it('moves within bounds and is a no-op at the ends', () => {
    const rows = [s('a'), s('b'), s('c')]
    expect(moveSection(rows, 'b', -1).map(r => r.key)).toEqual(['b', 'a', 'c'])
    expect(moveSection(rows, 'a', -1)).toBe(rows)
    expect(moveSection(rows, 'c', 1)).toBe(rows)
  })

  it('patches only the named section and does not mutate the input', () => {
    const rows = [s('a'), s('b')]
    const out = updateSection(rows, 'b', { body: 'new' })
    expect(out[1].body).toBe('new')
    expect(rows[1].body).toBe('written')
  })
})

describe('blank detection', () => {
  // This is what the head counts, and the count is the whole point of the tab:
  // "how much of this client am I still flying". A seeded TODO must read as
  // unwritten, or a freshly seeded lane would claim to be fully documented.
  it('treats empty, bare TODO and seeded TODO prefaces as unwritten', () => {
    expect(sectionIsBlank(s('a', ''))).toBe(true)
    expect(sectionIsBlank(s('a', '   \n '))).toBe(true)
    expect(sectionIsBlank(s('a', 'TODO'))).toBe(true)
    expect(sectionIsBlank(s('a', 'TODO — fill in his buyer'))).toBe(true)
    expect(sectionIsBlank(s('a', 'TODO - fill in his buyer'))).toBe(true)
  })

  it('does not count real text that merely mentions a todo', () => {
    expect(sectionIsBlank(s('a', 'Ship the case study. TODO after that.'))).toBe(false)
  })

  it('counts across the document', () => {
    expect(blankCount([s('a', ''), s('b'), s('c', 'TODO')])).toBe(2)
  })
})
