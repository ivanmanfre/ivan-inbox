// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { XReviewList } from '../../lib/xReview'

const api = vi.hoisted(() => ({ fetchXReview: vi.fn() }))
vi.mock('../../lib/xReview', async (orig) => ({ ...(await orig<typeof import('../../lib/xReview')>()), ...api }))

import { __resetXForTests, patchX, refreshX, useXReview } from './useXReview'

const A = 'https://x/a.jpg', B = 'https://x/b.jpg'
const list = (media: string): XReviewList => ({ articles: [], quotes: [], quicks: [{ id: 'q', status: 'draft', text: 't', options: [], kind: null, source_label: null, source_excerpt: null, posted_url: null, error: null, account: null, created_at: '', updated_at: null, expires_at: null, media_url: media }] })

afterEach(() => { vi.clearAllMocks() })

describe('X review store', () => {
  it('a read that started before a local change never puts the old photo back; it reads again', async () => {
    let landOld: (l: XReviewList) => void = () => {}
    api.fetchXReview.mockImplementationOnce(() => new Promise<XReviewList>(r => { landOld = r })).mockResolvedValue(list(B))
    __resetXForTests({ list: list(A), at: Date.now() })
    const { result } = renderHook(() => useXReview())
    let p!: Promise<void>
    act(() => { p = refreshX() })                                                       // read #1 starts (server still says A)
    act(() => { patchX(l => ({ ...l, quicks: l.quicks.map(q => ({ ...q, media_url: B })) })) }) // Ivan swaps to B
    await act(async () => { landOld(list(A)); await p })                               // read #1 lands with A
    expect(result.current.list?.quicks[0].media_url).toBe(B)
    await waitFor(() => expect(api.fetchXReview).toHaveBeenCalledTimes(2))             // read #2 replaces it
    await waitFor(() => expect(result.current.list?.quicks[0].media_url).toBe(B))
  })

  it('a read with no local change in between is applied as usual', async () => {
    api.fetchXReview.mockResolvedValue(list(B))
    __resetXForTests({ list: list(A), at: Date.now() })
    const { result } = renderHook(() => useXReview())
    await act(async () => { await refreshX() })
    expect(result.current.list?.quicks[0].media_url).toBe(B)
    expect(api.fetchXReview).toHaveBeenCalledTimes(1)
  })
})
