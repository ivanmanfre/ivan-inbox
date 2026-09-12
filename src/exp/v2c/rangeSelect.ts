/* ==========================================================================
   src/exp/v2c/rangeSelect.ts — E3, Shift+click over a run of rows.

   ONE SELECTION MODEL. The store already holds the set and the anchor; this is
   the half that needs the DOM, and it is a module of its own so BOTH selection
   marks (`exp/v2c/RowSelect.tsx` for the inbox rows, `wb/content/select.tsx`
   for the content rows) call the same code. A second copy of "what is between
   these two rows" is how two lists start disagreeing about what a drag covered.

   THE ORDER IS THE DOM'S, exactly as j/k reads it (CommandLayer.visibleRows).
   The rendered order already carries every filter, every search and every
   collapsed group, so it is the only answer that matches what the operator can
   see. A windowed list is the reason `rangeIds` refuses an anchor it cannot
   find: DMs renders ~15 of ~1,354 rows, so an anchor scrolled far out of the
   window is simply not in this array, and a range measured from index 0 would
   select every row above the pointer.
   ========================================================================== */
import { getAnchorId, lookupRow, rangeIds, selectRows, type SelectedRow } from './commandStore'

/** The ids the keyboard layer would walk, in the order they are drawn. */
export function visibleRowIds(): string[] {
  if (typeof document === 'undefined') return []
  return [...document.querySelectorAll<HTMLElement>('.wb-work [data-wbrow]')]
    .filter(el => el.offsetParent !== null)
    .map(el => el.getAttribute('data-wbrow') ?? '')
    .filter(id => id !== '')
}

/**
 * Shift+click: select everything between the last row touched and this one.
 * Returns false when there is nothing to extend (no anchor, or the anchor is
 * not in the rendered window), so the caller can fall back to a plain toggle
 * rather than doing nothing under the hand.
 */
export function selectRange(toId: string): boolean {
  const anchor = getAnchorId()
  if (anchor === null || anchor === toId) return false
  const ids = rangeIds(visibleRowIds(), anchor, toId)
  if (ids.length < 2) return false
  const rows = ids.map(lookupRow).filter((r): r is SelectedRow => r !== null)
  if (rows.length === 0) return false
  // ADDITIVE, never a replacement: `selectRows` merges by id, so shift-clicking
  // a second run keeps the first. The store's own `toggleRow` stays the only
  // way a row leaves the selection.
  selectRows(rows)
  return true
}
