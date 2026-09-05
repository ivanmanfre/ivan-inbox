/* ==========================================================================
   THE SELECTION MARK, and the row's registration with the keyboard layer.

   Copied from `src/exp/v2c/RowSelect.tsx`. The behaviour is untouched: it
   writes `data-wbrow`, `data-wbsel` and `data-wbfocus` onto the ROW it sits
   in, which is what j/k walks and what x selects, and it renders NOTHING when
   no command layer is mounted (the `#exp/stock` escape hatch).

   One line changed and it had to: the host is found with `closest`, and this
   direction's row is `.a-ct-row`, so that class joins the two the old mark
   looked for rather than replacing them.
   ========================================================================== */
import { useEffect, useRef, useSyncExternalStore } from 'react'
import {
  isLayerMounted, registerRow, rowState, subscribe, toggleRow,
  type RowCap, type RowKind, type SelectedRow,
} from '../../exp/v2c/commandStore'
import { Icon } from '../../ds'
import './content.css'

/** The row's live selection state, so the row itself can draw selected/focused
    through the kit rather than through an attribute the mark writes. */
export function useRowState(id: string): { selected: boolean; focused: boolean } {
  const state = useSyncExternalStore(subscribe, () => rowState(id))
  return { selected: (state & 1) !== 0, focused: (state & 2) !== 0 }
}

export function RowSelect({ id, kind, label, caps, taxonomy, lane }: {
  id: string
  kind: RowKind
  label: string
  /** What a bulk action may do to THIS row. The row is the only place that
      knows its status, its lane and whether it is on a client board, so the
      capability is written here and never inferred by the bar. */
  caps: RowCap[]
  taxonomy?: unknown
  lane?: string
}) {
  const ref = useRef<HTMLButtonElement>(null)
  const state = useSyncExternalStore(subscribe, () => rowState(id))
  // No keyboard layer, no mark.
  const layer = useSyncExternalStore(subscribe, isLayerMounted)
  const on = (state & 1) !== 0
  const focused = (state & 2) !== 0

  const row: SelectedRow = { id, kind, label, caps, taxonomy, lane }
  const rowRef = useRef(row)
  rowRef.current = row

  // The registry answers "what is this row"; the DOM answers "what order are
  // the rows in". Registration is keyed by id and cleaned up on unmount, so a
  // filter change cannot leave a phantom row behind for a bulk action to hit.
  const capKey = caps.join(',')
  useEffect(() => {
    if (!layer) return
    return registerRow(rowRef.current)
  }, [id, kind, label, capKey, lane, layer])

  useEffect(() => {
    if (!layer) return
    const host = ref.current?.closest('.a-ct-row, .ct-card, .r') ?? ref.current?.parentElement
    if (!host) return
    host.setAttribute('data-wbrow', id)
    host.setAttribute('data-wbsel', on ? '1' : '0')
    host.setAttribute('data-wbfocus', focused ? '1' : '0')
  }, [id, on, focused, layer])

  if (!layer) return null

  return (
    <button
      ref={ref}
      type="button"
      className="a-ct-selmark"
      role="checkbox"
      aria-checked={on}
      aria-label={on ? `Deselect ${label}` : `Select ${label}`}
      title={on ? 'Selected. Click or press x to deselect.' : 'Select this row (x)'}
      // A tap on the row opens it; the mark must not also fire that.
      onClick={e => { e.stopPropagation(); toggleRow(rowRef.current) }}
    >
      {on ? <Icon name="check" size={16} /> : null}
    </button>
  )
}
