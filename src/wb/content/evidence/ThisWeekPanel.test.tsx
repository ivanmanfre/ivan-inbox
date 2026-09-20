// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
// `contentEvidence.ts` imports `./supabase`, which throws at module load with
// no VITE_SUPABASE_URL in this test environment.
vi.mock('../../../lib/supabase', () => ({ supabase: {} }))
import { ThisWeekPanel } from './ThisWeekPanel'
import { fixturePack } from '../../../lib/contentEvidence.fixtures'
import { buildThisWeek, type ThisWeekRead } from '../../../lib/contentEvidence'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
const beforeDetails = (html: string) => html.split('<details')[0]
const afterDetails = (html: string) => html.split('<details').slice(1).join('<details')

const failedView: ThisWeekRead = {
  state: 'failed', message: 'unknown seat', clientId: 'ivan',
  coverageLine: '', candidates: [], missingInputs: [], asOf: null,
}
const emptyView = buildThisWeek(fixturePack('ivan', 'empty'))

describe('ThisWeekPanel, the state marker and the word-count root', () => {
  it('carries [data-testid="reader-state"] with the matching data-state in every state', () => {
    for (const [label, view] of [
      ['failed', failedView],
      ['empty', emptyView],
      ['ready', buildThisWeek(fixturePack('ivan', 'ready'))],
      ['partial', buildThisWeek(fixturePack('ivan', 'partial'))],
      ['stale', buildThisWeek(fixturePack('ivan', 'stale'))],
    ] as const) {
      const html = renderToStaticMarkup(<ThisWeekPanel view={view} />)
      expect(html, `${label} state`).toContain('data-testid="reader-state"')
      expect(html, `${label} state`).toContain(`data-state="${view.state}"`)
    }
  })

  it('failed reads visibly differently from empty', () => {
    const failedHtml = text(renderToStaticMarkup(<ThisWeekPanel view={failedView} />))
    const emptyHtml = text(renderToStaticMarkup(<ThisWeekPanel view={emptyView} />))
    expect(failedHtml).not.toBe(emptyHtml)
    expect(failedHtml).toContain('The evidence read failed.')
    expect(emptyHtml).not.toContain('The evidence read failed.')
  })

  it('audit: a raw technical message ("unknown seat") never reaches the visible banner, only the collapsed Details', () => {
    const html = renderToStaticMarkup(<ThisWeekPanel view={failedView} />)
    expect(text(beforeDetails(html))).not.toContain('unknown seat')
    expect(text(beforeDetails(html))).toContain('The evidence read failed.')
    expect(text(afterDetails(html))).toContain('unknown seat')
  })

  it('the default (ready) root [data-testid="strategy-this-week"] stays at or under 300 visible words', () => {
    const view = buildThisWeek(fixturePack('ivan', 'ready'))
    const html = renderToStaticMarkup(<ThisWeekPanel view={view} />)
    expect(html).toContain('data-testid="strategy-this-week"')
    const words = text(html).split(/\s+/).filter(Boolean)
    expect(words.length).toBeLessThanOrEqual(300)
  })

  it('an experiment card carries a visible Experiment tag, reason and test metric', () => {
    const view = buildThisWeek(fixturePack('ivan', 'ready'))
    const html = text(renderToStaticMarkup(<ThisWeekPanel view={view} />))
    expect(html).toContain('Experiment')
    expect(html).toContain('Test metric:')
  })

  it('audit F3: client_fact_refs renders the label, never the source_id', () => {
    const view = buildThisWeek(fixturePack('ivan', 'ready'))
    const withRefs = view.candidates.find(c => c.client_fact_refs?.length)!
    expect(withRefs).toBeTruthy()
    const ref = withRefs.client_fact_refs![0]
    const html = text(renderToStaticMarkup(<ThisWeekPanel view={view} />))
    expect(html).toContain(ref.label)
    expect(html).not.toContain(ref.source_id)
  })
})

describe('ThisWeekPanel, the Evidence control (interactive)', () => {
  let host: HTMLDivElement
  let root: Root
  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })
  afterEach(() => {
    act(() => root.unmount())
    host.remove()
  })

  it('opens the detail panel, moves focus into it, and Escape returns focus to the toggle', async () => {
    const view = buildThisWeek(fixturePack('ivan', 'ready'))
    await act(async () => root.render(<ThisWeekPanel view={view} />))

    const toggle = host.querySelector('[data-testid="evidence-detail-toggle"]') as HTMLButtonElement
    expect(toggle).toBeTruthy()
    expect(host.querySelector('[data-testid="evidence-detail"]')).toBeNull()

    toggle.focus()
    await act(async () => toggle.dispatchEvent(new MouseEvent('click', { bubbles: true })))

    const detail = host.querySelector('[data-testid="evidence-detail"]') as HTMLElement
    expect(detail).toBeTruthy()
    expect(document.activeElement).toBe(detail)

    await act(async () => {
      detail.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(host.querySelector('[data-testid="evidence-detail"]')).toBeNull()
    expect(document.activeElement).toBe(toggle)
  })
})
