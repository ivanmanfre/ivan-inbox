import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { Markdown } from './Markdown'
import { Prospect } from './Prospect'

// The renderers, driven end to end on invented documents. G6 asserts the same
// four facts in a real browser; this catches them one commit earlier, for free.

const MD = [
  '# Call sheet',
  '',
  'A **bold** claim and a [link](https://example.com/one).',
  '',
  '> a quoted line',
  '',
  '| Signal | Read |',
  '| --- | --- |',
  '| ships \\| holds | either |',
  '',
  '- first',
  '- second',
  '',
  '```',
  'code here',
  '```',
].join('\n')

const JSON_FIXTURE = JSON.stringify({
  name: 'Sample Person', facts: ['one', 'two'],
  table: { title: 'Signals', head: ['a', 'b'], rows: [['1', '2']] },
  table_note: 'a note', walk: 'walk text',
  phases: { frame: { add: ['say it'], drop: ['the tour'], note: 'short' }, close: { skip: 'no price' } },
  insert: [{ name: 'Proof', minutes: 3, lines: ['walk one page'] }],
})

describe('sales renderers', () => {
  it('renders every markdown shape without throwing', () => {
    const html = renderToStaticMarkup(<Markdown src={MD} label="Call sheet" />)
    expect(html).toContain('Call sheet')
    expect(html).toContain('<strong>bold</strong>')
    expect(html).toContain('rel="noopener noreferrer"')
    expect(html).toContain('ds-table')
    expect(html).toContain('ships | holds')
    expect(html).toContain('a-pk-quote')
    expect(html).toContain('code here')
  })

  it('renders the prospect view with the raw fold closed', () => {
    const html = renderToStaticMarkup(<Prospect json={JSON_FIXTURE} />)
    expect(html).toContain('Facts')
    expect(html).toContain('Signals')
    expect(html).toContain('walk text')
    expect(html).toContain('Frame')
    expect(html).toContain('Close')
    expect(html).toContain('Raw JSON')
    expect(html).toContain('aria-expanded="false"')
    // The raw body stays behind the disclosure until it is opened.
    expect(html).not.toContain('&quot;walk&quot;:')
  })

  it('falls back to the raw text on malformed json', () => {
    const html = renderToStaticMarkup(<Prospect json="{ not json" />)
    expect(html).toContain('a-sev-urgent')
    expect(html).toContain('not json')
  })
})
