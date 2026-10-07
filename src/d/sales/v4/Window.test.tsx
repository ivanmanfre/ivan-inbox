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
 for(const [a,b] of [['You owe','They owe'],['They owe','Next step'],['Next step','Follow-up draft'],['Follow-up draft','Summary']])expect(text.indexOf(a)).toBeLessThan(text.indexOf(b))
 expect(document.querySelector('.sl-room [aria-expanded="false"]')).toBeTruthy()
 fireEvent.click(screen.getByRole('button',{name:'Copy'}))
 await waitFor(()=>expect(screen.getByRole('button',{name:'✓ Copied'})).toBeTruthy())
 expect(writeText).toHaveBeenCalledWith('Follow up text')
})
it('j/k navigate except while an input owns focus',()=>{
 const step=vi.fn();render(<><input aria-label="typing"/><Window row={row} at={1} of={2} onStep={step} layout="phone"/></>)
 fireEvent.keyDown(window,{key:'j'});fireEvent.keyDown(window,{key:'k'})
 expect(step.mock.calls).toEqual([[1],[-1]])
 screen.getByRole('textbox').focus();fireEvent.keyDown(window,{key:'j'});expect(step).toHaveBeenCalledTimes(2)
})
