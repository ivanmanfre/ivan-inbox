import { describe, expect, it } from 'vitest'
import { blockWords, parseInline, parseMarkdown } from './renderer'

describe('parseInline', () => {
  it('reads inline code, bold and italic', () => {
    expect(parseInline('use `useId()` for **every** topic')).toEqual([
      { t: 'text', v: 'use ' },
      { t: 'code', v: 'useId()' },
      { t: 'text', v: ' for ' },
      { t: 'strong', v: 'every' },
      { t: 'text', v: ' topic' },
    ])
    expect(parseInline('_soft_')).toEqual([{ t: 'em', v: 'soft' }])
  })

  it('prefers the double marker so bold never reads as two italics', () => {
    expect(parseInline('**bold**')).toEqual([{ t: 'strong', v: 'bold' }])
  })

  it('leaves an unterminated marker literal — mid-stream text always has one', () => {
    expect(parseInline('a **partial')).toEqual([{ t: 'text', v: 'a **partial' }])
    expect(parseInline('half `code')).toEqual([{ t: 'text', v: 'half `code' }])
  })

  it('autolinks bare urls but not urls inside code', () => {
    expect(parseInline('see https://x.dev/a, ok')).toEqual([
      { t: 'text', v: 'see ' },
      { t: 'link', v: 'https://x.dev/a', href: 'https://x.dev/a' },
      { t: 'text', v: ', ok' },
    ])
    expect(parseInline('`https://x.dev`')).toEqual([{ t: 'code', v: 'https://x.dev' }])
  })

  it('never emits HTML, only data', () => {
    const nodes = parseInline('<img src=x onerror=alert(1)>')
    expect(nodes).toEqual([{ t: 'text', v: '<img src=x onerror=alert(1)>' }])
  })
})

describe('parseMarkdown', () => {
  it('splits paragraphs on blank lines and joins wrapped lines', () => {
    const b = parseMarkdown('one\nstill one\n\ntwo')
    expect(b).toHaveLength(2)
    expect(b[0]).toEqual({ t: 'p', nodes: [{ t: 'text', v: 'one still one' }] })
  })

  it('reads headings and both list flavours', () => {
    const b = parseMarkdown('## Title\n- a\n- b\n\n1. first\n2. second')
    expect(b[0]).toMatchObject({ t: 'h', level: 2 })
    expect(b[1]).toMatchObject({ t: 'ul', ordered: false })
    expect(b[2]).toMatchObject({ t: 'ul', ordered: true })
    expect((b[1] as { items: unknown[] }).items).toHaveLength(2)
  })

  it('continues a wrapped list item instead of starting a paragraph', () => {
    const b = parseMarkdown('- one line\n  wrapped on')
    expect(b).toHaveLength(1)
    expect(b[0]).toEqual({ t: 'ul', ordered: false, items: [[{ t: 'text', v: 'one line wrapped on' }]] })
  })

  it('marks an unclosed fence open so a streaming block renders as it fills', () => {
    const closed = parseMarkdown('```sql\nselect 1;\n```')
    expect(closed[0]).toEqual({ t: 'code', lang: 'sql', text: 'select 1;', open: false })
    const streaming = parseMarkdown('```ts\nconst a =')
    expect(streaming[0]).toMatchObject({ t: 'code', lang: 'ts', open: true })
  })

  it('does not format inside a fence', () => {
    const b = parseMarkdown('```\n**not bold**\n```')
    expect(b[0]).toMatchObject({ text: '**not bold**' })
  })

  it('counts words across every block kind', () => {
    expect(blockWords(parseMarkdown('a b\n\n- c d\n\n```\ne f\n```'))).toBe(6)
  })
})
