// j / k walk the conversation rows on screen, Enter opens (the row's own handler), x selects,
// / focuses search, Escape closes the thread. Never while typing in a field or a sheet is open.
import { useEffect, type RefObject } from 'react'
import type { Thread } from '../../lib/inbox'

export function useDmKeys({ searchRef, open, closeThread, toggleCheck }: {
  searchRef: RefObject<HTMLInputElement | null>
  open: Thread | null
  openThread: (t: Thread) => void
  closeThread: () => void
  toggleCheck: (id: string) => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const el = e.target as HTMLElement | null
      if (el && (el.closest('input, textarea, select, [contenteditable="true"]'))) return
      if (document.querySelector('.d-sheet, .d-confirm, .d-palette')) return
      if (e.key === '/') { e.preventDefault(); searchRef.current?.focus(); return }
      if (e.key === 'Escape' && open) { closeThread(); return }
      const rows = [...document.querySelectorAll<HTMLElement>('.dm-page [data-d-row]')]
      if (!rows.length) return
      const at = rows.findIndex(r => r === document.activeElement)
      const cur = at >= 0 ? at : rows.findIndex(r => r.getAttribute('aria-current') === 'true')
      if (e.key === 'j' || e.key === 'k') {
        e.preventDefault()
        const next = rows[Math.max(0, Math.min(rows.length - 1, cur + (e.key === 'j' ? 1 : -1)))] ?? rows[0]
        next.focus(); next.scrollIntoView({ block: 'nearest' })
      } else if (e.key === 'x' && cur >= 0) {
        e.preventDefault()
        const id = rows[cur].getAttribute('data-d-row')
        if (id) toggleCheck(id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [searchRef, open, closeThread, toggleCheck])
}
