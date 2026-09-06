import { describe, it, expect } from 'vitest'
import { splitBlocks, splitCells } from './md'
import { parseMarkdown } from '../../exp/v2c/chat/renderer'

// Every fixture here is invented. The repo is public and the real documents
// carry prospect names, so nothing measured off a real pack ever lands here.

describe('splitBlocks', () => {
  it('lifts a pipe table and keeps an escaped pipe inside the cell', () => {
    const src = [
      'Before the table.',
      '',
      '| Signal | Read |',
      '| --- | --- |',
      '| ships \\| holds | either one counts |',
      '| quiet | nothing yet |',
      '',
      'After the table.',
    ].join('\n')
    const out = splitBlocks(src)
    const table = out.find(c => c.t === 'table')
    expect(table).toBeTruthy()
    if (table?.t !== 'table') throw new Error('no table')
    expect(table.head).toEqual(['Signal', 'Read'])
    expect(table.rows).toHaveLength(2)
    expect(table.rows[0][0]).toBe('ships | holds')
    expect(table.rows[0][1]).toBe('either one counts')
    // The prose on both sides survives, in order.
    expect(out[0]).toMatchObject({ t: 'md' })
    expect(out[out.length - 1]).toMatchObject({ t: 'md' })
  })

  it('lifts a quote and leaves the list under it to the markdown parser', () => {
    const src = [
      '> they asked what it costs before they asked what it is',
      '',
      '- price is the second question',
      '- the build is the first one',
    ].join('\n')
    const out = splitBlocks(src)
    expect(out[0]).toEqual({ t: 'quote', text: 'they asked what it costs before they asked what it is' })
    expect(out[1].t).toBe('md')
    if (out[1].t !== 'md') throw new Error('no md chunk')
    const blocks = parseMarkdown(out[1].text)
    expect(blocks[0].t).toBe('ul')
    if (blocks[0].t !== 'ul') throw new Error('not a list')
    expect(blocks[0].items).toHaveLength(2)
  })

  it('passes a document with no tables and no quotes through as one md chunk', () => {
    const src = '## Where it stands\n\nOne paragraph.\n\n- one\n- two\n'
    const out = splitBlocks(src)
    expect(out).toHaveLength(1)
    expect(out[0].t).toBe('md')
  })

  it('yields the first heading text on a heading-first document', () => {
    const src = '# Call sheet\n\nA line of prose.\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n'
    const out = splitBlocks(src)
    expect(out[0].t).toBe('md')
    if (out[0].t !== 'md') throw new Error('no md chunk')
    const first = parseMarkdown(out[0].text)[0]
    expect(first.t).toBe('h')
    if (first.t !== 'h') throw new Error('not a heading')
    expect(first.nodes.map(n => n.v).join('')).toBe('Call sheet')
    expect(out.some(c => c.t === 'table')).toBe(true)
  })

  it('never reads a pipe inside a fence as a table', () => {
    const src = '```\n| not | a table |\n| --- | --- |\n```\n'
    const out = splitBlocks(src)
    expect(out.every(c => c.t === 'md')).toBe(true)
  })
})

describe('splitCells', () => {
  it('drops the outer pipes and trims every cell', () => {
    expect(splitCells('|  one |two  | three |')).toEqual(['one', 'two', 'three'])
  })
  it('reads a row written without outer pipes', () => {
    expect(splitCells('one | two')).toEqual(['one', 'two'])
  })
})
