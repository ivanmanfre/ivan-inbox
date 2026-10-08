import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { __readMotionLevel, useMotionLevel } from '../../../ds/motionLevel'
/** No flash for a fast read; a visible skeleton stays at least 380ms. */
export function useDeferredLoading(loading: boolean) {
  const [shown, setShown] = useState(false)
  const since = useRef(0)
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (loading) { since.current = Date.now(); setShown(true) } else { setShown(false); since.current = 0 }
    }, loading ? 120 : Math.max(0, 380 - (Date.now() - since.current)))
    return () => window.clearTimeout(timer)
  }, [loading])
  return shown
}
export function animateOps(el: HTMLElement, frames: Keyframe[], ms: number, delay = 0, easing = 'cubic-bezier(.2,.7,.2,1)') {
  const level = __readMotionLevel()
  if (level === 'off' || !el.animate) return null
  el.getAnimations?.().forEach(a => a.finish())
  return el.animate(frames, { duration: ms * (level === 'subtle' ? .6 : 1), delay: delay * (level === 'subtle' ? .6 : 1), easing, fill: 'backwards' })
}
const exitEase = 'cubic-bezier(.23,1,.32,1)'
function inertCopy(el: HTMLElement) {
  const copy = el.cloneNode(true) as HTMLElement
  for (const n of [copy, ...copy.querySelectorAll('*')]) for (const attr of ['data-card', 'data-op-row', 'data-reaction', 'data-verb', 'data-op-block', 'aria-current']) n.removeAttribute(attr)
  copy.inert = true; copy.setAttribute('aria-hidden', 'true'); copy.classList.add('op4-ghost')
  copy.querySelectorAll('[id]').forEach(n => n.removeAttribute('id'))
  copy.querySelectorAll('iframe,video,audio,object,embed,source').forEach(n => n.remove())
  copy.querySelectorAll('textarea,input,select,button').forEach(n => n.setAttribute('tabindex', '-1'))
  return copy
}
/** Copies are inert and eventless; they carry only the outgoing visual. */
export function captureAction(root: HTMLElement | null, id: string) {
  const row = [...root?.querySelectorAll<HTMLElement>('[data-op-row]') ?? []].find(r => r.dataset.opRow === id)
  return row ? { copy: inertCopy(row), rect: row.getBoundingClientRect() } : null
}
export async function finishAction(root: HTMLElement | null, id: string, verb: string, row: ReturnType<typeof captureAction>, delay = 0) {
  if (!root || __readMotionLevel() === 'off') return
  const approve = verb === 'Approved' || verb === 'Marked handled'
  const animations: (Animation | null)[] = []
  let check: HTMLElement | null = null
  const card = [...root.querySelectorAll<HTMLElement>('[data-card]')].find(c => c.dataset.card === id)
  const face = card?.querySelector<HTMLElement>('.op-kp .d-face')
  if (face && approve) {
    check = document.createElement('span'); check.className = 'op4-check'; check.textContent = '✓'; check.setAttribute('aria-hidden', 'true')
    face.append(check)
    animations.push(animateOps(check, [{ opacity: 0, transform: 'scale(0)' }, { opacity: 1, transform: 'scale(1.3)', offset: .65 }, { opacity: 1, transform: 'scale(1)' }], 420, 0, 'cubic-bezier(.34,1.56,.64,1)'))
    face.classList.add('op4-complete')
  } else if (face) animations.push(animateOps(face, [{ opacity: 1 }, { opacity: 0 }], 120, 0, exitEase))
  if (row) {
    const queue = root.querySelector<HTMLElement>('.op4-queue')
    if (queue) {
      const box = queue.getBoundingClientRect()
      Object.assign(row.copy.style, { position: 'absolute', left: `${row.rect.left - box.left + queue.scrollLeft}px`, top: `${row.rect.top - box.top + queue.scrollTop}px`, width: `${row.rect.width}px`, height: `${row.rect.height}px`, zIndex: '3' })
      queue.append(row.copy)
      animations.push(animateOps(row.copy, approve ? [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-4px)' }] : [{ opacity: 1 }, { opacity: 0 }], approve ? 160 : 120, delay, exitEase))
    }
  }
  await Promise.all(animations.filter((a): a is Animation => !!a).map(a => a.finished.catch(() => {})))
  row?.copy.remove(); check?.remove(); face?.classList.remove('op4-complete')
}
/** Event keys drive choreography. No animation on mount or unchanged poll reads. */
export function useOpsMotion(root: RefObject<HTMLDivElement | null>, card: string, lane: string) {
  const level = useMotionLevel()
  const previous = useRef<{ card: string; lane: string; copy: HTMLElement | null; scroll: number } | null>(null)
  const bounds = useRef(new Map<string, DOMRect>())
  useLayoutEffect(() => {
    const el = root.current
    if (!el) return
    const pane = el.querySelector<HTMLElement>('.op4-detail'), content = pane?.querySelector<HTMLElement>('[data-card],.op-rx')
    const old = previous.current
    const animations: (Animation | null)[] = []
    const ghosts: HTMLElement[] = []
    if (!old && level !== 'off') el.querySelectorAll<HTMLElement>('.d-answer,.op4-queue,.op4-detail').forEach((block, i) => animations.push(animateOps(block, [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], 380, 40 + i * 18)))
    if (old && level !== 'off') {
      if (old.card !== card && pane) {
        if (old.copy && typeof pane.animate === 'function') {
          Object.assign(old.copy.style, { position: 'absolute', left: '0', top: `${pane.scrollTop - old.scroll}px`, width: '100%', zIndex: '4', pointerEvents: 'none' })
          pane.append(old.copy); ghosts.push(old.copy)
          animations.push(animateOps(old.copy, [{ opacity: 1 }, { opacity: 0 }], 120, 0, exitEase))
        }
        pane.querySelectorAll<HTMLElement>('[data-op-block]').forEach((block, i) => {
          if (!block.closest('.op4-ghost')) animations.push(animateOps(block, [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], 240, 40 + Math.min(i, 3) * 18))
        })
      }
      if (old.lane !== lane) el.querySelectorAll<HTMLElement>('.op4-rows [data-op-row]').forEach((row, i) => { if (i < 10) animations.push(animateOps(row, [{ opacity: 0, transform: 'translateY(5px)' }, { opacity: 1, transform: 'none' }], 380, 40 + i * 18)) })
    }
    previous.current = { card, lane, copy: content ? inertCopy(content) : null, scroll: pane?.scrollTop ?? 0 }
    Promise.all(animations.filter((a): a is Animation => !!a).map(a => a.finished.catch(() => {}))).then(() => ghosts.forEach(g => g.remove()))
    return () => { animations.forEach(a => a?.finish()); ghosts.forEach(g => g.remove()) }
  }, [root, card, lane, level])
  // Gap closing uses a transform, not a height animation. The ID set is the event.
  useLayoutEffect(() => {
    const rows = root.current?.querySelectorAll<HTMLElement>('.op4-rows [data-op-row]')
    const next = new Map<string, DOMRect>()
    rows?.forEach(el => next.set(el.dataset.opRow!, el.getBoundingClientRect()))
    if ([...bounds.current.keys()].some(id => !next.has(id))) rows?.forEach(el => {
      const old = bounds.current.get(el.dataset.opRow!), rect = next.get(el.dataset.opRow!)!
      if (old && old.y !== rect.y) animateOps(el, [{ transform: `translateY(${old.y - rect.y}px)` }, { transform: 'none' }], 380, 0, 'linear(0,.01,.05,.13,.25,.41,.58,.73,.85,.94,.99,1)')
    })
    bounds.current = next
  })
  // Live loops pause while hidden/offscreen. Observer changes never animate a card.
  useEffect(() => {
    const el = root.current
    if (!el) return
    const visible = new Set<Element>()
    const update = () => el.querySelectorAll<HTMLElement>('.ds-working,.ds-live-dot,.op4-live,.op4-busy').forEach(n => n.dataset.ambient = String(!document.hidden && level === 'full' && visible.has(n)))
    const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(entries => { for (const e of entries) { if (e.intersectionRatio >= .15) visible.add(e.target); else visible.delete(e.target) } update() }, { threshold: .15 })
    const watch = () => { el.querySelectorAll('.ds-working,.ds-live-dot,.op4-live,.op4-busy').forEach(n => observer?.observe(n)); update() }
    const mutations = new MutationObserver(watch); mutations.observe(el, { childList: true, subtree: true })
    document.addEventListener('visibilitychange', update); watch()
    return () => { mutations.disconnect(); observer?.disconnect(); document.removeEventListener('visibilitychange', update) }
  }, [root, level])
}
export function animateReceipt(id: string) {
  const receipt = [...document.querySelectorAll<HTMLElement>('.d-toast')].find(t => t.textContent?.includes(id))
  if (receipt) animateOps(receipt, [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], 240)
}
