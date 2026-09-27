import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import { ShortcutSheet } from '../../exp/v2c/CommandPalette'
import { buildCommands, type WbCommand } from '../../exp/v2c/commandSource'
import { capCountOf, useBulkRun } from '../../exp/v2c/BulkBar'
import {
  clearSelection, getFocusId, getSelected, setFocus, setLayerMounted, setScope, subscribe, type RowCap,
} from '../../exp/v2c/commandStore'
import { ConfirmCtx, type ConfirmOpts } from '../../lib/confirm'
import { ContentBulkBar } from '../../wb/content/bulk'
import { useDConfirm } from '../ui/confirm'
import { usePageCommands } from './commands'
import {
  focusSearch, focusedEl, inField, move, onControl, openFocused, overlayOpen, readScope, rowLabel,
  searchField, selectAllVisible, toggleFocused, visibleRows,
} from './layerDom'

// ---------------------------------------------------------------------------
// TODAY'S COMMAND LAYER, mounted in D's frame (parity: frame-today rows 3 + 5).
//
//   j / k        walk the rows of a mounted old view (Content lists, Errors, Magnets, Styles)
//   x            select the focused row (RowSelect draws its mark again: setLayerMounted)
//   Enter        open the focused row
//   /            the search field of the page on screen
//   ?            the shortcut sheet (every key the frame and the page register)
//   Escape       the sheet, then the selection, then the row focus
//
// and today's ONE bulk bar (wb/content/bulk ContentBulkBar + useBulkRun: the same
// writes, refusals and receipts), its confirm answered by D's confirm.
//
// A D page that binds a key itself (DMs j/k/x/?//, Ops j/k, the draft window)
// calls preventDefault; this layer decides AFTER every listener has run and
// stands down on a handled key, so one keypress never moves two lists.
// No bare key writes anything (today's rule): bulk verbs run from the bar or ⌘K.
// ---------------------------------------------------------------------------

const KEYS_EVENT = 'd-keys-open'

/** Open the shortcut sheet from anywhere (the palette's "Keyboard shortcuts" row). */
export function openKeySheet() { window.dispatchEvent(new Event(KEYS_EVENT)) }

/** Today's bulk confirms (lib/confirm context) asked through D's confirm: danger = red key, Cancel focused. */
function DConfirmBridge({ children }: { children: ReactNode }) {
  const confirm = useDConfirm()
  const ask = useCallback((o: ConfirmOpts) => confirm({
    title: o.title, message: o.message, confirmText: o.confirmText ?? 'Confirm', cancelText: o.cancelText,
    danger: o.danger, verb: o.danger ? 'confirm-danger' : 'confirm',
  }), [confirm])
  return <ConfirmCtx.Provider value={ask}>{children}</ConfirmCtx.Provider>
}

/**
 * The frame's command rows for ⌘K and the sheet: today's Move / Select / Act / Open
 * bands (buildCommands) over the old rows on screen, plus the page's own commands.
 * Today's Go band is not taken: D's palette lists D's places.
 */
export function layerCommands({ page, openSheet, closeTop, runBulk }: {
  page: WbCommand[]; openSheet: () => void; closeTop: () => void; runBulk: (cap: RowCap) => void
}): WbCommand[] {
  const rows = visibleRows().map(el => ({ id: el.getAttribute('data-wbrow') ?? '', label: rowLabel(el), el }))
  const selected = getSelected()
  const all = buildCommands({
    job: 'content', rows, focusId: getFocusId(), selected, capCount: capCountOf(selected),
    hasSearch: searchField() !== null,
    go: () => {}, move: d => { move(d) }, openFocused: () => { openFocused() }, toggleFocused: () => { toggleFocused() },
    selectAll: selectAllVisible, clearSelection, focusSearch: () => { focusSearch() }, openSheet,
    openPalette: () => {}, closeTop, runBulk, openRow: el => el.click(),
  })
  const listy = rows.length > 0 || selected.length > 0
  const mine = all.filter(c => {
    if (c.id.startsWith('go.') || c.id === 'move.palette') return false
    if (c.id === 'move.sheet') return true
    return listy
  })
  // A page's own command wins over a frame row with the same id.
  const ids = new Set(page.map(c => c.id))
  return [...page, ...mine.filter(c => !ids.has(c.id))]
}

/** Today's bulk run (useBulkRun), for the palette's Act rows. Must sit under DLayer. */
export function useLayerBulk(): (cap: RowCap) => void {
  const bulk = useBulkRun()
  return useCallback((cap: RowCap) => { void bulk.run(cap, getSelected()) }, [bulk])
}

function closeTopLayer(sheet: boolean, setSheet: (o: boolean) => void): boolean {
  if (sheet) { setSheet(false); return true }
  if (getSelected().length > 0) { clearSelection(); return true }
  if (getFocusId() !== null) { setFocus(null); return true }
  return false
}

function LayerKeys() {
  const [sheet, setSheet] = useState(false)
  const page = usePageCommands()
  const selected = useSyncExternalStore(subscribe, getSelected, getSelected)

  // Rows draw their selection marks only while a layer listens (commandStore).
  useEffect(() => { setLayerMounted(true); return () => setLayerMounted(false) }, [])

  // While one row is picked, every mark shows (today's E3 rule, rowselect.css).
  const n = selected.length
  useEffect(() => {
    const root = document.documentElement
    if (n > 0) root.setAttribute('data-wbselecting', '')
    else root.removeAttribute('data-wbselecting')
    return () => root.removeAttribute('data-wbselecting')
  }, [n])

  // A changed place, lane, tab or search drops the selection (the rows under it are different rows).
  useEffect(() => {
    const check = () => setScope(readScope())
    check()
    const t = window.setInterval(check, 400)
    return () => window.clearInterval(t)
  }, [])

  useEffect(() => {
    const on = () => setSheet(true)
    window.addEventListener(KEYS_EVENT, on)
    return () => window.removeEventListener(KEYS_EVENT, on)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (!['j', 'k', 'x', 'Enter', '/', '?', 'Escape'].includes(e.key)) return
      if (inField(document.activeElement)) return
      // Enter on the body would do nothing by default; with a focused old row it is ours,
      // decided now (before any later listener) and remembered so our own mark is not
      // mistaken for a page's.
      const mine = e.key === 'Enter' && !e.defaultPrevented && focusedEl() !== null && !onControl(document.activeElement)
      if (mine) e.preventDefault()
      // Decide after every other listener: a page that handled the key said so.
      window.setTimeout(() => {
        if (e.defaultPrevented && !mine) return
        if (e.key === 'Escape') { closeTopLayer(sheet, setSheet); return }
        if (sheet || overlayOpen()) return
        switch (e.key) {
          case 'j': move(1); break
          case 'k': move(-1); break
          case 'x': toggleFocused(); break
          case '/': focusSearch(); break
          case '?': setSheet(true); break
          case 'Enter': if (!onControl(document.activeElement)) openFocused(); break
        }
      }, 0)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sheet])

  const runBulk = useLayerBulk()
  const cmds = useMemo(() => (sheet
    ? layerCommands({ page, openSheet: () => setSheet(true), closeTop: () => { closeTopLayer(true, setSheet) }, runBulk })
    : []), [sheet, page, runBulk])

  return sheet ? <div className="app wb ds-shell d-oldhost"><ShortcutSheet cmds={cmds} onClose={() => setSheet(false)} /></div> : null
}

/**
 * Mounted once by the Shell, inside D's confirm and toast providers, round the
 * palette (so its Act rows reach today's bulk run and D's confirm).
 */
export function DLayer({ children }: { children?: ReactNode }) {
  return (
    <DConfirmBridge>
      <LayerKeys />
      <div className="app wb ds-shell d-oldhost d-bulkhost"><ContentBulkBar /></div>
      {children}
    </DConfirmBridge>
  )
}
