import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { Linkified } from './Linkified'

function html(text: string): string {
  return renderToStaticMarkup(<>{Linkified({ text })}</>)
}

describe('Linkified', () => {
  it('prepends https:// to a bare domain link and keeps the visible text bare', () => {
    const out = html('see inboundonsteroids.com/scan/anthony-hodges-94/ here')
    expect(out).toContain('href="https://inboundonsteroids.com/scan/anthony-hodges-94/"')
    expect(out).toContain('>inboundonsteroids.com/scan/anthony-hodges-94/<')
    expect(out).toContain('target="_blank"')
  })
  it('leaves an existing https url scheme untouched', () => {
    const out = html('book https://calendly.com/im-ivanmanfredi/30min now')
    expect(out).toContain('href="https://calendly.com/im-ivanmanfredi/30min"')
    expect(out).not.toContain('href="https://https://')
  })
  it('renders plain text with no url as-is (no anchor)', () => {
    const out = html('just a normal sentence.')
    expect(out).not.toContain('<a ')
  })
})
