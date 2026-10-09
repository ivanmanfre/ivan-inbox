import { useEffect, useRef, type ReactNode, type TouchEvent } from 'react'
import { useFrameMaybe } from '../shell/frame'
import { DIcon } from './icons'

// THE SHEET. Phone: from the bottom, with a grab bar. Desktop: a right-hand
// panel over the page (the Lanes ledger / campaign sheets). Escape and the
// scrim close it. `side="top"` drops it under the phone top bar (the bell).
type Props = {
  open: boolean
  onClose: () => void
  title: ReactNode
  sub?: ReactNode
  /** Right of the title (e.g. Clear all). The close key is always drawn. */
  head?: ReactNode
  children: ReactNode
  foot?: ReactNode
  side?: 'auto' | 'bottom' | 'right' | 'top'
  /** Extra class on the sheet box. */
  className?: string
  label?: string
}

export function Sheet({ open, onClose, title, sub, head, children, foot, side = 'auto', className, label }: Props) {
  const f = useFrameMaybe()
  const box = useRef<HTMLDivElement>(null)
  const drag = useRef<{ y: number; x: number } | null>(null)
  const where = side === 'auto' ? (f?.layout === 'desktop' ? 'right' : 'bottom') : side
  const startDrag = (e: TouchEvent) => { drag.current = { y: e.touches[0].clientY, x: e.touches[0].clientX } }
  const endDrag = (e: TouchEvent) => {
    const start = drag.current
    drag.current = null
    if (!start || where !== 'bottom') return
    const dy = e.changedTouches[0].clientY - start.y
    const dx = e.changedTouches[0].clientX - start.x
    if (dy > 72 && dy > Math.abs(dx) * 1.4) onClose()
  }
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    window.addEventListener('keydown', onKey)
    box.current?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return (
    <>
      <div className={`d-scrim d-scrim-${where}`} onClick={onClose} aria-hidden="true" />
      <div ref={box} tabIndex={-1} role="dialog" aria-modal="true" aria-label={label ?? (typeof title === 'string' ? title : undefined)}
        className={`d-sheet d-sheet-${where}${className ? ' ' + className : ''}`}>
        {where === 'bottom' && <div className="d-grab" aria-hidden="true" onTouchStart={startDrag} onTouchEnd={endDrag} />}
        <div className="d-sheet-h" onTouchStart={startDrag} onTouchEnd={endDrag}>
          <div className="d-sheet-t"><b>{title}</b>{sub != null && <small>{sub}</small>}</div>
          {head}
          <button type="button" className="d-ib" aria-label="Close" onClick={onClose}><DIcon name="x" /></button>
        </div>
        <div className="d-sheet-b">{children}</div>
        {foot != null && <div className="d-sheet-f">{foot}</div>}
      </div>
    </>
  )
}
