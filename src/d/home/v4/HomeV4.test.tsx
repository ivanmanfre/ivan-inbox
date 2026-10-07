// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { renderInFrame } from '../../test-utils'
import { parseDHash } from '../../route'
vi.mock('../Tasks',()=>({HomeTasks:()=> <section aria-label="Mocked tasks"/>}))
vi.mock('../reads',()=>({useHome:()=>({now:Date.parse('2026-10-08T10:00:00Z'),lanes:Object.fromEntries(['cc','gov','pauses','attempts','ready'].map(k=>[k,{value:null,failed:null}])),content:Object.fromEntries(['ivan','risedtc','arch'].map(k=>[k,{wait:true}])),drafts:Object.fromEntries(['ivan','risedtc','arch'].map(k=>[k,{wait:true}])),retry:{content:vi.fn(),drafts:vi.fn(),lanes:vi.fn()}})}))
import HomeV4 from './HomeV4'
afterEach(cleanup)
for(const layout of ['phone','desktop'] as const)it(`renders all seats and safe destinations in ${layout} without inventing zeros`,()=>{
 renderInFrame(<HomeV4 layout={layout} route={parseDHash('#exp/d/home')} navigate={vi.fn()}/>,{layout,hash:'#exp/d/home'})
 expect(document.querySelector('[data-layout-v4=home]')).toBeTruthy()
 for(const seat of ['ivan','risedtc','arch'])expect(document.querySelector(`a[href="#exp/d/dms?seat=${seat}"]`)).toBeTruthy()
 expect(document.querySelector('[data-count="0"]')).toBeNull()
 expect(document.querySelector('[aria-label="Mocked tasks"]')).toBeTruthy()
})
