// @vitest-environment jsdom
import { cleanup, render, screen, act } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { useDensity, useNativeMotion } from './prefs'
function Fixture(){ const [density]=useDensity();const motion=useNativeMotion();return <output>{density}/{motion}</output> }
afterEach(()=>{cleanup();delete document.documentElement.dataset.density;delete document.documentElement.dataset.motion})
it('Settings reflects density and motion returned by the native View popover',()=>{
 render(<Fixture/>);act(()=>{document.documentElement.dataset.density='compact';document.documentElement.dataset.motion='subtle';window.dispatchEvent(new CustomEvent('brief:view'))})
 expect(screen.getByText('compact/subtle')).toBeTruthy()
 act(()=>{document.documentElement.dataset.density='comfortable';document.documentElement.dataset.motion='off';window.dispatchEvent(new CustomEvent('brief:view'))})
 expect(screen.getByText('comfortable/off')).toBeTruthy()
})
