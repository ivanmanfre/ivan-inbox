import { useEffect, useRef, useState } from 'react'
import { __readMotionLevel } from '../../../ds/motionLevel'
import type { PendingCardState } from '../../../wb/ops/usePendingCard'
import { More, MoreBody } from '../More'

export function CardMore({ st, name, layout, open, onClose, hasComment }: {
  st: PendingCardState; name: string; layout: 'desktop' | 'phone'; open: boolean; onClose: () => void; hasComment: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [present, setPresent] = useState(open)
  useEffect(() => {
    if (open) { setPresent(true); return }
    const level = __readMotionLevel()
    const timer = window.setTimeout(() => setPresent(false), level === 'off' ? 0 : level === 'subtle' ? 72 : 120)
    return () => window.clearTimeout(timer)
  }, [open])
  useEffect(() => {
    if (!open || layout === 'phone') return
    const pointer = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node) && !(e.target as Element).closest('[data-verb="more"], .d-confirm')) onClose() }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('.d-confirm')) { e.stopPropagation(); onClose() } }
    document.addEventListener('pointerdown', pointer); window.addEventListener('keydown', key)
    return () => { document.removeEventListener('pointerdown', pointer); window.removeEventListener('keydown', key) }
  }, [open, onClose, layout])
  if (layout === 'phone') return <More {...{ st, name, layout, open, onClose, hasComment }} />
  return open || present ? <div ref={ref} className={`op-more op4-more${open ? "" : " op4-more-exit"}`} role="group" aria-label={`More for ${name || 'this card'}`}><MoreBody st={st} name={name} hasComment={hasComment} /></div> : null
}
