// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { Schedule } from './Schedule'
import { packIndex, readFortnight, nextCall } from '../model'
import type { WeekEvent, SalesPack } from '../../../lib/salesPacks'
afterEach(cleanup)
const now=new Date('2026-10-07T09:00:00Z')
const event:WeekEvent={id:'e',title:'Ada',start_time:'2026-10-07T09:30:00Z',end_time:'2026-10-07T10:00:00Z',attendees:['ada@example.com'],meeting_url:'https://meet.google.com/a',is_all_day:false,is_test:false,meeting_type:null,source:null,referral_token:null,booking_source_path:null}
const p:SalesPack={id:'p',prospect_slug:'ada',kind:'card',title:'Ada',mime:'text/html',source_path:null,source_mtime:null,call_at:event.start_time,meta:{name:'Ada'},updated_at:event.start_time}
const idx=packIndex([p])
const f=readFortnight([event],idx,[],now)
it('draws fourteen day cells, both clocks, unchanged Join, and every document including missing ones',()=>{
 render(<Schedule f={f} shown={f} now={now} next={nextCall(f)} idx={idx} packs={1} tools={null} filtered="" clear={()=>{}} report={()=>{}} packsFailed={false}/>)
 expect(document.querySelectorAll('[data-day]')).toHaveLength(14)
 expect(document.querySelectorAll('[data-today=true]')).toHaveLength(1)
 expect(document.querySelector('[data-next-facts]')).toBeTruthy()
 expect(document.querySelector('[data-verb=join]')).toBeTruthy()
 for(const a of document.querySelectorAll('a[data-doc]')){expect(a.getAttribute('target')).toBe('_blank');expect(a.getAttribute('rel')).toBe('noreferrer')}
 expect(document.querySelectorAll('.sl4-next [data-doc-missing]')).toHaveLength(4)
 expect(document.querySelectorAll('[data-cal-id=e]')).toHaveLength(1)
})
it('an empty calendar has no empty next-call plate',()=>{
 const empty=readFortnight([],idx,[],now)
 render(<Schedule f={empty} shown={empty} now={now} next={null} idx={idx} packs={0} tools={null} filtered="" clear={()=>{}} report={()=>{}} packsFailed={false}/>)
 expect(document.querySelector('[data-next]')).toBeNull();expect(document.body.textContent).not.toContain('None booked')
})
