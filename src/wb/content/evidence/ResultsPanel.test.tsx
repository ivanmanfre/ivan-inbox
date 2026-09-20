import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
vi.mock('../../../lib/supabase', () => ({ supabase: {} }))
import { ResultsPanel } from './ResultsPanel'
import { fixturePack } from '../../../lib/contentEvidence.fixtures'
import { buildResults, type ResultsRead } from '../../../lib/contentEvidence'

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

const failedView: ResultsRead = {
  state: 'failed', message: 'network error', clientId: 'ivan', choices: [], priorFailures: [], asOf: null,
}

describe('ResultsPanel, the state marker', () => {
  it('carries [data-testid="reader-state"] with the matching data-state in every state', () => {
    for (const view of [
      failedView,
      buildResults(fixturePack('ivan', 'empty')),
      buildResults(fixturePack('ivan', 'ready')),
      buildResults(fixturePack('ivan', 'partial')),
      buildResults(fixturePack('ivan', 'stale')),
    ]) {
      const html = renderToStaticMarkup(<ResultsPanel view={view} />)
      expect(html).toContain('data-testid="reader-state"')
      expect(html).toContain(`data-state="${view.state}"`)
    }
  })
})

describe('ResultsPanel, awaiting_publication is pending, never success or failure', () => {
  it('a choice awaiting publication reads "Pending", not evaluated, passed or failed', () => {
    const view = buildResults(fixturePack('ivan', 'ready'))
    const awaiting = view.choices.find(c => c.status === 'awaiting_publication')
    expect(awaiting).toBeTruthy()
    const html = text(renderToStaticMarkup(<ResultsPanel view={view} />))
    expect(html).toContain('Pending')
    expect(html).toContain('Not counted as a success or a failure while it waits.')
  })

  it('an incomplete measurement is flagged and reads as partial, not as a failed result', () => {
    const view = buildResults(fixturePack('ivan', 'partial'))
    expect(view.state).toBe('partial')
    const html = text(renderToStaticMarkup(<ResultsPanel view={view} />))
    expect(html).toContain('Measurement is incomplete.')
    expect(html).not.toContain('failed to publish')
  })

  it('prior failures are shown as their own section, distinct from pending or evaluated rows', () => {
    const view = buildResults(fixturePack('ivan', 'partial'))
    const html = text(renderToStaticMarkup(<ResultsPanel view={view} />))
    expect(html).toContain('Prior failed tests')
  })
})
