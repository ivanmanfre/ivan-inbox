// j / k walk the conversation rows on screen, Enter opens (the row's own handler), x selects,
// shift+x selects the range from the last x, / focuses search, ? opens the key sheet, Escape
// closes the thread. Never while typing in a field or a sheet is open.
import { useEffect, useRef, type RefObject } from 'react'
import type { Thread } from '../../lib/inbox'

export function useDmKeys({ searchRef, open, closeThread, toggleCheck, selectMany, openKeys }: {
  searchRef: RefObject<HTMLInputElement | null>
  open: Thread | null
  openThread: (t: Thread) => void
  closeThread: () => void
  toggleCheck: (id: string) => void
  selectMany: (ids: string[]) => void
  openKeys: () => void
}) {
  const anchor = useRef<string | null>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const el = e.target as HTMLElement | null
      if (el && (el.closest('input, textarea, select, [contenteditable="true"]'))) return
      if (document.querySelector('.d-sheet, .d-confirm, .d-palette')) return
      if (e.key === '/') { e.preventDefault(); searchRef.current?.focus(); return }
      if (e.key === '?') { e.preventDefault(); openKeys(); return }
      if (e.key === 'Escape' && open) { closeThread(); return }
      const rows = [...document.querySelectorAll<HTMLElement>('.dm-page [data-d-row]')]
      if (!rows.length) return
      const at = rows.findIndex(r => r === document.activeElement)
      const cur = at >= 0 ? at : rows.findIndex(r => r.getAttribute('aria-current') === 'true')
      if (e.key === 'j' || e.key === 'k') {
        e.preventDefault()
        const next = rows[Math.max(0, Math.min(rows.length - 1, cur + (e.key === 'j' ? 1 : -1)))] ?? rows[0]
        next.focus(); next.scrollIntoView({ block: 'nearest' })
      } else if ((e.key === 'x' || e.key === 'X') && cur >= 0) {
        e.preventDefault()
        const id = rows[cur].getAttribute('data-d-row')
        if (!id) return
        const from = e.shiftKey && anchor.current ? rows.findIndex(r => r.getAttribute('data-d-row') === anchor.current) : -1
        if (from >= 0) {
          const [a, b] = from < cur ? [from, cur] : [cur, from]
          selectMany(rows.slice(a, b + 1).map(r => r.getAttribute('data-d-row')!).filter(Boolean))
        } else toggleCheck(id)
        anchor.current = id
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [searchRef, open, closeThread, toggleCheck, selectMany, openKeys])
}

/** Every DM row on screen, in order (select all). */
export function rowsOnScreen(): string[] {
  return [...new Set([...document.querySelectorAll<HTMLElement>('.dm-page [data-d-row]')].map(r => r.getAttribute('data-d-row')!).filter(Boolean))]
}
