import { useEffect, useRef, useSyncExternalStore } from 'react'
import {
  registerRow, rowState, subscribe, toggleRow,
  type RowCap, type RowKind, type SelectedRow,
} from './commandStore'

// THE SELECTION MARK, and the row's registration with the keyboard layer.
//
// Phase 0 measured this and the plan was wrong about it: a DOM probe for
// `input[type=checkbox]`, `[role=checkbox]` and `[class*=check]` returns ZERO
// elements on every list at every viewport. There was no checkbox to wire, so
// this is the control being introduced.
//
// ONE LINE PER HOST. The mark writes `data-wbrow`, `data-wbsel` and
// `data-wbfocus` onto its own parent element, so a list gets keyboard navigation
// and selection by rendering `<RowSelect …/>` inside its row and changing
// nothing else. Three list surfaces are owned by three files; a props-threaded
// selection would have meant editing every component between the shell and the
// row.
//
// IT IS NOT ALWAYS PAINTED. A checkbox on all 300 rows is 300 controls competing
// with the work; the mark is drawn on hover, on the keyboard-focused row, and on
// any row that is selected (section C of wb2026.css). A keyboard-only operator
// therefore always sees the row he is on and every row he has picked, and a
// mouse operator sees a mark wherever the pointer is.

export function RowSelect({ id, kind, label, caps, taxonomy, lane }: {
  id: string
  kind: RowKind
  label: string
  // What a bulk action may do to THIS row. The row is the only place that knows
  // its status, its lane and whether it is on a client board, so the capability
  // is written here and never inferred by the bar.
  caps: RowCap[]
  taxonomy?: unknown
  lane?: string
}) {
  const ref = useRef<HTMLButtonElement>(null)
  const state = useSyncExternalStore(subscribe, () => rowState(id))
  const on = (state & 1) !== 0
  const focused = (state & 2) !== 0

  const row: SelectedRow = { id, kind, label, caps, taxonomy, lane }
  const rowRef = useRef(row)
  rowRef.current = row

  // The registry answers "what is this row"; the DOM answers "what order are
  // the rows in". Registration is keyed by id and cleaned up on unmount, so a
  // filter change cannot leave a phantom row behind for a bulk action to hit.
  const capKey = caps.join(',')
  useEffect(() => registerRow(rowRef.current), [id, kind, label, capKey, lane])

  // The parent carries the attributes: `data-wbrow` is what the keyboard layer
  // walks, and the other two are what section C paints.
  useEffect(() => {
    const parent = ref.current?.parentElement
    if (!parent) return
    parent.setAttribute('data-wbrow', id)
    parent.setAttribute('data-wbsel', on ? '1' : '0')
    parent.setAttribute('data-wbfocus', focused ? '1' : '0')
  }, [id, on, focused])

  return (
    <button
      ref={ref}
      type="button"
      className="wb-selmark"
      role="checkbox"
      aria-checked={on}
      aria-label={on ? `Deselect ${label}` : `Select ${label}`}
      title={on ? 'Selected. Click or press x to deselect.' : 'Select this row (x)'}
      // A tap on the row opens it; the mark must not also fire that.
      onClick={e => { e.stopPropagation(); toggleRow(rowRef.current) }}
    >
      <span className="wb-selmark-b" aria-hidden>{on ? '✓' : ''}</span>
    </button>
  )
}
