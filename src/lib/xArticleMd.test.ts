import { describe, expect, it } from 'vitest'
import { inline, spans, wordCount, xArticleBlocks } from './xArticleMd'

describe('inline (publisher port)', () => {
  it('turns **bold** into a style range on the stripped text', () => {
    expect(inline('a **big** deal')).toEqual({ text: 'a big deal', styles: [{ offset: 2, length: 3, style: 'bold' }], links: [] })
  })
  it('keeps several bold ranges, offsets counted on the output text', () => {
    const r = inline('**one** and **two**')
    expect(r.text).toBe('one and two')
    expect(r.styles).toEqual([{ offset: 0, length: 3, style: 'bold' }, { offset: 8, length: 3, style: 'bold' }])
  })
  it('drops an empty bold pair and leaves an unclosed one unstyled', () => {
    expect(inline('x****y')).toEqual({ text: 'xy', styles: [], links: [] })
    expect(inline('**open only')).toEqual({ text: 'open only', styles: [], links: [] })
  })
  it('turns [text](https://url) into a link range and keeps other brackets literal', () => {
    const r = inline('see [the docs](https://a.example/x) and [not a link](ftp://no)')
    expect(r.text).toBe('see the docs and [not a link](ftp://no)')
    expect(r.links).toEqual([{ offset: 4, length: 8, url: 'https://a.example/x' }])
  })
  it('bold around a link spans the link text', () => {
    const r = inline('**read [this](https://x.com/a)**')
    expect(r.text).toBe('read this')
    expect(r.styles).toEqual([{ offset: 0, length: 9, style: 'bold' }])
    expect(r.links).toEqual([{ offset: 5, length: 4, url: 'https://x.com/a' }])
    expect(spans(r)).toEqual([{ text: 'read ', bold: true, url: null }, { text: 'this', bold: true, url: 'https://x.com/a' }])
  })
})

describe('xArticleBlocks (toContentState port)', () => {
  const images = [{ slot: 1, url: 'https://cdn/1.jpg', alt: 'One' }, { slot: 2, url: null, alt: 'Missing' }]
  const md = [
    '**Lead line.**',
    '',
    '## Check 1. **Read** it',
    '# Top',
    '### Small',
    '- bullet [link](https://l.example)',
    '* star bullet',
    '1. first',
    '12. twelfth',
    '> quoted',
    '→ arrow line stays a paragraph',
    '{{IMAGE:1}}',
    '{{IMAGE:2}}',
    '{{IMAGE:3}}',
    '  {{IMAGE:1}}  ',
    'text {{IMAGE:1}}',
  ].join('\n')
  const blocks = xArticleBlocks(md, images)

  it('makes one block per non-empty line with the publisher types', () => {
    expect(blocks.map(b => b.type)).toEqual([
      'unstyled', 'header-two', 'header-two', 'header-three', 'unordered-list-item', 'unordered-list-item',
      'ordered-list-item', 'ordered-list-item', 'blockquote', 'unstyled', 'atomic', 'atomic', 'unstyled',
    ])
  })
  it('keeps the source line of each block', () => {
    expect(blocks.map(b => b.line)).toEqual([0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 14, 15])
  })
  it('bolds a paragraph and strips ** from headings', () => {
    expect(blocks[0]).toMatchObject({ text: 'Lead line.', styles: [{ offset: 0, length: 10, style: 'bold' }] })
    expect(blocks[1]).toMatchObject({ text: 'Check 1. Read it', styles: [] })
  })
  it('strips list and quote markers and keeps links', () => {
    expect(blocks[4]).toMatchObject({ text: 'bullet link', links: [{ offset: 7, length: 4, url: 'https://l.example' }] })
    expect(blocks[6].text).toBe('first')
    expect(blocks[7].text).toBe('twelfth')
    expect(blocks[8].text).toBe('quoted')
    expect(blocks[9].text).toBe('→ arrow line stays a paragraph')
  })
  it('resolves {{IMAGE:n}} to its slot and skips slots without a url', () => {
    const atomic = blocks.filter(b => b.type === 'atomic')
    expect(atomic).toHaveLength(2)
    expect(atomic[0].image).toEqual({ url: 'https://cdn/1.jpg', alt: 'One', slot: '1' })
    expect(atomic[0].text).toBe(' ')
    expect(blocks[12].text).toBe('text {{IMAGE:1}}')
  })
  it('survives empty input', () => {
    expect(xArticleBlocks('', null)).toEqual([])
  })
})

describe('spans', () => {
  it('splits overlapping bold and link ranges into runs', () => {
    const r = inline('a **b [c](https://u.example) d** e')
    expect(spans(r)).toEqual([
      { text: 'a ', bold: false, url: null },
      { text: 'b ', bold: true, url: null },
      { text: 'c', bold: true, url: 'https://u.example' },
      { text: ' d', bold: true, url: null },
      { text: ' e', bold: false, url: null },
    ])
  })
})

describe('wordCount', () => {
  it('counts whitespace-split tokens', () => {
    expect(wordCount('## A b\n\nc  d')).toBe(5)
  })
})
