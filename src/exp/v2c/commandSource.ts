import { JOBS, JOB_LABEL, type Job } from './layout'
import type { RowCap, SelectedRow } from './commandStore'

// THE ONE COMMAND SOURCE. The palette and the shortcut sheet are two renderings
// of this list, so they cannot disagree about what exists or about which key
// runs it. The sheet is `buildCommands(...).filter(c => c.key)`, grouped; the
// palette is the same array, matched against what has been typed.
//
// 🔴 THE VOCABULARY NEVER SHRINKS. Read the comment above `matchCommands` in
// ChatPane.tsx before touching this: an earlier build of that palette filtered
// unavailable commands OUT, and the measurement caught what it cost. With no
// turns on the pane, typing `/retry` matched nothing, the palette closed, and
// Enter sent the literal string "/retry" to the model. A palette that hides its
// own vocabulary teaches nothing and re-opens the hole it was built to close.
// So here too: an unavailable command is LISTED, dimmed, and says why. `ready`
// is false and `reason` is the sentence the row prints. It is never dropped.
//
// The same rule is why a query that matches nothing does not close this palette
// (CommandPalette.tsx renders a line saying so and keeps the list reachable by
// clearing the query). There is no fall-through here for a stray Enter to hit.

export type WbGroup = 'Move' | 'Select' | 'Act' | 'Go' | 'Open'

export const GROUP_ORDER: WbGroup[] = ['Move', 'Select', 'Act', 'Go', 'Open']

export type WbCommand = {
  id: string
  title: string
  group: WbGroup
  /**
   * The key that runs this command with no palette, printed on the row. `null`
   * means there is no direct key and the row prints that in words rather than
   * leaving the column blank: a palette that silently omits the shortcut on
   * some rows teaches the operator to stop looking at the column.
   */
  key: string | null
  hint: string
  ready: boolean
  /** Printed on the row when `ready` is false. Never a reason to hide the row. */
  reason?: string
  run: () => void
}

// Everything the layer can do, handed in by CommandLayer. Nothing in this file
// touches the DOM or the database; it is a list of names, keys and callbacks.
export type CommandCtx = {
  job: Job
  /** The rows on screen right now, in the order they are drawn. */
  rows: { id: string; label: string; el: HTMLElement }[]
  focusId: string | null
  selected: SelectedRow[]
  /** Which caps every selected row shares, and how many rows hold each cap. */
  capCount: Record<RowCap, number>
  hasSearch: boolean
  go: (job: Job) => void
  move: (delta: number) => void
  openFocused: () => void
  toggleFocused: () => void
  selectAll: () => void
  clearSelection: () => void
  focusSearch: () => void
  openSheet: () => void
  openPalette: () => void
  closeTop: () => void
  runBulk: (cap: RowCap) => void
  openRow: (el: HTMLElement) => void
}

const CAP_VERB: Record<RowCap, string> = {
  approve: 'Approve',
  skip: 'Skip',
  delete: 'Delete',
}

const CAP_PAST: Record<RowCap, string> = {
  approve: 'approved',
  skip: 'skipped',
  delete: 'deleted',
}

const CAP_HINT: Record<RowCap, string> = {
  approve: 'Marks every selected draft approved. Nothing publishes.',
  skip: 'Marks every selected draft disqualified. They drop out of the queue.',
  delete: 'Removes every selected draft. There is no undo for this one.',
}

// The noun a count is stated in. A bar that says "12 selected" makes the
// operator guess what twelve of; naming the object is the whole point.
export function selectionNoun(rows: SelectedRow[]): string {
  const kinds = new Set(rows.map(r => r.kind))
  if (kinds.size !== 1) return rows.length === 1 ? 'row' : 'rows'
  const kind = [...kinds][0]
  const one = kind === 'draft' ? 'draft' : kind === 'magnet' ? 'lead magnet' : 'conversation'
  return rows.length === 1 ? one : `${one}s`
}

export function buildCommands(c: CommandCtx): WbCommand[] {
  const n = c.selected.length
  const noun = selectionNoun(c.selected)
  const hasRows = c.rows.length > 0
  const focused = c.focusId !== null && c.rows.some(r => r.id === c.focusId)

  const out: WbCommand[] = [
    {
      id: 'move.next',
      title: 'Next row',
      group: 'Move',
      key: 'j',
      hint: 'Moves the keyboard focus down one row in this list.',
      ready: hasRows,
      reason: hasRows ? undefined : 'this list has no rows on screen',
      run: () => c.move(1),
    },
    {
      id: 'move.prev',
      title: 'Previous row',
      group: 'Move',
      key: 'k',
      hint: 'Moves the keyboard focus up one row in this list.',
      ready: hasRows,
      reason: hasRows ? undefined : 'this list has no rows on screen',
      run: () => c.move(-1),
    },
    {
      id: 'move.open',
      title: 'Open the focused row',
      group: 'Move',
      key: 'Enter',
      hint: 'Opens the row the keyboard is on, the same as clicking it.',
      ready: focused,
      reason: focused ? undefined : 'no row is focused yet, press j to start',
      run: () => c.openFocused(),
    },
    {
      id: 'move.search',
      title: 'Search this list',
      group: 'Move',
      key: '/',
      hint: 'Puts the cursor in this list’s search field.',
      ready: c.hasSearch,
      reason: c.hasSearch ? undefined : 'this surface has no search field',
      run: () => c.focusSearch(),
    },
    {
      id: 'move.sheet',
      title: 'Keyboard shortcuts',
      group: 'Move',
      key: '?',
      hint: 'Lists every key, from this same list of commands.',
      ready: true,
      run: () => c.openSheet(),
    },
    {
      id: 'move.palette',
      title: 'Command palette',
      group: 'Move',
      key: '⌘K',
      hint: 'Opens this palette. Ctrl+K does the same on a keyboard with no ⌘.',
      ready: true,
      run: () => c.openPalette(),
    },
    {
      id: 'move.close',
      title: 'Close what is open',
      group: 'Move',
      key: 'Esc',
      hint: 'Closes the palette, then the shortcut sheet, then clears the selection.',
      ready: true,
      run: () => c.closeTop(),
    },
    {
      id: 'select.toggle',
      title: 'Select the focused row',
      group: 'Select',
      key: 'x',
      hint: 'Adds the focused row to the selection, or takes it back out.',
      ready: focused,
      reason: focused ? undefined : 'no row is focused yet, press j to start',
      run: () => c.toggleFocused(),
    },
    {
      id: 'select.all',
      title: 'Select every row in this tab',
      group: 'Select',
      key: null,
      hint: `Selects all ${c.rows.length} rows currently on screen.`,
      ready: hasRows,
      reason: hasRows ? undefined : 'this list has no rows on screen',
      run: () => c.selectAll(),
    },
    {
      id: 'select.clear',
      title: 'Clear the selection',
      group: 'Select',
      key: 'Esc',
      hint: 'Drops all selected rows. Nothing is written.',
      ready: n > 0,
      reason: n > 0 ? undefined : 'nothing is selected',
      run: () => c.clearSelection(),
    },
  ]

  // The bulk actions. Listed at every moment, including with an empty selection,
  // so the palette tells the operator what this surface can do before he has
  // picked anything. Each one states its own refusal.
  for (const cap of ['approve', 'skip', 'delete'] as RowCap[]) {
    const have = c.capCount[cap]
    const ready = n > 0 && have === n
    out.push({
      id: `act.${cap}`,
      title: `${CAP_VERB[cap]} the selected ${noun}`,
      group: 'Act',
      key: null,
      hint: CAP_HINT[cap],
      ready,
      reason: n === 0
        ? 'nothing is selected'
        : have === 0
          ? `none of these ${n} rows can be ${CAP_PAST[cap]}`
          : `only ${have} of the ${n} selected rows can take it, and a bulk action runs on every selected row or none`,
      run: () => c.runBulk(cap),
    })
  }

  // Every lane, always. The one you are on is listed and dimmed rather than
  // dropped, so the list of places is the same length every time it opens.
  for (const j of JOBS) {
    out.push({
      id: `go.${j}`,
      title: `Go to ${JOB_LABEL[j]}`,
      group: 'Go',
      key: null,
      hint: `Switches the working surface to ${JOB_LABEL[j]}.`,
      ready: j !== c.job,
      reason: j === c.job ? 'you are on it' : undefined,
      run: () => c.go(j),
    })
  }

  // The rows on screen, by name. This is what makes the palette a way to reach
  // a person rather than only a lane. Capped at 200: past that the palette is
  // a scroll rather than a jump, and the query narrows it long before then.
  for (const r of c.rows.slice(0, 200)) {
    out.push({
      id: `open.${r.id}`,
      title: `Open ${r.label}`,
      group: 'Open',
      key: r.id === c.focusId ? 'Enter' : null,
      hint: 'Opens this row.',
      ready: true,
      run: () => c.openRow(r.el),
    })
  }

  return out
}

/**
 * Token-wise matching, taken from ChatPane's `matchCommands` for the reason
 * documented there: whole-string matching returned ZERO commands for "model
 * haiku" against `/model claude-haiku-4-5`, which closed that palette and let
 * Enter fall through. Every token has to appear somewhere in the title, in any
 * order.
 *
 * An empty query returns the whole vocabulary. A query that matches nothing
 * returns an empty array, and the palette RENDERS that as a sentence rather
 * than closing: closing on no-match is the exact behaviour the ChatPane comment
 * was written about.
 */
export function matchWbCommands(text: string, cmds: WbCommand[]): WbCommand[] {
  const q = text.toLowerCase().trim()
  if (q === '') return cmds
  const tokens = q.split(/\s+/)
  return cmds.filter(c => {
    const hay = `${c.title} ${c.group}`.toLowerCase()
    return tokens.every(t => hay.includes(t))
  })
}

/**
 * The shortcut sheet's rows: the same commands, keeping only the ones a key
 * runs, de-duplicated by key plus title. One list, two renderings, and there is no
 * second table of keys anywhere in this app to drift from this one.
 */
export function keyRows(cmds: WbCommand[]): WbCommand[] {
  const seen = new Set<string>()
  const out: WbCommand[] = []
  for (const c of cmds) {
    if (!c.key) continue
    const k = `${c.key}|${c.title}`
    if (seen.has(k)) continue
    seen.add(k)
    out.push(c)
  }
  return out
}
