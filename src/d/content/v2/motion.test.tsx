// @vitest-environment jsdom
import { useRef } from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useReviewMotion } from './motion'
function Fixture({ strip }: { strip: boolean }) {
 const root=useRef<HTMLDivElement>(null);useReviewMotion(root)
 return <div ref={root}>{strip ? <article data-strip-id="1">Approved</article> : <article data-card-id="1">Draft</article>}<article data-card-id="2">Next</article></div>
}
afterEach(() => { cleanup();vi.restoreAllMocks();document.documentElement.classList.remove('brief-motion-off') })
function setup() {
 vi.spyOn(document,'visibilityState','get').mockReturnValue('visible')
 vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockImplementation(function(this: HTMLElement) { const y=this.dataset.cardId==='2' ? (this.parentElement?.firstElementChild?.hasAttribute('data-strip-id') ? 20 : 100) : 0;return new DOMRect(0,y,100,100) })
 const animate=vi.fn(() => ({finished:Promise.resolve(),cancel:vi.fn()} as unknown as Animation));vi.stubGlobal('Animation',class {})
 Object.defineProperty(HTMLElement.prototype,'animate',{configurable:true,value:animate});return animate
}
it('a verdict fades the previous card and slides the following card up with transform-only FLIP', () => {
 const animate=setup(),r=render(<Fixture strip={false}/>);expect(animate).not.toHaveBeenCalled();r.rerender(<Fixture strip />)
 expect(animate.mock.calls.some(c => (c as unknown as [Keyframe[],KeyframeAnimationOptions])[1].duration===160)).toBe(true)
 expect(animate.mock.calls.some(c => { const [f,o]=c as unknown as [Keyframe[],KeyframeAnimationOptions];return o.duration===400 && f[0].transform==='translate(0px,80px)' && f[1].transform==='none' })).toBe(true)
})
it('motion Off does not replay a verdict reflow', () => {const animate=setup();document.documentElement.classList.add('brief-motion-off');const r=render(<Fixture strip={false}/>);r.rerender(<Fixture strip/>);expect(animate).not.toHaveBeenCalled()})
