import { useLayoutEffect, useRef, type RefObject } from 'react'
import { useMotionLevel } from '../../../ds/motionLevel'

const content = 'cubic-bezier(.16,1,.3,1)', panel = 'cubic-bezier(.22,1,.36,1)'
function copy(el: HTMLElement) {
  const n = el.cloneNode(true) as HTMLElement
  n.inert = true; n.setAttribute('aria-hidden', 'true'); n.dataset.cvGhost = ''
  for (const el of [n, ...n.querySelectorAll('[id],[data-card-id],[data-strip-id],[data-verb]')]) for (const key of ['id','data-card-id','data-strip-id','data-verb']) el.removeAttribute(key)
  n.querySelectorAll('input,textarea,select,button').forEach(e => e.setAttribute('disabled', ''))
  return n
}
function play(el: HTMLElement, frames: Keyframe[], ms: number, subtle: boolean, easing = content, delay = 0) {
  if (typeof el.animate !== 'function') return null
  return el.animate(frames, { duration: ms * (subtle ? .7 : 1), delay: delay * (subtle ? .7 : 1), easing, fill: 'backwards' })
}

/** Card-to-strip and subsequent gap closing: only a verdict/removal triggers FLIP. Poll reads do not. */
export function useReviewMotion(ref: RefObject<HTMLDivElement | null>) {
  const level = useMotionLevel()
  const previous = useRef(new Map<string, { rect: DOMRect; strip: boolean; copy: HTMLElement }>())
  useLayoutEffect(() => {
    const grid = ref.current
    if (!grid) { previous.current.clear(); return }
    const items = [...grid.children].filter(e => e instanceof HTMLElement && !e.hasAttribute('data-cv-ghost')) as HTMLElement[]
    const next = new Map<string, { rect: DOMRect; strip: boolean; copy: HTMLElement }>()
    for (const el of items) {
      const id = el.dataset.cardId ?? el.dataset.stripId
      if (id) next.set(id, { rect: el.getBoundingClientRect(), strip: el.hasAttribute('data-strip-id'), copy: copy(el) })
    }
    const before = previous.current
    const changed = [...before].filter(([id, b]) => !next.has(id) || b.strip !== next.get(id)!.strip)
    const animations: Animation[] = [], ghosts: HTMLElement[] = []
    if (changed.length && level !== 'off') {
      const base = grid.getBoundingClientRect()
      for (const [, b] of changed) {
        const ghost = b.copy
        Object.assign(ghost.style, { position: 'absolute', left: `${b.rect.left-base.left}px`, top: `${b.rect.top-base.top}px`, width: `${b.rect.width}px`, height: `${b.rect.height}px`, zIndex: '2', pointerEvents: 'none' })
        grid.append(ghost); ghosts.push(ghost)
        const a = play(ghost, [{ opacity: 1 }, { opacity: 0 }], 160, level === 'subtle'); if (a) animations.push(a)
      }
      for (const el of items) {
        const id = el.dataset.cardId ?? el.dataset.stripId, a = id && before.get(id), b = id && next.get(id)
        if (a && b && (a.rect.y !== b.rect.y || a.rect.x !== b.rect.x)) {
          const animation = play(el, [{ transform: `translate(${a.rect.x-b.rect.x}px,${a.rect.y-b.rect.y}px)` }, { transform: 'none' }], 400, level === 'subtle', panel)
          if (animation) animations.push(animation)
        }
      }
    }
    previous.current = next
    Promise.all(animations.map(a => a.finished.catch(() => {}))).then(() => ghosts.forEach(g => g.remove()))
    return () => { animations.forEach(a => a.cancel()); ghosts.forEach(g => g.remove()) }
  })
}

/** The existing sub-tab body keeps its DOM and handlers; an inert snapshot carries its exit. */
export function useSubtabMotion(ref: RefObject<HTMLDivElement | null>, tab: string, enabled: boolean) {
  const level = useMotionLevel()
  const previous = useRef<{ tab: string; copy: HTMLElement } | null>(null)
  useLayoutEffect(() => {
    const root = ref.current, body = root?.querySelector<HTMLElement>(':scope > .cn-split')
    if (!root || !body || !enabled) { previous.current = null; return }
    const old = previous.current, animations: Animation[] = []
    let ghost: HTMLElement | null = null
    if (old && old.tab !== tab && level !== 'off') {
      ghost = old.copy
      Object.assign(ghost.style, { position: 'absolute', left: `${body.offsetLeft}px`, top: `${body.offsetTop}px`, width: `${body.offsetWidth}px`, height: `${body.offsetHeight}px`, zIndex: '2', pointerEvents: 'none' })
      root.append(ghost)
      const exit = play(ghost, [{ opacity: 1 }, { opacity: 0 }], 120, level === 'subtle'); if (exit) animations.push(exit)
      const enter = play(body, [{ opacity: 0 }, { opacity: 1 }], 240, level === 'subtle'); if (enter) animations.push(enter)
      const blocks = [...body.querySelectorAll<HTMLElement>('.cv2-bar,.cv2-answer,.cv2-rc,.cv2-idea,.cv2-tiles > *,[data-bx-block]')].slice(0, 12)
      blocks.forEach((el, i) => { const a = play(el, [{ opacity: 0, transform: 'translateY(5px)' }, { opacity: 1, transform: 'none' }], 380, level === 'subtle', content, 40+i*18); if (a) animations.push(a) })
    }
    const snapshot = () => { previous.current = { tab, copy: copy(body) } }
    snapshot()
    const observer = new MutationObserver(snapshot); observer.observe(body, { childList: true, characterData: true, subtree: true })
    Promise.all(animations.map(a => a.finished.catch(() => {}))).then(() => ghost?.remove())
    return () => { observer.disconnect(); animations.forEach(a => a.cancel()); ghost?.remove() }
  }, [ref, tab, enabled, level])
}
