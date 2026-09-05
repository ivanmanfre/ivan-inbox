import { useEffect, useRef, useSyncExternalStore } from 'react'
import {
  isLayerMounted, registerRow, rowState, subscribe, toggleRow,
  type RowCap, type RowKind, type SelectedRow,
} from '../../../exp/v2c/commandStore'
import { Icon, cx } from '../../../ds'

// THE SELECTION MARK, and the row's registration with the keyboard layer.
//
// Copied from `src/exp/v2c/RowSelect.tsx` for exactly one reason: the shipped
// mark finds the row it belongs to with `closest('.ct-card, .r')`, and a
// Direction B row is a `.dirb-card`. Without that selector the mark writes
// `data-wbrow` nowhere, and j/k plus x go dead on this screen. The store calls,
// the registration keys, the aria and the titles are byte-for-byte the ones
// that shipped; only the host selector and the glyph changed (the census reads
// unicode glyphs, so the tick is `<Icon name="check" />`).
//
// IT IS NOT ALWAYS PAINTED. A checkbox on all 300 rows is 300 controls competing
// with the work; the mark is drawn on hover, on the keyboard-focused row, and on
// any row that is selected. A keyboard-only operator therefore always sees the
// row he is on and every row he has picked, and a mouse operator sees a mark
// wherever the pointer is.
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
  // No keyboard layer, no mark. #exp/stock renders this same row and mounts no
  // CommandLayer, and the escape hatch has to stay exactly as it was.
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

  // The ROW carries the attributes: `data-wbrow` is what the keyboard layer
  // walks, and the other two are what the selection paint reads.
  useEffect(() => {
    if (!layer) return
    const host = ref.current?.closest('.dirb-card, .ct-card, .r') ?? ref.current?.parentElement
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
      className={cx('dirb-selmark')}
      data-on={on}
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
