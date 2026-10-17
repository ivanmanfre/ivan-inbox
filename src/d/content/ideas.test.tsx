// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
vi.mock('./ideaOrganization', async original => ({ ...await original<typeof import('./ideaOrganization')>(), fetchIdeaOrganization: async () => ({}), saveIdeaOrganization: async (_lane: string, id: string, patch: object) => ({id,shortlisted:false,topic:null,...patch}) }))
beforeEach(() => { localStorage.setItem('sb-test-auth-token',JSON.stringify({user:{id:'ideas-user'}})); for (const lane of ['ivan','risedtc','arch','swishdm']) writeSwr(`content-idea-view:${lane}`,'all') })
const empty = { items: [], n: 0, loading: false, error: null, refresh: vi.fn(), scores: { ok: false, byRef: new Map(), validated: false }, facets: [], chip: { ok: false, weekStart: null, byRef: new Map(), slots: [] } }
const IdeasWrapper=({banks}:{banks:IdeaBanks})=><ToastProvider><DConfirmProvider><Ideas banks={banks} phone={false}/></DConfirmProvider></ToastProvider>
const banksOf = (items: ReturnType<typeof fromCandidate>[]) => ({ ivan: { ...empty, items, n: items.length }, risedtc: empty, arch: empty , swishdm: empty}) as IdeaBanks
afterEach(() => { cleanup(); localStorage.clear(); vi.clearAllMocks() })
describe('Ideas browser', () => {
  it('shows the full ranked list beyond forty ideas without a separate reveal', () => {
    renderInFrame(<Ideas banks={banksOf(Array.from({length:95},(_,i)=>fromCandidate(cand(i))))} phone={false}/> )
    expect(document.querySelectorAll('.cn-best-card')).toHaveLength(95)
    expect(screen.getByText('Idea 94')).toBeTruthy()
    expect(screen.queryByRole('button',{name:/bench/i})).toBeNull()
  })
  it('searches title, source, proof and angle and filters sources from actual rows', () => {
    const items=[fromCandidate(cand(1)),{...fromCandidate(cand(2)),proof:'Verified retention evidence'}, {...fromCandidate(cand(3)),angle:'Pricing objection'}]
    renderInFrame(<Ideas banks={banksOf(items)} phone={false}/> )
    const search=screen.getByRole('searchbox',{name:'Search ideas'})
    for (const [query,title] of [['Idea 1','Idea 1'],['retention','Idea 2'],['pricing','Idea 3'],['calls','Idea 2']]) {
      fireEvent.change(search,{target:{value:query}})
      expect(document.querySelectorAll('.cn-best-card')).toHaveLength(1)
      expect(screen.getByText(title)).toBeTruthy()
    }
    fireEvent.change(search,{target:{value:''}})
    const source=screen.getByRole('combobox',{name:'Source'})
    expect(within(source).getAllByRole('option').map(o=>o.textContent)).toEqual(['All sources','Your calls','Your idea'])
    fireEvent.change(source,{target:{value:'Your calls'}})
    expect(screen.getByText('Idea 2')).toBeTruthy()
    expect(screen.queryByText('Idea 1')).toBeNull()
    expect(screen.getByText('Showing 1 of 3 ideas')).toBeTruthy()
    fireEvent.change(search,{target:{value:'No match'}})
    expect(screen.getByText('No ideas match these filters.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button',{name:'Clear filters'}))
    expect(document.querySelectorAll('.cn-best-card')).toHaveLength(3)
  })
  it('sorts by source date and can restore the original ranking', () => {
    const items=[fromCandidate(cand(1,{ingested_at:'2026-10-01'})),fromCandidate(cand(2,{ingested_at:'2026-10-15'})),fromCandidate(cand(3))]
    renderInFrame(<Ideas banks={banksOf(items)} phone={false}/> )
    const order=()=>Array.from(document.querySelectorAll('.cn-best-card')).map(e=>e.getAttribute('data-idea-id'))
    expect(order()).toEqual(['i1','i2','i3'])
    fireEvent.change(screen.getByRole('combobox',{name:'Sort ideas'}),{target:{value:'newest'}})
    expect(order()).toEqual(['i2','i1','i3'])
    fireEvent.change(screen.getByRole('combobox',{name:'Sort ideas'}),{target:{value:'best'}})
    expect(order()).toEqual(['i1','i2','i3'])
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
    fireEvent.change(screen.getByRole('searchbox'),{target:{value:'does not exist'}})
    fireEvent.change(screen.getByRole('combobox',{name:'Source'}),{target:{value:'Your calls'}})
    fireEvent.change(screen.getByRole('combobox',{name:'Sort ideas'}),{target:{value:'newest'}})
    fireEvent.click(document.querySelector('[data-lane="ivan"]')!)
    expect(change).toHaveBeenCalledWith('ivan')
    view.rerender(<Wrapped lane="ivan"/>)
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('')
    expect((screen.getByRole('combobox',{name:'Source'}) as HTMLSelectElement).value).toBe('')
    expect((screen.getByRole('combobox',{name:'Sort ideas'}) as HTMLSelectElement).value).toBe('best')
    expect(screen.getByText('Idea 1')).toBeTruthy();expect(screen.queryByText('RISE idea')).toBeNull()
  })
  it('does not claim an empty bank when its reader failed',()=>{
    const banks=banksOf([]);banks.ivan.error='Read failed'
    renderInFrame(<Ideas banks={banks} phone={false}/>)
    expect(screen.getByText('Read failed')).toBeTruthy();expect(screen.queryByText('No ideas waiting.')).toBeNull()
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
    writeSwr('content-idea-skips-v1',{ivan:['x:555','i2'],risedtc:[],arch:[], swishdm: []})
    const source={...fromCandidate(cand(1)),id:'x:555',ivan:undefined,outlier:{platform:'x',post_id:'555'} as never}
    renderInFrame(<Ideas banks={banksOf([source,fromCandidate(cand(2))])} phone={false}/> )
    fireEvent.click(screen.getByRole('button',{name:'Restore hidden ideas (1)'}))
    expect(screen.getByText('Idea 1')).toBeTruthy()
    expect(screen.queryByText('Idea 2')).toBeNull()
    expect(decideIdea).not.toHaveBeenCalled()
  })
  it('keeps every fresh choice beside saved ideas', () => {
    localStorage.setItem('sb-test-auth-token', JSON.stringify({user:{id:'ideas-user'}}))
    writeSwr('content-idea-picks:ivan',Array.from({length:5},(_,i)=>({...fromCandidate(cand(i)),saved:true})))
    renderInFrame(<Ideas banks={banksOf(Array.from({length:12},(_,i)=>fromCandidate(cand(i))))} phone={false}/> )
    const selected=screen.getByRole('region',{name:'Selected ideas'})
    const fresh=screen.getByRole('region',{name:'Browse ideas'})
    expect(selected.querySelectorAll('[data-idea-id]')).toHaveLength(5)
    expect(fresh.querySelectorAll('.cn-best-card')).toHaveLength(7)
    expect(within(fresh).getByText('Idea 5')).toBeTruthy()
    expect(screen.getByText('Idea 10')).toBeTruthy()
  })
  it('does not promise a draft in the receipt for archiving a client idea', async () => {
    const idea={...fromCandidate(cand(1)),ivan:undefined,client:{id:'c1'} as never,lane:'arch' as const,id:'c1'}
    renderInFrame(<IdeaDetail it={idea} onDone={()=>{}} compact/> )
    fireEvent.click(screen.getByRole('button',{name:'Archive idea'}))
    await waitFor(()=>expect(screen.getByText('Idea archived.')).toBeTruthy())
    expect(document.querySelector('.d-toast')?.textContent).not.toMatch(/draft/i)
    expect(decideClientIdea).toHaveBeenCalledWith('c1','rejected','arch')
  })
  it('sends the selected RISE format with approval', async () => {
    const idea={...fromCandidate(cand(1)),ivan:undefined,client:{id:'c1',format:'post',planned_format:'carousel'} as never,lane:'risedtc' as const,id:'c1'}
    renderInFrame(<IdeaDetail it={idea} onDone={()=>{}} compact/> )
    const picker = screen.getByRole('combobox', { name: 'Draft format' }) as HTMLSelectElement
    expect(picker.value).toBe('carousel')
    fireEvent.change(picker, { target: { value: 'text' } })
    fireEvent.click(screen.getByRole('button', { name: 'Generate draft' }))
    await waitFor(() => expect(decideClientIdea).toHaveBeenCalledWith('c1', 'approved', 'risedtc', 'text'))
  })
  it('preserves the client in the Review destination for a requested draft', () => {
    const idea={...fromCandidate(cand(1)),lane:'arch' as const,generating:true}
    renderInFrame(<IdeaDetail it={idea} onDone={()=>{}} compact/> )
    expect(screen.getByRole('link',{name:'Open Review'}).getAttribute('href')).toBe('#exp/d/content/now?lane=arch')
    expect(screen.queryByText(/appear in Now/)).toBeNull()
  })
})
