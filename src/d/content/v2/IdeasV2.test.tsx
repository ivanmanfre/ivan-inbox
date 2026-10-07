// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, screen } from '@testing-library/react'
import { renderInFrame } from '../../test-utils'
import type { IdeaBanks } from '../Ideas'
import { fromCandidate } from '../ideaModel'
import type { IdeaCandidate } from '../../../lib/content'

const lib = vi.hoisted(() => ({ decideIdea: vi.fn().mockResolvedValue({}) }))
vi.mock('../../../lib/content', async o => ({ ...await o<typeof import('../../../lib/content')>(), decideIdea: lib.decideIdea }))
import { Ideas } from '../Ideas'

const empty = { items: [], n: 0, loading: false, error: null, refresh: vi.fn(), scores: { ok: false, byRef: new Map(), validated: false }, facets: [], chip: { ok: false, weekStart: null, byRef: new Map(), slots: [] } }
const cand = (n: number) => ({ id: `i${n}`, normalized_topic: `Idea ${n}`, composite_score: 100 - n, source: 'manual', content_type: 'post' } as IdeaCandidate)
afterEach(() => { cleanup(); localStorage.clear(); vi.useRealTimers(); vi.clearAllMocks() })

describe('Ideas v2', () => {
  it('a read with no answer in 12 s says so with Retry, never an endless skeleton', () => {
    vi.useFakeTimers()
    const refresh = vi.fn()
    const banks = { ivan: { ...empty, loading: true, n: null, refresh }, risedtc: empty, arch: empty } as unknown as IdeaBanks
    renderInFrame(<Ideas banks={banks} phone={false} v2 />)
    expect(screen.queryByText('Ideas did not answer in 12 s.')).toBeNull()
    act(() => { vi.advanceTimersByTime(12_100) })
    expect(screen.getByText('Ideas did not answer in 12 s.')).toBeTruthy()
    fireEvent.click(document.querySelector('[data-verb="ideas-retry"]')!)
    expect(refresh).toHaveBeenCalled()
  })
  it('ranks the best 5 and Generate draft calls today\'s decideIdea approve (no keyboard letter)', async () => {
    const items = Array.from({ length: 7 }, (_, i) => fromCandidate(cand(i)))
    const banks = { ivan: { ...empty, items, n: 7 }, risedtc: empty, arch: empty } as unknown as IdeaBanks
    renderInFrame(<Ideas banks={banks} phone={false} v2 />)
    expect(document.querySelectorAll('.cv2-idea')).toHaveLength(5)
    expect(document.querySelector('.cv2-rank')!.textContent).toBe('1')
    expect(screen.getByText(/2 more on the bench/)).toBeTruthy()
    await act(async () => { fireEvent.click(document.querySelector('[data-verb="idea-use"]')!) })
    expect(lib.decideIdea).toHaveBeenCalledWith(expect.objectContaining({ id: 'i0' }), 'approve', '')
  })
})
