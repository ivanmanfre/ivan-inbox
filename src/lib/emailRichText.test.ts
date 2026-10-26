import { describe, expect, it } from 'vitest'
import { defaultEmailSignature, plainEmailDocument, renderEmailComposition, renderEmailDocument, stripLegacyEmailSignature, type EmailRichNode } from './emailRichText'

const paragraph = (text: string): EmailRichNode => ({ type: 'paragraph', content: [{ type: 'text', text }] })

describe('restricted rich email renderer', () => {
  it('escapes text and preserves custom link destinations in both alternatives', () => {
    const body: EmailRichNode = { type: 'doc', content: [{ type: 'paragraph', content: [
      { type: 'text', text: 'Read <this> & ' },
      { type: 'text', text: 'the brief', marks: [{ type: 'link', attrs: { href: 'https://example.com/x?a=1&b=2' } }, { type: 'bold' }] },
    ] }] }
    const result = renderEmailDocument(body)
    expect(result.html).toContain('Read &lt;this&gt; &amp; ')
    expect(result.html).toContain('href="https://example.com/x?a=1&amp;b=2"')
    expect(result.html).toContain('<strong><a href=')
    expect(result.text).toBe('Read <this> & the brief (https://example.com/x?a=1&b=2)')
  })

  it('keeps one destination for a link split by formatting marks', () => {
    const doc: EmailRichNode = { type: 'doc', content: [{ type: 'paragraph', content: [
      { type: 'text', text: 'the ', marks: [{ type: 'link', attrs: { href: 'https://example.com/brief' } }] },
      { type: 'text', text: 'brief', marks: [{ type: 'link', attrs: { href: 'https://example.com/brief' } }, { type: 'bold' }] },
    ] }] }
    expect(renderEmailDocument(doc).text).toBe('the brief (https://example.com/brief)')
  })

  it('rejects unsafe URLs and unsupported content or attributes', () => {
    const bad: EmailRichNode[] = [
      { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'go', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }] }] },
      { type: 'doc', content: [{ type: 'html', text: '<img src=x onerror=alert(1)>' }] },
      { type: 'doc', content: [{ type: 'paragraph', attrs: { onclick: 'x' }, content: [] }] },
      { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'code' }] }] }] },
    ]
    for (const doc of bad) expect(() => renderEmailDocument(doc)).toThrow()
  })

  it('limits nesting and document size', () => {
    let nested: EmailRichNode = paragraph('hello')
    for (let i = 0; i < 30; i++) nested = { type: 'blockquote', content: [nested] }
    expect(() => renderEmailDocument({ type: 'doc', content: [nested] })).toThrow()
    expect(() => renderEmailDocument({ type: 'doc', content: [paragraph('a'.repeat(100_001))] })).toThrow()
  })

  it('renders blocks, breaks, and lists as meaningful plain text', () => {
    const doc: EmailRichNode = { type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'First' }, { type: 'hardBreak' }, { type: 'text', text: 'second' }] },
      { type: 'orderedList', attrs: { start: 3 }, content: [
        { type: 'listItem', content: [paragraph('Apples')] },
        { type: 'listItem', content: [paragraph('Pears')] },
      ] },
      { type: 'bulletList', content: [{ type: 'listItem', content: [paragraph('One')] }] },
    ] }
    expect(renderEmailDocument(doc).text).toBe('First\nsecond\n\n3. Apples\n4. Pears\n\n- One')
  })

  it('indents nested list items in the plain alternative', () => {
    const doc: EmailRichNode = { type: 'doc', content: [{ type: 'bulletList', content: [{ type: 'listItem', content: [
      paragraph('Main'),
      { type: 'bulletList', content: [{ type: 'listItem', content: [paragraph('Nested')] }] },
    ] }] }] }
    expect(renderEmailDocument(doc).text).toBe('- Main\n  - Nested')
  })

  it('accepts Tiptap empty paragraphs and empty root documents', () => {
    expect(renderEmailDocument({ type: 'doc', content: [{ type: 'paragraph' }] }).text).toBe('')
    expect(renderEmailDocument({ type: 'doc', content: [] }).text).toBe('')
  })

  it('autolinks complete web URLs without swallowing punctuation', () => {
    const result = renderEmailDocument(plainEmailDocument('See https://example.com/a?x=1&y=2, then write.'))
    expect(result.html).toContain('href="https://example.com/a?x=1&amp;y=2"')
    expect(result.text).toBe('See https://example.com/a?x=1&y=2, then write.')
  })

  it('renders body and a separate signature once', () => {
    const signature = defaultEmailSignature('Davorin Šmit <davorin@madebyarch.com>')
    expect(signature).not.toBeNull()
    const result = renderEmailComposition({ version: 1, source_text: 'Subject: Hi\n\nHello', body: { type: 'doc', content: [paragraph('Hello')] }, signature })
    expect(result.text).toBe('Hello\n\nDavorin Šmit\nARCH\narch.agency (https://arch.agency)')
    expect(result.html.match(/Davorin Šmit/g)).toHaveLength(1)
    expect(result.html).toContain('https://arch.agency')
  })

  it('only strips verified matching trailing signatures', () => {
    expect(stripLegacyEmailSignature('Hello\n\nCheers,\nDavorin Šmit\nARCH\narch.agency', 'davorin@madebyarch.com')).toBe('Hello')
    expect(stripLegacyEmailSignature('Hello\n\nCheers,\nMattan Danino\nRISE\nrisedtc.com', 'davorin@madebyarch.com')).toContain('Mattan Danino')
    expect(stripLegacyEmailSignature('I discussed ARCH with Davorin.', 'davorin@madebyarch.com')).toBe('I discussed ARCH with Davorin.')
    expect(defaultEmailSignature('other@example.com')).toBeNull()
  })

  it('strips the sender first name plus verified company after a closing', () => {
    expect(stripLegacyEmailSignature('Hello\n\nBest regards\n\nDavorin\nARCH   ', 'davorin@madebyarch.com')).toBe('Hello')
    expect(stripLegacyEmailSignature('Hello\n\nThanks,\nMattan\nRISE DTC\nhttps://risedtc.com/\n', 'itsmattan@risedtc.com')).toBe('Hello')
    expect(stripLegacyEmailSignature('Hello\n\nBest regards\n\nDavorin\nOther Company', 'davorin@madebyarch.com')).toContain('Davorin')
  })
})
