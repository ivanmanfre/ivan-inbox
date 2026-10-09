import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { DIcon } from '../../ui/icons'
import type { Lane } from '../model'

// BRIEF 4 CONTENT PRIMITIVES (SPEC-content §2.1). D does not load src/ds's
// stylesheet, so the content v2 tree draws the same controls here, on the
// --ds-* role tokens (tokens.css §10) and the cv2.css sheet: one seat switch,
// one status pill vocabulary, one ⋯ menu. Nothing in this file writes.

export const SEAT_INITIALS: Record<Lane, string> = { ivan: 'IM', risedtc: 'MD', arch: 'DS' }

/** The seat's identity: the initials chip in the seat colour. */
export function SeatAv({ lane, size = 20 }: { lane: Lane; size?: 20 | 28 }) {
  return <i className={`cv2-av cv2-av-${lane}`} data-size={size} aria-hidden="true">{SEAT_INITIALS[lane]}</i>
}

export type SegOption = { id: string; label: ReactNode; count?: number | string | null; title?: string }

/**
 * The one segmented control (seat switch, Month/Lines, LM stage): a solid thumb
 * that glides between options (transform + width on a pseudo layer, measured,
 * never per frame). Counts ride inside the option at tabular width.
 */
export function Seg({ options, value, onChange, label, size = 'md', verb }: {
  options: SegOption[]; value: string; onChange: (id: string) => void; label: string; size?: 'md' | 'sm'; verb?: string
}) {
  const box = useRef<HTMLDivElement>(null)
  const [ready, setReady] = useState(false)
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const place = () => {
      const on = el.querySelector<HTMLElement>('[aria-selected="true"]')
      if (!on) { el.style.setProperty('--thumb-w', '0px'); return }
      el.style.setProperty('--thumb-x', `${on.offsetLeft}px`)
      el.style.setProperty('--thumb-w', `${on.offsetWidth}px`)
    }
    place()
    // The first placement does not animate (no glide in from the left edge).
    if (!ready) requestAnimationFrame(() => setReady(true))
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place)
    ro?.observe(el)
    return () => ro?.disconnect()
  }, [value, options.length, options.map(o => o.count).join(','), ready]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div ref={box} className={`cv2-seg cv2-seg-${size}`} data-ready={ready || undefined} role="tablist" aria-label={label}>
      {options.map(o => (
        <button key={o.id} type="button" role="tab" aria-selected={o.id === value} title={o.title} data-verb={verb ? `${verb}-${o.id}` : undefined}
          onClick={() => onChange(o.id)}>
          <span>{o.label}</span>
          {o.count != null && <b className="cv2-n">{o.count}</b>}
        </button>
      ))}
    </div>
  )
}

/** The status pairs (SPEC-content §2.3): ok / info / warn / bad, posted recedes on sage, queue is an outline. */
export type Tone = 'ok' | 'info' | 'warn' | 'bad' | 'posted' | 'queue' | 'neutral'
export function Pill({ tone, children, title }: { tone: Tone; children: ReactNode; title?: string }) {
  return <span className={`cv2-pill cv2-pill-${tone}`} title={title}>{children}</span>
}

export type MenuItem = { key: string; label: ReactNode; run?: () => void; danger?: boolean; href?: string; external?: boolean; node?: ReactNode; sep?: boolean }

/**
 * The card's ⋯: a small popover of existing actions, drawn into <body> at the
 * key's position (the calendar's stage clips its children). The panel stays
 * mounted while closed (hidden), so an action that is still awaiting its
 * confirm (Unpublish) is never unmounted mid-flight. Escape, a click outside
 * or a pick closes it.
 */
export function Menu({ label, items, head, verb = 'card-more', className }: { label: string; items: MenuItem[]; head?: ReactNode; verb?: string; className?: string }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 })
  const btn = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const off = (e: PointerEvent) => { const t = e.target as Node; if (!btn.current?.contains(t) && !panel.current?.contains(t)) setOpen(false) }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('.d-confirm')) { e.stopPropagation(); setOpen(false); btn.current?.focus() } }
    const away = () => setOpen(false)
    document.addEventListener('pointerdown', off, true)
    window.addEventListener('keydown', key, true)
    window.addEventListener('resize', away)
    document.addEventListener('scroll', away, true)
    return () => { document.removeEventListener('pointerdown', off, true); window.removeEventListener('keydown', key, true); window.removeEventListener('resize', away); document.removeEventListener('scroll', away, true) }
  }, [open])
  if (!items.length) return null
  const toggle = () => {
    const r = btn.current?.getBoundingClientRect()
    if (r) {
      // The phone's menu rows are 52 tall (phone-ox.css), the desktop's 36.
      const ph = document.documentElement.dataset.layout === 'phone'
      const w = ph ? Math.min(280, window.innerWidth - 16) : 228, h = (head ? 44 : 8) + items.length * (ph ? 52 : 36)
      const left = Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8))
      const top = r.bottom + 4 + h > window.innerHeight - 8 ? Math.max(8, r.top - 4 - h) : r.bottom + 4
      setPos({ top, left })
    }
    setOpen(o => !o)
    if (!open) requestAnimationFrame(() => panel.current?.querySelector<HTMLElement>('[role="menuitem"],button,a')?.focus({ preventScroll: true }))
  }
  const body = (
    <div ref={panel} className="cv2-menu" role="menu" aria-label={label} hidden={!open} style={{ top: pos.top, left: pos.left }} onClick={e => e.stopPropagation()}>
      {head && <div className="cv2-menu-h">{head}</div>}
      {items.map(i => i.sep ? <hr key={i.key} /> : i.node ? <div key={i.key} className={`cv2-mi${i.danger ? ' cv2-mi-d' : ''}`} role="none">{i.node}</div>
        : i.href ? <a key={i.key} className="cv2-mi" role="menuitem" href={i.href} target={i.external ? '_blank' : undefined} rel={i.external ? 'noreferrer' : undefined} onClick={() => setOpen(false)}>{i.label}</a>
          : <button key={i.key} type="button" role="menuitem" className={`cv2-mi${i.danger ? ' cv2-mi-d' : ''}`} onClick={() => { setOpen(false); i.run?.() }}>{i.label}</button>)}
    </div>
  )
  return (
    <span className={`cv2-menu-wrap${className ? ` ${className}` : ''}`}>
      <button ref={btn} type="button" className="cv2-more" aria-label={label} aria-haspopup="menu" aria-expanded={open} data-verb={verb}
        onClick={e => { e.stopPropagation(); toggle() }}><DIcon name="more" /></button>
      {typeof document !== 'undefined' ? createPortal(body, document.body) : null}
    </span>
  )
}

/** The answer line every sub-tab opens on: one sentence, the counts in it. */
export function Answer({ children, tail }: { children: ReactNode; tail?: ReactNode }) {
  return <p className="cv2-answer" role="status">{children}{tail && <span className="cv2-answer-tail">{tail}</span>}</p>
}

/** A shown-after-120ms, kept-for-380ms skeleton (no flash on a fast read). */
export function useDeferred(loading: boolean): boolean {
  const [show, setShow] = useState(false)
  const since = useRef(0)
  useEffect(() => {
    if (loading) {
      const t = setTimeout(() => { since.current = Date.now(); setShow(true) }, 120)
      return () => clearTimeout(t)
    }
    if (!show) return
    const left = Math.max(0, 380 - (Date.now() - since.current))
    const t = setTimeout(() => setShow(false), left)
    return () => clearTimeout(t)
  }, [loading, show])
  return show
}
