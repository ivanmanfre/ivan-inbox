// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { renderInFrame } from '../test-utils'
import type { IdeaBanks } from './Ideas'
import { fromCandidate } from './ideaModel'
import { decideIdea, type IdeaCandidate } from '../../lib/content'
import { decideClientIdea } from '../../lib/clientIdeas'
import { writeSwr } from '../../lib/swr'
import { IdeaDetail } from './IdeaDetail'
import { ToastProvider } from '../ui/toast'
import { DConfirmProvider } from '../ui/confirm'
import { Ideas, filtered } from './Ideas'
vi.mock('../../lib/outliers', async importOriginal => ({ ...await importOriginal<typeof import('../../lib/outliers')>(), putOutlierOnBoard: vi.fn().mockResolvedValue({ ok: true, id: 'confirmed', created: true }) }))
vi.mock('../../lib/content', async importOriginal => ({ ...await importOriginal<typeof import('../../lib/content')>(), decideIdea: vi.fn().mockResolvedValue({}) }))
vi.mock('../../lib/clientIdeas', async importOriginal => ({ ...await importOriginal<typeof import('../../lib/clientIdeas')>(), decideClientIdea: vi.fn().mockResolvedValue(undefined) }))
const cand = (n: number, o: Partial<IdeaCandidate> = {}) => ({ id: `i${n}`, normalized_topic: `Idea ${n}`, composite_score: 100-n, source: n%2 ? 'manual' : 'ivan_call', content_type: 'post', ...o } as IdeaCandidate)
const empty = { items: [], n: 0, loading: false, error: null, refresh: vi.fn(), scores: { ok: false, byRef: new Map(), validated: false }, facets: [], chip: { ok: false, weekStart: null, byRef: new Map(), slots: [] } }
const IdeasWrapper=({banks}:{banks:IdeaBanks})=><ToastProvider><DConfirmProvider><Ideas banks={banks} phone={false}/></DConfirmProvider></ToastProvider>
const banksOf = (items: ReturnType<typeof fromCandidate>[]) => ({ ivan: { ...empty, items, n: items.length }, risedtc: empty, arch: empty }) as IdeaBanks
afterEach(() => { cleanup(); localStorage.clear(); vi.clearAllMocks() })
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
    expect(screen.getByText('Open saved idea')).toBeTruthy()
    expect(banks.ivan.refresh).toHaveBeenCalled()
    view.rerender(<IdeasWrapper banks={{...banks,ivan:{...banks.ivan,items:[],error:'Refresh failed'}}}/> )
    expect(screen.getByText('Refresh failed')).toBeTruthy()
    expect(document.querySelector('.cn-best-card')?.getAttribute('data-idea-id')).toBe('confirmed')
    fireEvent.click(screen.getByText('Open saved idea'))
    expect(document.querySelector('[data-idea-detail="confirmed"]')).toBeTruthy()
  })
  it('scopes external skips to a client and persists them across reloads', async () => {
    localStorage.setItem('sb-test-auth-token', JSON.stringify({user:{id:'ideas-user'}}))
    const item={...fromCandidate(cand(1)),id:'x:555',ivan:undefined,outlier:{platform:'x',post_id:'555'} as never}
    const banks=banksOf([item])
    const view=renderInFrame(<Ideas banks={banks} phone={true}/> )
    fireEvent.click(screen.getByText('Hide'))
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


describe('idea consequences and recovery', () => {
  it('names saving a source separately from generating or archiving a bank idea', async () => {
    const source={...fromCandidate(cand(2)),id:'x:222',ivan:undefined,outlier:{platform:'x',post_id:'222'} as never}
    renderInFrame(<Ideas banks={banksOf([source,fromCandidate(cand(1))])} phone={false}/> )
    const external=within(document.querySelector('[data-idea-id="x:222"]') as HTMLElement)
    expect(external.getByRole('button',{name:'Save idea'})).toBeTruthy()
    expect(external.getByRole('button',{name:'Hide'})).toBeTruthy()
    const bank=within(document.querySelector('[data-idea-id="i1"]') as HTMLElement)
    fireEvent.click(bank.getByRole('button',{name:'Generate draft'}))
    await waitFor(()=>expect(screen.getByText('Draft requested. It will appear in Review.')).toBeTruthy())
    expect(decideIdea).toHaveBeenCalledWith(expect.objectContaining({id:'i1'}),'approve','')
    expect(decideClientIdea).not.toHaveBeenCalled()
  })
  it('undoes a device hide without a database decision and can restore it after reload', async () => {
    localStorage.setItem('sb-test-auth-token', JSON.stringify({user:{id:'ideas-user'}}))
    const source={...fromCandidate(cand(1)),id:'x:555',ivan:undefined,outlier:{platform:'x',post_id:'555'} as never}
    const banks=banksOf([source])
    const view=renderInFrame(<Ideas banks={banks} phone={true}/> )
    fireEvent.click(screen.getByRole('button',{name:'Hide'}))
    await waitFor(()=>expect(screen.queryByText('Idea 1')).toBeNull())
    fireEvent.click(screen.getByRole('button',{name:'Undo'}))
    expect(screen.getByText('Idea 1')).toBeTruthy()
    fireEvent.click(screen.getByRole('button',{name:'Hide'}))
    await waitFor(()=>expect(screen.queryByText('Idea 1')).toBeNull())
    view.unmount()
    renderInFrame(<Ideas banks={banks} phone={true}/> )
    fireEvent.click(screen.getByRole('button',{name:'Restore hidden ideas (1)'}))
    expect(screen.getByText('Idea 1')).toBeTruthy()
    expect(decideIdea).not.toHaveBeenCalled()
    expect(decideClientIdea).not.toHaveBeenCalled()
  })
  it('archives a bank idea with an explicit receipt and no unsupported restore action', async () => {
    renderInFrame(<Ideas banks={banksOf([fromCandidate(cand(1))])} phone={false}/> )
    fireEvent.click(screen.getByRole('button',{name:'Archive idea'}))
    await waitFor(()=>expect(screen.getByText('Idea archived.')).toBeTruthy())
    expect(decideIdea).toHaveBeenCalledWith(expect.objectContaining({id:'i1'}),'reject','')
    expect(screen.queryByRole('button',{name:'Undo'})).toBeNull()
    expect(screen.queryByRole('button',{name:/Restore hidden ideas/})).toBeNull()
  })
  it('restores only device-hidden source ids while keeping archived bank ids hidden', () => {
    localStorage.setItem('sb-test-auth-token', JSON.stringify({user:{id:'ideas-user'}}))
    writeSwr('content-idea-skips-v1',{ivan:['x:555','i2'],risedtc:[],arch:[]})
    const source={...fromCandidate(cand(1)),id:'x:555',ivan:undefined,outlier:{platform:'x',post_id:'555'} as never}
    renderInFrame(<Ideas banks={banksOf([source,fromCandidate(cand(2))])} phone={false}/> )
    fireEvent.click(screen.getByRole('button',{name:'Restore hidden ideas (1)'}))
    expect(screen.getByText('Idea 1')).toBeTruthy()
    expect(screen.queryByText('Idea 2')).toBeNull()
    expect(decideIdea).not.toHaveBeenCalled()
  })
  it('keeps five fresh choices beside five selected ideas', () => {
    localStorage.setItem('sb-test-auth-token', JSON.stringify({user:{id:'ideas-user'}}))
    writeSwr('content-idea-picks:ivan',Array.from({length:5},(_,i)=>({...fromCandidate(cand(i)),saved:true})))
    renderInFrame(<Ideas banks={banksOf(Array.from({length:12},(_,i)=>fromCandidate(cand(i))))} phone={false}/> )
    const selected=screen.getByRole('region',{name:'Selected ideas'})
    const fresh=screen.getByRole('region',{name:'Best 5'})
    expect(selected.querySelectorAll('[data-idea-id]')).toHaveLength(5)
    expect(fresh.querySelectorAll('.cn-best-card')).toHaveLength(5)
    expect(within(fresh).getByText('Idea 5')).toBeTruthy()
    expect(screen.queryByText('Idea 10')).toBeNull()
  })
  it('does not promise a draft in the receipt for archiving a client idea', async () => {
    const idea={...fromCandidate(cand(1)),ivan:undefined,client:{id:'c1'} as never,lane:'arch' as const,id:'c1'}
    renderInFrame(<IdeaDetail it={idea} onDone={()=>{}} compact/> )
    fireEvent.click(screen.getByRole('button',{name:'Archive idea'}))
    await waitFor(()=>expect(screen.getByText('Idea archived.')).toBeTruthy())
    expect(document.querySelector('.d-toast')?.textContent).not.toMatch(/draft/i)
    expect(decideClientIdea).toHaveBeenCalledWith('c1','rejected')
  })
  it('preserves the client in the Review destination for a requested draft', () => {
    const idea={...fromCandidate(cand(1)),lane:'arch' as const,generating:true}
    renderInFrame(<IdeaDetail it={idea} onDone={()=>{}} compact/> )
    expect(screen.getByRole('link',{name:'Open Review'}).getAttribute('href')).toBe('#exp/d/content/now?lane=arch')
    expect(screen.queryByText(/appear in Now/)).toBeNull()
  })
})
