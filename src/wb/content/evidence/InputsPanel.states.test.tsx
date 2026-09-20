import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
vi.mock('../../../lib/supabase', () => ({ supabase: {} }))
import { InputsPanel } from './InputsPanel'
import { fixturePack } from '../../../lib/contentEvidence.fixtures'
import { buildInputs, type InputsView } from '../../../lib/contentEvidence'

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
// The part of the markup a person sees before opening "Details" -- the audit
// fix pass requires the raw technical message to live ONLY after this split.
const beforeDetails = (html: string) => html.split('<details')[0]
const afterDetails = (html: string) => html.split('<details').slice(1).join('<details')

const failedData: InputsView = {
  clientId: 'ivan', state: 'failed', storedPosts: null, eligiblePosts: null,
  studyState: 'failed', gaps: [], message: 'unknown seat',
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

// Audit F5 (PRELEASE-AUDIT.md): "Validated" is honest only as a claim about
// arithmetic, never as an implicit "sufficient" verdict.
describe('audit F5: the validated label never implies sufficiency', () => {
  it('a validated study reads "Arithmetic verified, descriptive only", never a bare "Validated"', () => {
    const html = text(renderToStaticMarkup(<InputsPanel data={buildInputs(fixturePack('ivan', 'ready'))} />))
    expect(html).toContain('Arithmetic verified, descriptive only')
    // A bare, unqualified "Validated" (word-boundaried) must not appear.
    expect(html).not.toMatch(/\bValidated\b/)
  })

  it('the stale variant carries the same arithmetic-only qualifier', () => {
    const html = text(renderToStaticMarkup(<InputsPanel data={buildInputs(fixturePack('ivan', 'stale'))} />))
    expect(html).toContain('Arithmetic verified, descriptive only')
  })

  it('sufficiency is never implied by study state: a validated-but-insufficient study says "Not yet", an unvalidated-but-sufficient one says "Yes"', () => {
    const validatedInsufficient: InputsView = {
      clientId: 'ivan', state: 'ready', storedPosts: 100, eligiblePosts: 100,
      studyState: 'validated', gaps: [], sufficientForThisQuestion: false,
      sufficiencyReason: 'Only one ranked author clears the floor.',
    }
    const unvalidatedSufficient: InputsView = {
      clientId: 'ivan', state: 'ready', storedPosts: 100, eligiblePosts: 100,
      studyState: 'imported', gaps: [], sufficientForThisQuestion: true,
    }
    const htmlA = text(renderToStaticMarkup(<InputsPanel data={validatedInsufficient} />))
    const htmlB = text(renderToStaticMarkup(<InputsPanel data={unvalidatedSufficient} />))
    expect(htmlA).toContain('Arithmetic verified, descriptive only')
    expect(htmlA).toContain('Not yet')
    expect(htmlB).toContain('Imported, not yet validated')
    expect(htmlB).toContain('Sufficient for this question Yes')
  })
})

// Audit fix pass: a raw PostgREST/RPC message must never reach the visible
// failed banner; it lives behind a collapsed "Details" control instead.
describe('audit: raw technical messages never reach the visible failed banner', () => {
  it('"unknown seat" appears only after the Details disclosure, never before it', () => {
    const html = renderToStaticMarkup(<InputsPanel data={failedData} />)
    expect(text(beforeDetails(html))).not.toContain('unknown seat')
    expect(text(beforeDetails(html))).toContain('The evidence read failed.')
    expect(text(afterDetails(html))).toContain('unknown seat')
  })
})
