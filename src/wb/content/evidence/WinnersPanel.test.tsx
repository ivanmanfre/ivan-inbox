import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
vi.mock('../../../lib/supabase', () => ({ supabase: {} }))
import { WinnersPanel } from './WinnersPanel'
import { fixturePack } from '../../../lib/contentEvidence.fixtures'
import { buildWinners, type WinnersRead } from '../../../lib/contentEvidence'

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
const beforeDetails = (html: string) => html.split('<details')[0]
const afterDetails = (html: string) => html.split('<details').slice(1).join('<details')

const failedView: WinnersRead = {
  state: 'failed', message: 'unknown seat', clientId: 'ivan', market: [], own: [], asOf: null,
}

describe('audit: a raw technical message never reaches the visible failed banner', () => {
  it('"unknown seat" appears only after the Details disclosure', () => {
    const html = renderToStaticMarkup(<WinnersPanel view={failedView} />)
    expect(text(beforeDetails(html))).not.toContain('unknown seat')
    expect(text(beforeDetails(html))).toContain('The evidence read failed.')
    expect(text(afterDetails(html))).toContain('unknown seat')
  })
})

describe('WinnersPanel, the state marker', () => {
  it('carries [data-testid="reader-state"] with the matching data-state in every state', () => {
    for (const view of [
      failedView,
      buildWinners(fixturePack('ivan', 'empty')),
      buildWinners(fixturePack('ivan', 'ready')),
      buildWinners(fixturePack('ivan', 'partial')),
      buildWinners(fixturePack('ivan', 'stale')),
    ]) {
      const html = renderToStaticMarkup(<WinnersPanel view={view} />)
      expect(html).toContain('data-testid="reader-state"')
      expect(html).toContain(`data-state="${view.state}"`)
    }
  })
})

describe('WinnersPanel, market/own separation', () => {
  it('renders two explicitly separated sections, Market examples and Our results', () => {
    const html = text(renderToStaticMarkup(<WinnersPanel view={buildWinners(fixturePack('ivan', 'ready'))} />))
    expect(html).toContain('Market examples')
    expect(html).toContain('Our results')
    expect(html.indexOf('Market examples')).toBeLessThan(html.indexOf('Our results'))
  })

  it('never prints an own-account row next to a market lift figure ("x own baseline")', () => {
    const view = buildWinners(fixturePack('ivan', 'ready'))
    const html = renderToStaticMarkup(<WinnersPanel view={view} />)
    const ownSection = html.split('Our results')[1] ?? ''
    // The own section's own comparison language never carries an "Nx" lift
    // multiple, because an own-account row structurally has none to print.
    expect(ownSection).not.toMatch(/\d+(\.\d+)?x observed vs/)
  })

  it('a low-sample market row is flagged Small sample and a legacy row is flagged Legacy method', () => {
    const html = text(renderToStaticMarkup(<WinnersPanel view={buildWinners(fixturePack('ivan', 'partial'))} />))
    expect(html).toContain('Small sample')
    expect(html).toContain('Legacy method')
  })

  it('a thin-coverage (partial) read still shows its individual rows, never zero', () => {
    const view = buildWinners(fixturePack('ivan', 'partial'))
    expect(view.market.length).toBeGreaterThan(0)
    const html = text(renderToStaticMarkup(<WinnersPanel view={view} />))
    expect(html).toContain('pattern claim')
  })
})
