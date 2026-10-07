// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, fireEvent, screen } from '@testing-library/react'
import { Figure, slotRead } from './Figure'
import { rollSlots } from './Count'
afterEach(cleanup)
it('adapts reads without inventing zero and preserves stale values',()=>{
  expect(slotRead({value:null,failed:null},Number)).toEqual({wait:true})
  expect(slotRead({value:null,failed:'offline'},Number)).toEqual({fail:'offline'})
  expect(slotRead({value:0,failed:null},Number)).toEqual({v:0})
  expect(slotRead({value:17,failed:'offline'},Number)).toEqual({v:17,stale:'offline'})
})
it('shows failure and retry, with no numeric count',()=>{
  const retry=vi.fn();render(<Figure r={{fail:'offline'}} retry={retry}/>)
  expect(document.querySelector('[data-read="failed"]')).toBeTruthy()
  expect(document.querySelector('[data-count]')).toBeNull()
  fireEvent.click(screen.getByRole('button',{name:'Retry'}));expect(retry).toHaveBeenCalledOnce()
})
it('marks a verified zero separately from stale values',()=>{
  const view=render(<Figure r={{v:0}}/>)
  expect(document.querySelector('[data-read="zero"] [data-count="0"]')).toBeTruthy()
  view.rerender(<Figure r={{v:17,stale:'offline'}} retry={vi.fn()}/>)
  expect(screen.getByRole('button',{name:'Stale'})).toBeTruthy()
})
it('aligns count slots from the right and moves only changed characters',()=>{
  expect(rollSlots('129','139').map(s=>s.changed)).toEqual([false,true,false])
  expect(rollSlots('99','100').map(s=>s.old)).toEqual(['','9','9'])
})
