// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// `contentEvidence.ts` imports `./supabase`, which throws at module load with
// no VITE_SUPABASE_URL in this test environment — needed even though the
// fetch functions below are mocked, because `vi.importActual` below still
// executes the real module once to read its other exports.
vi.mock('../../../lib/supabase', () => ({ supabase: {} }))

vi.mock('../../../lib/contentEvidence', async () => {
  const actual = await vi.importActual<typeof import('../../../lib/contentEvidence')>('../../../lib/contentEvidence')
  return {
    ...actual,
    fetchThisWeek: vi.fn(async (lane: string) => ({
      state: 'ready' as const, clientId: lane, coverageLine: 'Coverage.', candidates: [], missingInputs: [], asOf: null,
    })),
    fetchWinners: vi.fn(async (lane: string) => ({
      state: 'ready' as const, clientId: lane, market: [], own: [], asOf: null,
    })),
    fetchInputs: vi.fn(async (lane: string) => ({
      clientId: lane, state: 'ready' as const, storedPosts: 10, eligiblePosts: 10, studyState: 'validated' as const, gaps: [],
    })),
    fetchResults: vi.fn(async (lane: string) => ({
      state: 'ready' as const, clientId: lane, choices: [], priorFailures: [], asOf: null,
    })),
  }
})

import { EvidenceBlock } from './EvidenceBlock'

describe('EvidenceBlock, wiring the four views behind one sub-tab row', () => {
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

  it('defaults to This week and switches to Winners/Inputs/Results on tab click, fetching only the active tab', async () => {
    await act(async () => root.render(<EvidenceBlock lane="ivan" />))
    // Flush the initial fetch.
    await act(async () => {})
    expect(host.querySelector('[data-testid="strategy-this-week"]')).toBeTruthy()

    const tab = (label: string) => [...host.querySelectorAll('[role="tab"]')].find(b => b.textContent === label) as HTMLElement
    await act(async () => tab('Winners').dispatchEvent(new MouseEvent('click', { bubbles: true })))
    await act(async () => {})
    expect(host.textContent).toContain('Market examples')

    await act(async () => tab('Inputs').dispatchEvent(new MouseEvent('click', { bubbles: true })))
    await act(async () => {})
    expect(host.textContent).toContain('Sufficient for this question')

    await act(async () => tab('Results').dispatchEvent(new MouseEvent('click', { bubbles: true })))
    await act(async () => {})
    expect(host.querySelectorAll('[data-testid="reader-state"][data-state="ready"]').length).toBeGreaterThan(0)
  })
})
