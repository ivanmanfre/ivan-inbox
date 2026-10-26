import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import { Trash2 } from 'lucide-react'
import './quick-discard.css'

// Shared across rows: trackpad momentum must never discard the row that moves under the cursor.
let wheelQuietUntil = 0
const DISTANCE = 88

export function QuickDiscard({ name, run, children }: { name: string; run: () => Promise<void>; children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null)
  const pending = useRef(false)
  const gesture = useRef<{ x: number; y: number; axis: 'x' | 'y' | null } | null>(null)
  const suppressClickUntil = useRef(0)
  const [busy, setBusy] = useState(false)
  const [offset, setOffset] = useState(0)
  const commit = async () => {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    setOffset(0)
    try { await run() } finally { pending.current = false; setBusy(false) }
  }
  const latest = useRef(commit)
  latest.current = commit
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
      distance = Math.max(0, distance - e.deltaX * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientWidth : 1))
      setOffset(Math.min(distance, 110))
      clearTimeout(timer)
      timer = setTimeout(() => { distance = 0; setOffset(0) }, 180)
      if (distance >= DISTANCE) {
        wheelQuietUntil = now + 800
        distance = 0
        void latest.current()
      }
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => { el.removeEventListener('wheel', wheel); clearTimeout(timer) }
  }, [])
  const down = (e: PointerEvent) => {
    if (e.button !== 0 || pending.current || (e.target as Element).closest('button,input,textarea,a')) return
    gesture.current = { x: e.clientX, y: e.clientY, axis: null }
  }
  const move = (e: PointerEvent) => {
    const g = gesture.current
    if (!g) return
    const x = e.clientX - g.x, y = e.clientY - g.y
    if (!g.axis && Math.max(Math.abs(x), Math.abs(y)) > 8) {
      g.axis = x > 0 && x > Math.abs(y) * 1.5 ? 'x' : 'y'
      if (g.axis === 'x') e.currentTarget.setPointerCapture?.(e.pointerId)
    }
    if (g.axis !== 'x') return
    e.preventDefault()
    suppressClickUntil.current = Date.now() + 500
    setOffset(Math.max(0, Math.min(x, 110)))
  }
  const end = (e: PointerEvent, cancel = false) => {
    const g = gesture.current
    gesture.current = null
    setOffset(0)
    if (g?.axis === 'x') {
      suppressClickUntil.current = Date.now() + 500
      if (!cancel && e.clientX - g.x >= DISTANCE) void commit()
    }
  }
  return <div ref={root} className={`dm-quick${offset ? ' dm-quick-moving' : ''}`} data-ready={offset >= DISTANCE || undefined}
    onPointerDown={down} onPointerMove={move} onPointerUp={e => end(e)} onPointerCancel={e => end(e, true)} onLostPointerCapture={e => end(e, true)}
    onClickCapture={e => { if (Date.now() < suppressClickUntil.current) { e.preventDefault(); e.stopPropagation() } }}>
    <span className="dm-quick-reveal" aria-hidden="true">{offset >= DISTANCE ? 'Release' : 'Discard'}</span>
    <div className="dm-quick-face" style={{ transform: `translateX(${offset}px)` }}>
      {children}
      <button type="button" className="dm-quick-key" data-verb="quick-discard" disabled={busy}
        aria-label={`Discard draft to ${name}`} title="Discard draft · swipe right · Undo available"
        onClick={e => { e.stopPropagation(); void commit() }}><Trash2 size={15} aria-hidden="true" /><span>{busy ? '…' : 'Discard'}</span></button>
    </div>
  </div>
}
