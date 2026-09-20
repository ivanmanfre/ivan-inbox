// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// `contentEvidence.ts` imports `./supabase`, which throws at module load with
// no VITE_SUPABASE_URL in this test environment — needed even though the
// fetch function below is mocked, because `vi.importActual` below still
// executes the real module once to read its other exports.
vi.mock('../../../lib/supabase', () => ({ supabase: {} }))

// `vi.mock` factories are hoisted above every other top-level statement in
// this file, so the mock function has to be built INSIDE `vi.hoisted` --
// referencing an ordinary top-level `const` here throws "Cannot access
// before initialization" (vitest's own documented limitation).
const { fetchContentEvidenceViews } = vi.hoisted(() => ({
  fetchContentEvidenceViews: vi.fn(async (lane: string) => ({
    thisWeek: { state: 'ready' as const, clientId: lane, coverageLine: 'Coverage.', candidates: [], missingInputs: [], asOf: null },
    winners: { state: 'ready' as const, clientId: lane, market: [], own: [], asOf: null },
    inputs: { clientId: lane, state: 'ready' as const, storedPosts: 10, eligiblePosts: 10, studyState: 'validated' as const, gaps: [] },
    results: { state: 'ready' as const, clientId: lane, choices: [], priorFailures: [], asOf: null },
  })),
}))

vi.mock('../../../lib/contentEvidence', async () => {
  const actual = await vi.importActual<typeof import('../../../lib/contentEvidence')>('../../../lib/contentEvidence')
  return { ...actual, fetchContentEvidenceViews }
})

import { EvidenceBlock } from './EvidenceBlock'

describe('EvidenceBlock, wiring the four views behind one sub-tab row', () => {
  let host: HTMLDivElement
  let root: Root
  beforeEach(() => {
    fetchContentEvidenceViews.mockClear()
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })
  afterEach(() => {
    act(() => root.unmount())
    host.remove()
  })

  it('defaults to This week and switches to Winners/Inputs/Test results on tab click, sharing one fetch', async () => {
    await act(async () => root.render(<EvidenceBlock lane="ivan" />))
    // Flush the initial fetch.
    await act(async () => {})
    expect(host.querySelector('[data-testid="strategy-this-week"]')).toBeTruthy()
    expect(fetchContentEvidenceViews).toHaveBeenCalledTimes(1)

    const tab = (label: string) => [...host.querySelectorAll('[role="tab"]')].find(b => b.textContent === label) as HTMLElement
    await act(async () => tab('Winners').dispatchEvent(new MouseEvent('click', { bubbles: true })))
    await act(async () => {})
    expect(host.textContent).toContain('Market examples')

    await act(async () => tab('Inputs').dispatchEvent(new MouseEvent('click', { bubbles: true })))
    await act(async () => {})
    expect(host.textContent).toContain('Sufficient for this question')

    await act(async () => tab('Test results').dispatchEvent(new MouseEvent('click', { bubbles: true })))
    await act(async () => {})
    expect(host.querySelectorAll('[data-testid="reader-state"][data-state="ready"]').length).toBeGreaterThan(0)

    // MUST-FIX (NOTE): four sub-tab visits, still exactly one network round
    // trip for this lane — the four sub-views share the one read.
    expect(fetchContentEvidenceViews).toHaveBeenCalledTimes(1)
  })
})
