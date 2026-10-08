import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { SearchField } from '../Search'
import { DIcon } from '../../ui/icons'

/** One search field and the existing setter. At T3/T4 its trigger opens a 240px popover. */
export const SearchV4 = forwardRef<HTMLInputElement, { q: string; setQ: (s: string) => void; reach: number | null }>(function SearchV4(props, ref) {
  const root = useRef<HTMLDivElement>(null), input = useRef<HTMLInputElement>(null), trigger = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  useImperativeHandle(ref, () => input.current!, [])
  useEffect(() => {
    const keys = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey || (e.target as Element)?.closest('input,textarea,[contenteditable=true]')) return
      if (!['t3','t4'].includes(root.current?.closest<HTMLElement>('.d-main')?.dataset.tier ?? '')) return
      e.preventDefault(); setOpen(true); requestAnimationFrame(() => input.current?.focus())
    }
    const outside = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('keydown', keys); document.addEventListener('pointerdown', outside)
    return () => { document.removeEventListener('keydown', keys); document.removeEventListener('pointerdown', outside) }
  }, [])
  return <div ref={root} className={`dx-search-v4${open ? ' dx-search-open' : ''}`} onKeyDown={e => { if (e.key === 'Escape') { setOpen(false); trigger.current?.focus() } }}>
    <button ref={trigger} type="button" className="dx-search-trigger" aria-label="Search people and messages" aria-expanded={open} aria-haspopup="dialog"
      onClick={() => { setOpen(v => !v); requestAnimationFrame(() => input.current?.focus()) }}><DIcon name="search" /></button>
    <div className="dx-search-pop"><SearchField ref={input} {...props} /></div>
  </div>
})
