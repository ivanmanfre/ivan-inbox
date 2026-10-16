// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { renderInFrame } from '../test-utils'
import { readSwr } from '../../lib/swr'
import { Ideas, type IdeaBanks } from './Ideas'
import { fromCandidate } from './ideaModel'
import type { IdeaCandidate } from '../../lib/content'
const remote=vi.hoisted(()=>({rows:{} as Record<string,Record<string,any>>,fail:false,read:null as null | ((lane:string)=>Promise<any>),write:null as null | (()=>Promise<any>)}))
vi.mock('./ideaOrganization',async original=>({...await original<typeof import('./ideaOrganization')>(),
 fetchIdeaOrganization:async(lane:string)=>remote.read ? remote.read(lane) : ({...remote.rows[lane]}),
 saveIdeaOrganization:async(lane:string,id:string,patch:unknown)=>{
  if(remote.write)return remote.write()
  if(remote.fail)throw Error('Shortlist could not sync')
  remote.rows[lane]??={};return remote.rows[lane][id]={id,shortlisted:false,topic:null,...remote.rows[lane][id],...patch as object}
 }}))
const empty={items:[],n:0,loading:false,error:null,refresh:vi.fn(),scores:{ok:false,byRef:new Map(),validated:false},facets:[],chip:{ok:false,weekStart:null,byRef:new Map(),slots:[]}}
const item=(id:string,title:string,days:number)=>fromCandidate({id,normalized_topic:title,source:'manual',content_type:'post',ingested_at:new Date(Date.now()-days*86400000).toISOString()} as IdeaCandidate)
const banks={ivan:{...empty,items:[item('a','AI drafts that sound like you',1),item('b','Cold DMs get ignored',25),item('c','I moved to Warsaw',3)],n:3},arch:empty,risedtc:empty,swishdm:empty} as unknown as IdeaBanks
const mount=()=>renderInFrame(<Ideas banks={banks} phone={false} v2 />)
beforeEach(()=>localStorage.setItem('sb-test-auth-token',JSON.stringify({user:{id:'ideas-user'}})))
afterEach(()=>{cleanup();localStorage.clear();remote.rows={};remote.fail=false;remote.read=null;remote.write=null})
it('shows recent arrivals, topic filters, and retains older ideas in the library',async()=>{
 mount();await screen.findByRole('button',{name:'Shortlist AI drafts that sound like you'})
 expect(screen.queryByText('Cold DMs get ignored')).toBeNull()
 fireEvent.click(screen.getByRole('tab',{name:/All ideas/}))
 expect(screen.getByText('Cold DMs get ignored')).toBeTruthy()
 fireEvent.change(screen.getByRole('combobox',{name:'Topic'}),{target:{value:'Content & LinkedIn'}})
 expect(screen.queryByText('I moved to Warsaw')).toBeNull()
 expect(screen.getByText('AI drafts that sound like you')).toBeTruthy()
})
it('shortlists an older idea without generating it, keeps it across remount and allows removal',async()=>{
 const view=mount();fireEvent.click(screen.getByRole('tab',{name:/All ideas/}))
 const pin=await screen.findByRole('button',{name:'Shortlist Cold DMs get ignored'})
 await waitFor(()=>expect(pin.hasAttribute('disabled')).toBe(false));fireEvent.click(pin)
 await screen.findByRole('button',{name:'Remove Cold DMs get ignored from shortlist'})
 expect(within(document.querySelector('[data-idea-id="b"]')!).getByRole('button',{name:'Generate draft'})).toBeTruthy()
 fireEvent.click(screen.getByRole('tab',{name:/Shortlisted/}))
 expect(document.querySelectorAll('.cv2-idea')).toHaveLength(1)
 view.unmount();mount()
 await screen.findByText('Cold DMs get ignored')
 fireEvent.click(screen.getByRole('button',{name:'Remove Cold DMs get ignored from shortlist'}))
 await screen.findByText('Your shortlist is empty.')
 fireEvent.click(screen.getByRole('tab',{name:/All ideas/}))
 expect(screen.getByText('Cold DMs get ignored')).toBeTruthy()
})
it('keeps the previous shortlist on failed writes and lets a topic correction replace its suggestion',async()=>{
 mount();const pin=await screen.findByRole('button',{name:'Shortlist AI drafts that sound like you'})
 await waitFor(()=>expect(pin.hasAttribute('disabled')).toBe(false));remote.fail=true;fireEvent.click(pin)
 await screen.findByText('Shortlist could not sync')
 expect(pin.getAttribute('aria-pressed')).toBe('false')
 remote.fail=false;fireEvent.click(screen.getByText('AI drafts that sound like you'))
 fireEvent.change(screen.getByRole('combobox',{name:'Topic for AI drafts that sound like you'}),{target:{value:'Sales & outreach'}})
 await waitFor(()=>expect(within(document.querySelector('[data-idea-id="a"]')!).getByText('Sales & outreach',{selector:'.cn-idea-topic'})).toBeTruthy())
})

it('discards an old account’s pending read when the signed-in account changes',async()=>{
 let finish!:(rows:any)=>void,reads=0
 const oldRead=new Promise(resolve=>{finish=resolve})
 remote.read=async()=>++reads===1 ? oldRead : {}
 mount()
 await waitFor(()=>expect(reads).toBe(1))
 localStorage.setItem('sb-test-auth-token',JSON.stringify({user:{id:'other-user'}}))
 fireEvent(window,new StorageEvent('storage',{key:'sb-test-auth-token'}))
 await waitFor(()=>expect(reads).toBe(2))
 await act(async()=>{finish({a:{id:'a',shortlisted:true,topic:'Founder life'}});await oldRead})
 expect(screen.getByRole('button',{name:'Shortlist AI drafts that sound like you'}).getAttribute('aria-pressed')).toBe('false')
 expect(readSwr('content-idea-organization:ivan','other-user')?.payload).toEqual({})
})
it('keeps a successful star when a refresh returns an older copy',async()=>{
 mount();const pin=await screen.findByRole('button',{name:'Shortlist AI drafts that sound like you'})
 await waitFor(()=>expect(pin.hasAttribute('disabled')).toBe(false))
 let finishWrite!:(row:any)=>void,finishRead!:(rows:any)=>void
 const write=new Promise(resolve=>{finishWrite=resolve}),read=new Promise(resolve=>{finishRead=resolve})
 remote.write=()=>write;remote.read=()=>read
 fireEvent.focus(window);fireEvent.click(pin)
 await act(async()=>{finishWrite({id:'a',shortlisted:true,topic:null});await write})
 await act(async()=>{finishRead({});await read})
 expect(screen.getByRole('button',{name:'Remove AI drafts that sound like you from shortlist'}).getAttribute('aria-pressed')).toBe('true')
})

it('accepts the next lane’s shortlist while the previous lane finishes saving',async()=>{
 const rise={...item('rise','RISE idea',1),lane:'risedtc',ivan:undefined,client:{created_at:new Date().toISOString()}} as any
 renderInFrame(<Ideas banks={{...banks,risedtc:{...empty,items:[rise],n:1}} as IdeaBanks} phone={false} v2 />)
 const pin=await screen.findByRole('button',{name:'Shortlist AI drafts that sound like you'})
 await waitFor(()=>expect(pin.hasAttribute('disabled')).toBe(false))
 let finishWrite!:(row:any)=>void,finishRead!:(rows:any)=>void
 const write=new Promise(resolve=>{finishWrite=resolve}),read=new Promise(resolve=>{finishRead=resolve})
 remote.write=()=>write;remote.read=lane=>lane==='risedtc'?read:Promise.resolve({})
 fireEvent.click(pin);fireEvent.click(screen.getByRole('tab',{name:/Rise/}))
 await act(async()=>{finishWrite({id:'a',shortlisted:true,topic:null});await write})
 await act(async()=>{finishRead({rise:{id:'rise',shortlisted:true,topic:null}});await read})
 expect(screen.getByRole('button',{name:'Remove RISE idea from shortlist'}).getAttribute('aria-pressed')).toBe('true')
})
