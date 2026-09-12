import { describe, it, expect } from 'vitest'
import { matchScore, rankCommands, ROW_GROUP_CAP, type Rankable } from './commandRank'

// The band order the palette renders in. Kept literal here rather than imported
// from commandSource so a reordering there has to be looked at, not absorbed.
const ORDER = ['Move', 'Select', 'Act', 'Thread', 'Claude', 'Go', 'People', 'Open']

const c = (id: string, title: string, group: string, search?: string): Rankable =>
  ({ id, title, group, search })

const VOCAB: Rankable[] = [
  c('m1', 'Next row', 'Move'),
  c('m2', 'Search this list', 'Move'),
  c('s1', 'Select every row in this tab', 'Select'),
  c('s2', 'Clear the selection', 'Select'),
  c('t1', 'Push this conversation to later', 'Thread'),
  c('cl1', 'New Claude thread', 'Claude'),
  c('g1', 'Go to Today', 'Go'),
  c('g2', 'Go to Sales', 'Go'),
  c('g3', 'Go to Claude', 'Go'),
]

const person = (n: number, name: string, company = '') =>
  c(`person.p${n}`, `Open ${name}`, 'People', company)

const ids = (rows: Rankable[]) => rows.map(r => r.id)

describe('matchScore — the four classes, in the order the move asks for', () => {
  it('an empty query answers every row equally', () => {
    for (const x of VOCAB) expect(matchScore('', x)).toBe(0)
    expect(matchScore('   ', VOCAB[0])).toBe(0)
  })

  it('a verb the query is the head of scores best', () => {
    expect(matchScore('go to s', c('g', 'Go to Sales', 'Go'))).toBe(0)
  })

  it('a word of the verb starting with the query beats a mid-word hit', () => {
    const prefix = matchScore('sal', c('g', 'Go to Sales', 'Go'))
    const middle = matchScore('ale', c('g', 'Go to Sales', 'Go'))
    expect(prefix).toBe(1)
    expect(middle).toBe(2)
    expect(prefix!).toBeLessThan(middle!)
  })

  it('the company is matched as a word prefix without being in the verb', () => {
    const p = person(1, 'Kemal Atdayev', 'Northbeam')
    expect(matchScore('north', p)).toBe(1)
    expect(p.title).not.toContain('Northbeam')
  })

  it('tokens in any order are the LAST resort, not the first', () => {
    const x = c('s', 'Select every row in this tab', 'Select')
    expect(matchScore('tab row', x)).toBe(3)
    // …and it still answers, which is the point: whole-string matching returned
    // ZERO for "model haiku" against "/model claude-haiku-4-5" (ChatPane), and
    // a palette that matches nothing is a palette Enter falls through.
    expect(matchScore('tab row', x)).not.toBeNull()
  })

  it('a query nothing answers is null, not a low score', () => {
    expect(matchScore('zzzz', c('g', 'Go to Sales', 'Go'))).toBeNull()
  })
})

describe('rankCommands — bands in order, relevance inside them', () => {
  it('an empty query returns the vocabulary exactly as written', () => {
    expect(ids(rankCommands('', VOCAB, { order: ORDER }))).toEqual(ids(VOCAB))
  })

  it('the best answer in a band is first, not the one declared first', () => {
    // 🔴 THE DEFECT THIS FUNCTION EXISTS FOR. `matchWbCommands` was a filter:
    // every survivor came back in the order buildCommands pushed it, so the
    // row that best answered what was typed was wherever the registry happened
    // to have put it. Here 'sales' is a word prefix in the first two (1) and
    // the HEAD of the third (0) — and the third is declared last.
    const band = [
      c('g1', 'Go to Today, then Sales', 'Go'),
      c('g2', 'Go to Ops after Sales', 'Go'),
      c('g3', 'Sales, this week', 'Go'),
    ]
    expect(ids(rankCommands('sales', band, { order: ORDER }))).toEqual(['g3', 'g1', 'g2'])
  })

  it('a verb always outranks a person, whoever matched better', () => {
    const rows = [...VOCAB, person(1, 'Claude Bernard')]
    const out = ids(rankCommands('claude', rows, { order: ORDER }))
    expect(out.indexOf('cl1')).toBeLessThan(out.indexOf('person.p1'))
    expect(out.indexOf('g3')).toBeLessThan(out.indexOf('person.p1'))
  })

  it('inside a band, a prefix beats a substring beats a token scatter', () => {
    const band = [
      c('a', 'Go to Ops', 'Go'),
      c('b', 'Salvage the lane', 'Go'),
      c('c', 'Sales, go', 'Go'),
      c('d', 'Go to Sales', 'Go'),
    ]
    // 'sal' → 'Salvage…' and 'Sales, go' are title prefixes (0, in declaration
    // order), 'Go to Sales' is a word prefix (1), 'Go to Ops' does not match.
    expect(ids(rankCommands('sal', band, { order: ORDER }))).toEqual(['b', 'c', 'd'])
  })

  it('caps the two data-shaped bands at eight and caps nothing else', () => {
    const many = Array.from({ length: 40 }, (_, i) => person(i, `Person ${i}`))
    const out = rankCommands('', [...VOCAB, ...many], { order: ORDER })
    expect(out.filter(r => r.group === 'People')).toHaveLength(ROW_GROUP_CAP)
    // 🔴 The vocabulary never shrinks. Three Go rows in, three Go rows out.
    expect(out.filter(r => r.group === 'Go')).toHaveLength(3)
    expect(out.filter(r => r.group === 'Move')).toHaveLength(2)
  })

  it('the eight it keeps are the eight that answered best', () => {
    const many = [
      person(1, 'Alan Bzedov'), person(2, 'Bella Bzedov'), person(3, 'Carl Bzedov'),
      person(4, 'Dana Bzedov'), person(5, 'Eli Bzedov'), person(6, 'Fay Bzedov'),
      person(7, 'Gus Bzedov'), person(8, 'Hal Bzedov'), person(9, 'Zed Himself'),
    ]
    const out = rankCommands('zed', many, { order: ORDER })
    expect(out).toHaveLength(ROW_GROUP_CAP)
    // 'Open Zed Himself' is the only WORD PREFIX hit; the other eight carry
    // 'zed' inside a surname. The capped band keeps the BEST eight, not the
    // first eight — cap the unsorted list and the one person he typed for is
    // the one row that falls off the bottom.
    expect(out[0].id).toBe('person.p9')
  })

  it('a group nobody named lands after every named one', () => {
    const out = ids(rankCommands('', [c('u', 'Unbanded', 'Nowhere'), ...VOCAB], { order: ORDER }))
    expect(out[out.length - 1]).toBe('u')
  })

  it('no match returns nothing — the caller renders a sentence, not a fallback row', () => {
    expect(rankCommands('qqqq', VOCAB, { order: ORDER })).toEqual([])
  })
})
