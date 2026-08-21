// The command layer's one piece of shared state: which row is focused, and
// which rows are selected.
//
// WHY A MODULE STORE AND NOT REACT STATE. The keyboard listener lives at the top
// of the tree and the selection mark lives on every row, ~300 levels of props
// apart, across three list surfaces owned by three different files (Content's
// Card, the lead-magnet ResourceRow, the inbox thread row). Threading a Set
// through all of them would have meant editing every list component and every
// component between. A store with per-row scalar subscriptions costs each row one
// `useSyncExternalStore` returning a number, so moving the focus re-renders the
// two rows that changed rather than the list.
//
// SCOPE IS PART OF THE STATE. A selection that survives a tab change, a lane
// change or a filter change is how the wrong rows get acted on: the operator
// picks twelve error rows, switches to Archived, and the bar still says twelve
// while pointing at rows he can no longer see. `setScope` is called with a
// signature read off the live DOM (job, lane, tab, search text); any change to it
// drops the whole selection.

export type RowKind = 'draft' | 'magnet' | 'thread'

// What a bulk action is allowed to do to this row. Written by the row itself,
// because the row is the only place that knows its status, its lane and whether
// it sits on a client board. The bulk bar never infers a capability.
export type RowCap = 'approve' | 'skip' | 'delete'

export type SelectedRow = {
  id: string
  kind: RowKind
  label: string
  caps: RowCap[]
  // Carried through so a delete can stamp taxonomy without a second fetch.
  taxonomy?: unknown
  lane?: string
}

type Listener = () => void

const listeners = new Set<Listener>()
let selected: SelectedRow[] = []
let focusId: string | null = null
let scope = ''

function emit(): void {
  for (const l of listeners) l()
}

export function subscribe(l: Listener): () => void {
  listeners.add(l)
  return () => { listeners.delete(l) }
}

// ---- reads -----------------------------------------------------------------

export function getSelected(): SelectedRow[] { return selected }
export function getFocusId(): string | null { return focusId }
export function getScope(): string { return scope }
export function isSelected(id: string): boolean { return selected.some(r => r.id === id) }

// One scalar per row: bit 1 selected, bit 2 focused. A row's subscription
// returns a number, so React re-renders only the rows whose number moved.
export function rowState(id: string): number {
  return (isSelected(id) ? 1 : 0) | (focusId === id ? 2 : 0)
}

// ---- writes ----------------------------------------------------------------

export function setFocus(id: string | null): void {
  if (focusId === id) return
  focusId = id
  emit()
}

export function toggleRow(row: SelectedRow): void {
  selected = isSelected(row.id) ? selected.filter(r => r.id !== row.id) : [...selected, row]
  emit()
}

export function selectRows(rows: SelectedRow[]): void {
  const byId = new Map(selected.map(r => [r.id, r]))
  for (const r of rows) byId.set(r.id, r)
  selected = [...byId.values()]
  emit()
}

export function clearSelection(): void {
  if (selected.length === 0) return
  selected = []
  emit()
}

// The tab / lane / filter guard. Called with a signature read off the DOM; any
// change to it drops the selection and the focus, because both of them point at
// rows that are no longer on screen.
export function setScope(next: string): void {
  if (next === scope) return
  scope = next
  const had = selected.length > 0 || focusId !== null
  selected = []
  focusId = null
  if (had) emit()
}

// ---- the row registry ------------------------------------------------------
//
// Every row that mounts a selection mark registers what it is. The DOM decides
// the ORDER (j/k walks the list in the order it is drawn, filters, search and
// collapse included, exactly as the operator sees it); this map only answers
// "what is the row with this id". Keeping the two apart is what stops the
// keyboard from walking a list that disagrees with the screen.
const registry = new Map<string, SelectedRow>()

export function registerRow(row: SelectedRow): () => void {
  registry.set(row.id, row)
  return () => { registry.delete(row.id) }
}

export function lookupRow(id: string): SelectedRow | null {
  return registry.get(id) ?? null
}

// Test seam. Nothing in the app calls this.
export function resetStore(): void {
  selected = []
  focusId = null
  scope = ''
  registry.clear()
  emit()
}
