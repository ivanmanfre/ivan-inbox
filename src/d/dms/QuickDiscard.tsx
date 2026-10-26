import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import { Trash2 } from 'lucide-react'
import './quick-discard.css'

// Shared across rows: trackpad momentum must never reveal the next row under the cursor.
let wheelQuietUntil = 0
const WIDTH = 72
const DISTANCE = 44

export function QuickDiscard({ name, run, children }: { name: string; run: () => Promise<void>; children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null)
  const pending = useRef(false)
  const opened = useRef(false)
  const gesture = useRef<{ x: number; y: number; start: number; axis: 'x' | 'y' | null } | null>(null)
  const suppressClickUntil = useRef(0)
  const [busy, setBusy] = useState(false)
  const [offset, setOffset] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [revealed, setRevealed] = useState(false)
  const reveal = (show: boolean) => {
    opened.current = show
    setRevealed(show)
    setOffset(show ? WIDTH : 0)
    setDragging(false)
  }
  const commit = async () => {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    reveal(false)
    try { await run() } finally { pending.current = false; setBusy(false) }
  }
  useEffect(() => {
    const el = root.current
    if (!el) return
    let distance = 0, last = 0
    let timer: ReturnType<typeof setTimeout>
    const wheel = (e: WheelEvent) => {
      if (e.ctrlKey || Math.abs(e.deltaX) <= Math.abs(e.deltaY) * 1.5) return
      if ((e.target as Element).closest('button,input,textarea,a')) return
      const now = Date.now()
      e.preventDefault()
      if (now < wheelQuietUntil) { wheelQuietUntil = now + 350; return }
      if (pending.current) return
      if (now - last > 180) distance = 0
      last = now
      distance -= e.deltaX * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientWidth : 1)
      setOffset(Math.max(0, Math.min((opened.current ? WIDTH : 0) + distance, WIDTH)))
      setDragging(true)
      clearTimeout(timer)
      timer = setTimeout(() => { distance = 0; reveal(opened.current) }, 180)
      if ((!opened.current && distance >= DISTANCE) || (opened.current && distance <= -DISTANCE)) {
        wheelQuietUntil = now + 800
        reveal(!opened.current)
        distance = 0
      }
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => { el.removeEventListener('wheel', wheel); clearTimeout(timer) }
  }, [])
  const down = (e: PointerEvent) => {
    if (e.button !== 0 || pending.current || (e.target as Element).closest('button,input,textarea,a')) return
    gesture.current = { x: e.clientX, y: e.clientY, start: opened.current ? WIDTH : 0, axis: null }
  }
  const move = (e: PointerEvent) => {
    const g = gesture.current
    if (!g) return
    const x = e.clientX - g.x, y = e.clientY - g.y
    if (!g.axis && Math.max(Math.abs(x), Math.abs(y)) > 8) {
      g.axis = Math.abs(x) > Math.abs(y) * 1.5 && (x > 0 || g.start > 0) ? 'x' : 'y'
      if (g.axis === 'x') e.currentTarget.setPointerCapture?.(e.pointerId)
    }
    if (g.axis !== 'x') return
    e.preventDefault()
    suppressClickUntil.current = Date.now() + 500
    setDragging(true)
    setOffset(Math.max(0, Math.min(g.start + x, WIDTH)))
  }
  const end = (e: PointerEvent, cancel = false) => {
    const g = gesture.current
    gesture.current = null
    if (g?.axis === 'x') {
      suppressClickUntil.current = Date.now() + 500
      reveal(cancel ? opened.current : g.start + e.clientX - g.x >= DISTANCE)
    }
  }
  return <div ref={root} className={`dm-quick${offset ? ' dm-quick-shifted' : ''}${dragging ? ' dm-quick-moving' : ''}`} data-revealed={revealed || undefined}
    onPointerDown={down} onPointerMove={move} onPointerUp={e => end(e)} onPointerCancel={e => end(e, true)} onLostPointerCapture={e => end(e, true)}
    onKeyDown={e => {
      if (revealed && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); reveal(false); root.current?.querySelector<HTMLElement>('[data-d-row]')?.focus(); return }
      if ((e.target as Element).closest('button,input,textarea,a')) return
      if (e.key === 'ArrowRight' || (revealed && (e.key === 'ArrowLeft' || e.key === 'Escape'))) {
        e.preventDefault(); e.stopPropagation(); reveal(e.key === 'ArrowRight')
      }
    }}
    onClickCapture={e => {
      if ((e.target as Element).closest('.dm-quick-key')) return
      if (Date.now() < suppressClickUntil.current || revealed) { e.preventDefault(); e.stopPropagation(); if (Date.now() >= suppressClickUntil.current) reveal(false) }
    }}>
    <button type="button" className="dm-quick-key" data-verb="quick-discard" disabled={busy || !revealed}
      aria-hidden={!revealed} tabIndex={revealed ? 0 : -1} aria-label={`Discard draft to ${name}`} title="Discard draft · Undo available"
      onClick={e => { e.stopPropagation(); void commit() }}><Trash2 size={20} aria-hidden="true" /><span>{busy ? '…' : 'Discard'}</span></button>
    <div className="dm-quick-face" style={{ transform: `translateX(${offset}px)` }}>{children}</div>
  </div>
}
