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
//
// 🔴 'promote' is CLIENT-FACING and 'retry' is deliberately absent. A promote
// puts a draft on a paying client's live board, so it is here (it scales, and
// its confirm names the client and the count); a retry spends a real model bill
// per row, so it is NOT a capability at all and the bulk bar has no way to
// reach it. That absence is the enforcement.
//
// 'discard' is thread-only, and only when the row carries a pending DM draft.
// It sends nothing, unlike every other cap here, which is why it is the one
// bulk action a conversation row is allowed at all, see BulkBar.tsx's "one at
// a time" refusal, which still applies to everything a conversation cannot
// undo. Approve is NOT here for a conversation and never will be: a bulk
// approve is a bulk send to real people.
export type RowCap = 'approve' | 'skip' | 'promote' | 'delete' | 'discard'

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
// Is a keyboard layer mounted and listening?
//
// 🔴 WHY THIS EXISTS. `RowSelect` is rendered from `InboxScreen.tsx`, and that
// file is shared: the workbench renders it, and so does the PRE-REVAMP shell at
// #exp/stock, which mounts no CommandLayer. The stock verification caught the
// consequence in pixels: every inbox row in the escape hatch grew a selection
// mark, the names shifted right and one wrapped to a second line, all for a
// control that shell has no keys to drive. A mark with no layer behind it is
// chrome that does nothing, in the one surface whose whole job is to be the
// unchanged fallback. So the layer announces itself and the mark asks.
let layerMounted = false

function emit(): void {
  for (const l of listeners) l()
}

export function subscribe(l: Listener): () => void {
  listeners.add(l)
  return () => { listeners.delete(l) }
}

// ---- reads -----------------------------------------------------------------

export function isLayerMounted(): boolean { return layerMounted }

export function setLayerMounted(v: boolean): void {
  if (layerMounted === v) return
  layerMounted = v
  emit()
}

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
