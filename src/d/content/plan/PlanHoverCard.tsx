import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import type { PlanRead } from '../../../lib/contentPlan'
import { useMotionLevel } from '../../../ds/motionLevel'
import { ST_WORD, qaLine, quoteFor, readLine, reasonFor, resultLine, traitLine, type Acct, type PlanItem } from './planBrain'

// The Weeks hover card (spec 2026-10-12 §3a, R2.3, R3.5). Beside the card, flipped to its left near the right
// edge, clamped to the viewport; it grows from the edge that faces the card. Read only, never takes the pointer.

export const HOVER_W = 340
const GAP = 10
const EDGE = 8

export const LINK_ALLOWED = 'Link allowed: boosted lead magnet.'

type Place = { left: number; top: number; flip: boolean; oy: number }

function place(anchor: DOMRect, h: number): Place {
  const vw = window.innerWidth, vh = window.innerHeight
  let left = anchor.right + GAP
  const flip = left + HOVER_W > vw - EDGE
  if (flip) left = anchor.left - HOVER_W - GAP
  left = Math.max(EDGE, left)
  const top = Math.max(EDGE, Math.min(anchor.top, vh - h - EDGE))
  // The vertical origin sits level with the card's middle, inside the hover card.
  const oy = Math.max(0, Math.min(h, anchor.top + anchor.height / 2 - top))
  return { left, top, flip, oy }
}

export function PlanHoverCard({ id, item, anchor, read, onClose }: { id?: string; item: PlanItem; anchor: DOMRect; read: PlanRead; onClose: () => void }) {
  const level = useMotionLevel()
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<Place>(() => place(anchor, 0))
  useLayoutEffect(() => {
    const h = ref.current?.offsetHeight ?? 0
    setPos(place(anchor, h))
  }, [anchor, item.key])
  // Fixed to where the card was: a scroll or a resize moves the card, so the hover card goes. Escape closes it
  // wherever focus is (a mouse-opened card has no focus on it).
  useEffect(() => {
    const off = () => onClose()
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('scroll', off, { capture: true, passive: true })
    window.addEventListener('resize', off)
    window.addEventListener('keydown', key)
    return () => { window.removeEventListener('scroll', off, { capture: true }); window.removeEventListener('resize', off); window.removeEventListener('keydown', key) }
  }, [onClose])

  const acct = read.account as Acct
  const reason = reasonFor(item, acct)
  const quote = quoteFor(item)
  const trait = traitLine(item, acct)
  const guess = readLine(item, acct)
  const qa = qaLine(item)
  const b = item.brain
  const link = !!(b?.has_link && b.flags?.boosted && b.flags?.lm)
  const result = item.st === 'published' ? resultLine(item, read.brain_strip) : null

  const style = {
    left: `${pos.left}px`, top: `${pos.top}px`, width: `${HOVER_W}px`,
    '--pl2-hc-ox': pos.flip ? '100%' : '0%', '--pl2-hc-oy': `${pos.oy}px`, '--pl2-hc-tx': pos.flip ? '4px' : '-4px',
  } as CSSProperties
  return createPortal(
    <div ref={ref} id={id} role="tooltip" className={`pl2-hc pl2-s-${item.st}`} data-motion={level} data-flip={pos.flip || undefined} style={style}>
      <span className="pl2-hc-st">
        <span className="pl2-st"><i className="pl2-dot" aria-hidden="true" />{ST_WORD[item.st]}</span>
        {item.suggested && <span className="pl2-hc-nd">No day yet</span>}
      </span>
      <h4>{item.title || 'Untitled post'}</h4>
      {reason && <><div className="pl2-hc-l">Why this post</div><p>{reason}</p></>}
      {quote && <q className="pl2-q">{quote}</q>}
      {trait && <><div className="pl2-hc-l">Why it should do well</div><p>{trait}</p></>}
      {guess && <><div className="pl2-hc-l">Brain guess</div><p><b>{guess.sign}.</b> {guess.text} <span className="pl2-rel">{guess.rel}.</span></p></>}
      {qa && <><div className="pl2-hc-l">Quality check</div><p>{qa}</p></>}
      {link && <p className="pl2-hc-link">{LINK_ALLOWED}</p>}
      {result && <><div className="pl2-hc-l">Result</div><p>{result}</p></>}
    </div>,
    document.body,
  )
}
