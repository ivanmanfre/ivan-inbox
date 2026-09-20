import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
vi.mock('../../../lib/supabase', () => ({ supabase: {} }))
import { InputsPanel } from './InputsPanel'
import { fixturePack } from '../../../lib/contentEvidence.fixtures'
import { buildInputs, type InputsView } from '../../../lib/contentEvidence'

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

const failedData: InputsView = {
  clientId: 'ivan', state: 'failed', storedPosts: null, eligiblePosts: null,
  studyState: 'failed', gaps: [], message: 'connection refused',
}

describe('InputsPanel, the state marker and collected/connected/current/sufficient', () => {
  it('carries [data-testid="reader-state"] with the matching data-state in every state', () => {
    for (const data of [
      failedData,
      buildInputs(fixturePack('arch', 'empty')),
      buildInputs(fixturePack('ivan', 'ready')),
      buildInputs(fixturePack('ivan', 'partial')),
      buildInputs(fixturePack('ivan', 'stale')),
    ]) {
      const html = renderToStaticMarkup(<InputsPanel data={data} />)
      expect(html).toContain('data-testid="reader-state"')
      expect(html).toContain(`data-state="${data.state}"`)
    }
  })

  it('failed reads distinctly from partial/empty, and never says "ready to recommend"', () => {
    const failedHtml = text(renderToStaticMarkup(<InputsPanel data={failedData} />))
    const partialHtml = text(renderToStaticMarkup(<InputsPanel data={buildInputs(fixturePack('arch', 'empty'))} />))
    expect(failedHtml).not.toBe(partialHtml)
    expect(failedHtml).toContain('connection refused')
    expect(failedHtml).not.toContain('ready to recommend')
    expect(partialHtml).not.toContain('ready to recommend')
  })

  it('answers collected, connected, current and sufficient as four distinct labeled answers', () => {
    const html = text(renderToStaticMarkup(<InputsPanel data={buildInputs(fixturePack('ivan', 'ready'))} />))
    expect(html).toContain('Collected')
    expect(html).toContain('Connected')
    expect(html).toContain('Current')
    expect(html).toContain('Sufficient for this question')
  })
})
