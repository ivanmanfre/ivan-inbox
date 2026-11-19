// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor, screen } from '@testing-library/react'
import { Window } from './Window'
import type { CallRow } from '../../../lib/transcripts'
afterEach(cleanup)
const row: CallRow={id:'a',title:'Meet',date:'2026-10-07T13:00:00Z',duration_minutes:30,participants:['Ivan','Ada'],summary:'Summary text',action_items:['{"action":"Mine","owner":"Ivan"}','{"action":"Theirs","owner":"Ada"}'],topics:null,follow_up_draft:'Follow up text',follow_up_sent:false,source:null,meeting_type:null,brief:{next_step:'Next text'} as CallRow['brief']}
it('owes precede the draft and summary, room and transcript stay folded, Copy only touches clipboard',async()=>{
 const writeText=vi.fn(async()=>{});Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText}})
 render(<Window row={row} at={1} of={2} onStep={vi.fn()} layout="desktop" />)
 const text=document.body.textContent!
 for(const [a,b] of [['Yours','Other owners'],['Other owners','Next step'],['Next step','Follow-up draft'],['Follow-up draft','Summary']])expect(text.indexOf(a)).toBeLessThan(text.indexOf(b))
 expect(document.querySelector('.sl-room [aria-expanded="false"]')).toBeTruthy()
 fireEvent.click(screen.getByRole('button',{name:'Copy'}))
 await waitFor(()=>expect(screen.getByRole('button',{name:'✓ Copied'})).toBeTruthy())
 expect(writeText).toHaveBeenCalledWith('Follow up text')
})
it('groups extracted actions and shows each repeated assignment once', () => {
 render(<Window row={{...row,action_items:[
   { action:'Send the deck.', owner:'Ivan' },
   { action:'send the deck', owner:'Ivan Manfredi', context:'Add the example' },
   { action:'Share the notes', owner:'Ada', due:'Friday' },
   { action:'Confirm the brief', owner:'TBD' },
 ]}} at={1} of={1} onStep={vi.fn()} layout="phone" />)
 const actions=screen.getByRole('region',{name:'Action items'})
 expect(actions.textContent).toMatch(/Yours.*send the deck.*Add the example.*Other owners.*Share the notes.*Ada.*Friday.*Unassigned.*Confirm the brief/i)
 expect(actions.querySelectorAll('li')).toHaveLength(3)
 expect(actions.textContent).not.toContain('TBD')
})
it('j/k navigate except while an input owns focus',()=>{
 const step=vi.fn();render(<><input aria-label="typing"/><Window row={row} at={1} of={2} onStep={step} layout="phone"/></>)
 fireEvent.keyDown(window,{key:'j'});fireEvent.keyDown(window,{key:'k'})
 expect(step.mock.calls).toEqual([[1],[-1]])
 screen.getByRole('textbox').focus();fireEvent.keyDown(window,{key:'j'});expect(step).toHaveBeenCalledTimes(2)
})
it('the call window shows one line per speaker', () => {
 render(<Window row={{...row,talk_stats:{words:{'Ivan Manfredi':120,Ada:30},total:150,ivan_pct:80}}} at={1} of={1} onStep={vi.fn()} layout="desktop" />)
 const lines=[...document.querySelectorAll('.sl4-talk small')].map(e=>e.textContent)
 expect(lines).toEqual(['Ivan Manfredi 120 words','Ada 30 words'])
})
