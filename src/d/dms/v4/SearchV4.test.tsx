// @vitest-environment jsdom
import { createRef } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { SearchV4 } from './SearchV4'
afterEach(cleanup)
it('the narrow search opens the same field and keeps the existing search setter',()=>{
 const setQ=vi.fn(),ref=createRef<HTMLInputElement>();render(<div className="d-main" data-tier="t3"><SearchV4 ref={ref} q="" setQ={setQ} reach={20}/></div>)
 const trigger=screen.getByRole('button',{name:'Search people and messages'});fireEvent.click(trigger);expect(trigger.getAttribute('aria-expanded')).toBe('true')
 fireEvent.change(screen.getByRole('searchbox'),{target:{value:'Ada'}});expect(setQ).toHaveBeenCalledWith('Ada');expect(ref.current).toBe(screen.getByRole('searchbox'))
 fireEvent.keyDown(screen.getByRole('searchbox'),{key:'Escape'});expect(setQ).toHaveBeenCalledWith('');expect(trigger.getAttribute('aria-expanded')).toBe('false')
})
