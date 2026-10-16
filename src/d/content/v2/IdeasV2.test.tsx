// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { renderInFrame } from '../../test-utils'
import type { IdeaBanks } from '../Ideas'
import { fromCandidate } from '../ideaModel'
import { writeSwr } from '../../../lib/swr'
import type { IdeaCandidate } from '../../../lib/content'

const lib = vi.hoisted(() => ({ decideIdea: vi.fn().mockResolvedValue({}) }))
vi.mock('../../../lib/content', async o => ({ ...await o<typeof import('../../../lib/content')>(), decideIdea: lib.decideIdea }))
import { Ideas } from '../Ideas'

vi.mock('../ideaOrganization', async original => ({ ...await original<typeof import('../ideaOrganization')>(), fetchIdeaOrganization: async () => ({}), saveIdeaOrganization: async (_lane: string, id: string, patch: object) => ({id,shortlisted:false,topic:null,...patch}) }))
beforeEach(() => { localStorage.setItem('sb-test-auth-token',JSON.stringify({user:{id:'ideas-user'}})); writeSwr('content-idea-view:ivan','all') })
const empty = { items: [], n: 0, loading: false, error: null, refresh: vi.fn(), scores: { ok: false, byRef: new Map(), validated: false }, facets: [], chip: { ok: false, weekStart: null, byRef: new Map(), slots: [] } }
const cand = (n: number) => ({ id: `i${n}`, normalized_topic: `Idea ${n}`, composite_score: 100 - n, source: 'manual', content_type: 'post' } as IdeaCandidate)
afterEach(() => { cleanup(); localStorage.clear(); vi.useRealTimers(); vi.clearAllMocks() })

describe('Ideas v2', () => {
  it('a read with no answer in 12 s says so with Retry, never an endless skeleton', () => {
    vi.useFakeTimers()
    const refresh = vi.fn()
    const banks = { ivan: { ...empty, loading: true, n: null, refresh }, risedtc: empty, arch: empty , swishdm: empty} as unknown as IdeaBanks
    renderInFrame(<Ideas banks={banks} phone={false} v2 />)
    expect(screen.queryByText('Ideas did not answer in 12 s.')).toBeNull()
    act(() => { vi.advanceTimersByTime(12_100) })
    expect(screen.getByText('Ideas did not answer in 12 s.')).toBeTruthy()
    fireEvent.click(document.querySelector('[data-verb="ideas-retry"]')!)
    expect(refresh).toHaveBeenCalled()
  })
  it('shows the full ranking and Generate draft calls today\'s decideIdea approve (no keyboard letter)', async () => {
    const items = Array.from({ length: 96 }, (_, i) => fromCandidate(cand(i)))
    const banks = { ivan: { ...empty, items, n: 96 }, risedtc: empty, arch: empty , swishdm: empty} as unknown as IdeaBanks
    renderInFrame(<Ideas banks={banks} phone={false} v2 />)
    expect(document.querySelectorAll('.cv2-idea')).toHaveLength(96)
    expect(document.querySelector('.cv2-rank')!.textContent).toBe('1')
    expect(screen.getByText('Idea 95')).toBeTruthy()
    expect(screen.getByText(/96 bank ideas/)).toBeTruthy()
    await act(async () => { fireEvent.click(document.querySelector('[data-verb="idea-use"]')!) })
    expect(lib.decideIdea).toHaveBeenCalledWith(expect.objectContaining({ id: 'i0' }), 'approve', '')
  })
  it('updates visible counts when a source is hidden and restored', async () => {
    const source={...fromCandidate(cand(1)),id:'x:222',ivan:undefined,src:'X',outlier:{platform:'x',post_id:'222'} as never}
    const items=[fromCandidate(cand(0)),source]
    const banks={ivan:{...empty,items,n:2},risedtc:empty,arch:empty,swishdm:empty} as IdeaBanks
    renderInFrame(<Ideas banks={banks} phone v2 />)
    const tab=()=>screen.getByRole('tab',{name:/Ivan/})
    expect(tab().textContent).toContain('2')
    expect(screen.getByText(/2 ideas · 1 bank idea · 1 source post/)).toBeTruthy()
    fireEvent.click(within(document.querySelector('[data-idea-id="x:222"]') as HTMLElement).getByRole('button',{name:'More for this idea'}))
    fireEvent.click(screen.getByText('Hide on this device'))
    await waitFor(()=>expect(screen.queryByText('Idea 1')).toBeNull())
    expect(tab().textContent).toContain('1')
    expect(screen.getByText('Showing 1 of 1 ideas')).toBeTruthy()
    fireEvent.click(screen.getByRole('button',{name:'Restore hidden ideas (1)'}))
    expect(tab().textContent).toContain('2')
    expect(screen.getByText('Showing 2 of 2 ideas')).toBeTruthy()
  })
  it('keeps requested drafts actionable across reload while browsing ideas', async () => {
    localStorage.setItem('sb-test-auth-token',JSON.stringify({user:{id:'ideas-user'}}))
    const items=[fromCandidate(cand(0)),{...fromCandidate(cand(1)),proof:'Stored proof',angle:'A distinct angle'}]
    writeSwr('content-idea-picks:ivan',[{...items[0],saved:true,generating:true}])
    const banks={ivan:{...empty,items,n:2},risedtc:empty,arch:empty,swishdm:empty} as IdeaBanks
    const view=renderInFrame(<Ideas banks={banks} phone={false} v2 />)
    fireEvent.change(screen.getByRole('searchbox'),{target:{value:'distinct angle'}})
    expect(screen.getByRole('link',{name:'Open in Review →'}).getAttribute('href')).toContain('lane=ivan')
    expect(within(screen.getByRole('region',{name:'Browse ideas'})).getByText('Idea 1')).toBeTruthy()
    expect(screen.queryByText('Stored proof')).toBeNull()
    expect(screen.queryByRole('button',{name:'No read yet'})).toBeNull()
    fireEvent.click(screen.getByText('Idea 1'))
    expect(screen.getByText('Stored proof',{selector:'.cn-idea-proof'})).toBeTruthy()
    expect(screen.getByRole('button',{name:'No read yet'})).toBeTruthy()
    view.unmount()
    renderInFrame(<Ideas banks={banks} phone={false} v2 />)
    expect(screen.getByRole('link',{name:'Open in Review →'})).toBeTruthy()
    expect(screen.getByText('Showing 1 of 1 ideas')).toBeTruthy()
  })

})
