import { getFocusId, lookupRow, selectRows, setFocus, toggleRow, type SelectedRow } from '../../exp/v2c/commandStore'

// ---------------------------------------------------------------------------
// TODAY'S ROW WALK, over D's page area. The command layer (exp/v2c/CommandLayer)
// reads the DOM for the ORDER and the row registry (commandStore) for the
// METADATA; every mounted old view (Content lists, Errors, Magnets, Styles)
// still draws `data-wbrow` rows with RowSelect marks, so the same walk works
// here once it looks inside D's page body instead of the old `.wb-work`.
//
// D's own pages (DMs, Ops, Content's draft window) own their keys and never
// draw `data-wbrow`, so this walk finds nothing on them and does nothing.
// ---------------------------------------------------------------------------

export const PAGE_ROOT = '.d-body, .d-pbody'

/** An overlay owns the keyboard (a D sheet or confirm, today's takeover or sheet, the palette). */
export const OVERLAY = '.d-sheet, .d-confirm, .d-palette, .a-cmdk, .ds-dialog, .wb-tkscrim, .sheet-scrim, .wb-fsheet-scrim, .dcl-menu, .dcl-peek'

export function inField(el: Element | null): boolean {
  if (!el) return false
  const t = el as HTMLElement
  return t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable === true
    || t.closest?.('[contenteditable="true"]') != null
}

/** A focused control (a button, a link) takes Enter for itself. */
export function onControl(el: Element | null): boolean {
  return !!el && el !== document.body && /^(BUTTON|A|SUMMARY)$/.test((el as HTMLElement).tagName)
}

export function overlayOpen(): boolean {
  return document.querySelector(OVERLAY) !== null
}

function onScreen(el: HTMLElement): boolean {
  return el.offsetParent !== null && el.closest('[inert]') === null
}

export function visibleRows(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(PAGE_ROOT.split(',').map(r => `${r.trim()} [data-wbrow]`).join(', '))]
    .filter(onScreen)
}

export function rowLabel(el: HTMLElement): string {
  const known = lookupRow(el.getAttribute('data-wbrow') ?? '')
  if (known) return known.label
  return (el.textContent ?? '').trim().slice(0, 60) || 'this row'
}

export function searchField(): HTMLInputElement | null {
  const sel = ['input[type=search]', 'input.ct-fsearch-in', 'input.search-in']
    .flatMap(i => PAGE_ROOT.split(',').map(r => `${r.trim()} ${i}`)).join(', ')
  return [...document.querySelectorAll<HTMLInputElement>(sel)].find(onScreen) ?? null
}

export function focusSearch(): boolean {
  const f = searchField()
  if (!f) return false
  f.focus(); f.select()
  return true
}

/** j / k. No row focused yet: j starts at the top, k at the bottom. Returns false with no rows. */
export function move(delta: number): boolean {
  const list = visibleRows()
  if (list.length === 0) return false
  const cur = getFocusId()
  const at = cur === null ? -1 : list.findIndex(el => el.getAttribute('data-wbrow') === cur)
  const next = at < 0 ? (delta > 0 ? 0 : list.length - 1) : Math.min(list.length - 1, Math.max(0, at + delta))
  const el = list[next]
  if (!el) return false
  setFocus(el.getAttribute('data-wbrow'))
  el.scrollIntoView?.({ block: 'nearest' })
  return true
}

export function focusedEl(): HTMLElement | null {
  const cur = getFocusId()
  if (cur === null) return null
  return visibleRows().find(el => el.getAttribute('data-wbrow') === cur) ?? null
}

export function openFocused(): boolean {
  const el = focusedEl()
  if (!el) return false
  el.click()
  return true
}

export function toggleFocused(): boolean {
  const cur = getFocusId()
  if (cur === null) return false
  const row = lookupRow(cur)
  if (!row) return false
  toggleRow(row)
  return true
}

export function selectAllVisible(): void {
  selectRows(visibleRows()
    .map(el => lookupRow(el.getAttribute('data-wbrow') ?? ''))
    .filter((r): r is SelectedRow => r !== null))
}

/** The selection's signature: the place, the list's lane and tab, the search text. Any change drops it (commandStore.setScope). */
export function readScope(): string {
  const place = location.hash.split('?')[0]
  const shown = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)].find(onScreen)?.textContent ?? ''
  return `${place}|${shown('.ct-cmd-lane.on')}|${shown('.ct-tab.on')}|${searchField()?.value ?? ''}`
}
