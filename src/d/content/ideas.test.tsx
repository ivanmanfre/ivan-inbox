// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { renderInFrame } from '../test-utils'
import type { IdeaBanks } from './Ideas'
import { fromCandidate } from './ideaModel'
import type { IdeaCandidate } from '../../lib/content'
import { ToastProvider } from '../ui/toast'
import { DConfirmProvider } from '../ui/confirm'
import { Ideas, filtered } from './Ideas'
vi.mock('../../lib/outliers', async importOriginal => ({ ...await importOriginal<typeof import('../../lib/outliers')>(), putOutlierOnBoard: vi.fn().mockResolvedValue({ ok: true, id: 'confirmed', created: true }) }))
const cand = (n: number, o: Partial<IdeaCandidate> = {}) => ({ id: `i${n}`, normalized_topic: `Idea ${n}`, composite_score: 100-n, source: n%2 ? 'manual' : 'ivan_call', content_type: 'post', ...o } as IdeaCandidate)
const empty = { items: [], n: 0, loading: false, error: null, refresh: vi.fn(), scores: { ok: false, byRef: new Map(), validated: false }, facets: [], chip: { ok: false, weekStart: null, byRef: new Map(), slots: [] } }
const IdeasWrapper=({banks}:{banks:IdeaBanks})=><ToastProvider><DConfirmProvider><Ideas banks={banks} phone={false}/></DConfirmProvider></ToastProvider>
const banksOf = (items: ReturnType<typeof fromCandidate>[]) => ({ ivan: { ...empty, items, n: items.length }, risedtc: empty, arch: empty }) as IdeaBanks
afterEach(() => { cleanup(); localStorage.clear() })
describe('best five Ideas', () => {
  it('shows five, hides scores, and puts every remaining idea on the bench', () => {
    renderInFrame(<Ideas banks={banksOf(Array.from({length:95},(_,i)=>fromCandidate(cand(i))))} phone={false}/> )
    expect(document.querySelectorAll('.cn-best-card')).toHaveLength(5)
    expect(document.querySelector('.cn-pill')).toBeNull()
    expect(screen.queryByText('TOP 95')).toBeNull()
    fireEvent.click(screen.getByText('See the bench'))
    expect(document.querySelectorAll('.cn-best-card')).toHaveLength(95)
    fireEvent.click(screen.getByText('Back to best 5'))
    expect(document.querySelectorAll('.cn-best-card')).toHaveLength(5)
  })
  it('preserves source and Slack links behind one tap', () => {
    renderInFrame(<Ideas banks={banksOf([fromCandidate(cand(1,{source_ref:'https://x.test/a',slack_permalink:'https://slack.test/p'}))])} phone={false}/> )
    fireEvent.click(screen.getByText('Idea 1'))
    expect(document.querySelector('[data-verb="source"]')?.getAttribute('href')).toBe('https://x.test/a')
    expect(document.querySelector('[data-verb="slack"]')).toBeTruthy()
  })
  it('adds an outlier at top, keeps it after a refresh, and opens its confirmed id', async () => {
    const outlier={platform:'x' as const,post_id:'123',author:'Stored author',text:'Source post',url:'https://x.com/i/status/123',published_at:'2026-09-29',week:'2026-09-28',lift:4,baseline:12,baseline_n:20,likes:40,reposts:1,comments:2,views:null,labels:null,personal:false,traits:[],traits_note:null,buyer:null,idea:null}
    const items=[fromCandidate(cand(1)),{...fromCandidate(cand(2)),id:'x:123',ivan:undefined,outlier,proof:'4× its author’s usual engagement'}]
    const banks=banksOf(items)
    const view=render(<IdeasWrapper banks={banks}/> )
    fireEvent.click(document.querySelector('[data-idea-id="x:123"] [data-verb="idea-use"]')!)
    await waitFor(()=>expect(document.querySelector('.cn-best-card')?.getAttribute('data-idea-id')).toBe('confirmed'))
    expect(screen.getByText('Added ✓ · open')).toBeTruthy()
    expect(banks.ivan.refresh).toHaveBeenCalled()
    view.rerender(<IdeasWrapper banks={{...banks,ivan:{...banks.ivan,items:[],error:'Refresh failed'}}}/> )
    expect(screen.getByText('Refresh failed')).toBeTruthy()
    expect(document.querySelector('.cn-best-card')?.getAttribute('data-idea-id')).toBe('confirmed')
    fireEvent.click(screen.getByText('Added ✓ · open'))
    expect(document.querySelector('[data-idea-detail="confirmed"]')).toBeTruthy()
  })
  it('scopes external skips to a client and persists them across reloads', async () => {
    localStorage.setItem('sb-test-auth-token', JSON.stringify({user:{id:'ideas-user'}}))
    const item={...fromCandidate(cand(1)),id:'x:555',ivan:undefined,outlier:{platform:'x',post_id:'555'} as never}
    const banks=banksOf([item])
    const view=renderInFrame(<Ideas banks={banks} phone={true}/> )
    fireEvent.click(screen.getByText('Skip'))
    await waitFor(()=>expect(screen.queryByText('Idea 1')).toBeNull())
    view.unmount()
    renderInFrame(<Ideas banks={banks} phone={true}/> )
    expect(screen.queryByText('Idea 1')).toBeNull()
  })
  it('uses the controlled client lane and responds to route lane changes', () => {
    const banks={...banksOf([fromCandidate(cand(1))]),risedtc:{...empty,items:[{...fromCandidate(cand(2)),lane:'risedtc' as const,title:'RISE idea'}],n:1}}
    const change=vi.fn()
    const Wrapped=({lane}:{lane:'ivan'|'risedtc'})=><ToastProvider><DConfirmProvider><Ideas banks={banks} phone={false} lane={lane} onLaneChange={change}/></DConfirmProvider></ToastProvider>
    const view=render(<Wrapped lane="risedtc"/>)
    expect(screen.getByText('RISE idea')).toBeTruthy();expect(screen.queryByText('Idea 1')).toBeNull()
    fireEvent.click(document.querySelector('[data-lane="ivan"]')!)
    expect(change).toHaveBeenCalledWith('ivan')
    view.rerender(<Wrapped lane="ivan"/>)
    expect(screen.getByText('Idea 1')).toBeTruthy();expect(screen.queryByText('RISE idea')).toBeNull()
  })
  it('does not claim an empty bank when its reader failed',()=>{
    const banks=banksOf([]);banks.ivan.error='Read failed'
    renderInFrame(<Ideas banks={banks} phone={false}/>)
    expect(screen.getByText('Read failed')).toBeTruthy();expect(screen.queryByText('No fresh ideas waiting.')).toBeNull()
  })
  it('retains the existing source-filter helper',()=>expect(filtered([fromCandidate(cand(1)),fromCandidate(cand(2))],'ivan',{source:'manual'}).map(i=>i.id)).toEqual(['i1']))
})
