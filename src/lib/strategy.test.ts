import { describe, expect, it } from 'vitest'
import {
  addSection, blankCount, isCaps, lineShape, moveSection, removeSection, sectionIsBlank,
  updateSection, type StrategySection,
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

describe('line shapes — the typeset render', () => {
  it('heads a group when the run before the dash is caps', () => {
    expect(lineShape('BUYERS — 1 post of 5')).toEqual({ kind: 'head', label: 'BUYERS', rest: '1 post of 5' })
    // digits and separators must not disqualify a heading
    expect(lineShape('1 · THE INSTRUMENTED LANE — 2 a week').kind).toBe('head')
    expect(lineShape('TRUST + REACH — 4 of 5. Pains his feed has barely touched:').kind).toBe('head')
    expect(lineShape('EASE OFF')).toEqual({ kind: 'head', label: 'EASE OFF', rest: '' })
  })

  it('labels a decision when the run before the dash is not caps', () => {
    expect(lineShape('Store — Shopify / Woo')).toEqual({ kind: 'kv', label: 'Store', rest: 'Shopify / Woo' })
  })

  it('keeps a bullet whole even when it contains the separator', () => {
    // Checked before the dash split, or "61 calls · 94 public · 1 post" would be
    // promoted to a value and the pain itself demoted to a bold label.
    expect(lineShape('- Which ad actually made the sale — 61 calls · 94 public · 1 post'))
      .toEqual({ kind: 'item', text: 'Which ad actually made the sale — 61 calls · 94 public · 1 post' })
  })

  it('needs two letters to call something caps, so a stray A heads nothing', () => {
    expect(isCaps('A')).toBe(false)
    expect(isCaps('OK')).toBe(true)
    expect(isCaps('Mix')).toBe(false)
  })

  it('treats a blank line as a gap and anything else as prose', () => {
    expect(lineShape('   ')).toEqual({ kind: 'gap' })
    expect(lineShape('5 posts a week. No lead magnets.').kind).toBe('text')
  })

  it('does not split on a leading separator', () => {
    expect(lineShape(' — orphan').kind).toBe('text')
  })
})
