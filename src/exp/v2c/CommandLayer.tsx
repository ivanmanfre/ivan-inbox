import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { parseWbHash, wbHash } from './route'
import type { Job } from './layout'
import { buildCommands } from './commandSource'
import { CommandPalette, ShortcutSheet, type FindState } from './CommandPalette'
import { CROSS_MIN, crossSearch, type CrossHit, type CrossResults } from '../../lib/crossSearch'
import type { ContentLane } from '../../lib/content'
import { BulkBar, capCountOf, useBulkRun } from './BulkBar'
import {
  clearSelection, getFocusId, getSelected, lookupRow, selectRows, setFocus, setLayerMounted,
  setScope, subscribe, toggleRow, type RowCap, type SelectedRow,
} from './commandStore'

// THE COMMAND LAYER. One keydown listener, one palette, one shortcut sheet, one
// bulk bar. Mounted once from Shell with no props: everything it needs it reads
// off the live DOM and the hash, which is what keeps the shell edit to an import
// and a mount line.
//
// ---------------------------------------------------------------------------
// EVERY KEY THIS BINDS, and nothing else:
//
//   ⌘K / Ctrl+K   open the palette
//   j             focus the next row
//   k             focus the previous row
//   Enter         open the focused row
//   x             select or deselect the focused row
//   /             put the cursor in this list's search field
//   ?             open the shortcut sheet
//   Escape        close the palette, then the sheet, then the selection
//
// 🔴 NO BARE-KEY ACTION SHORTCUT EXISTS. `a` / `r` / `e` / `s` were removed from
// the draft window on 2026-08-09 as unneeded, and a reference implementation
// that bound bare ⌘A to approve and ⌘R to reject is explicitly not copied.
// Approve, skip, delete and send stay on their buttons and in the palette,
// behind the confirm sheets they already carry. ⌘Enter is not bound either.
//
// 🔴 APPROVE-UNDO IS NOT BUILT, in any variant. The dispatcher claims rows on
// `sent_at IS NULL` without re-checking `approved_at`, so a client-side undo
// fails open: the screen would say undone while the DM goes out. Discard-restore
// (RestoreStrip) is the sanctioned reversibility feature and it is a database
// guard, not a timer.
// ---------------------------------------------------------------------------
//
// WHY IT READS THE DOM RATHER THAN OWNING A LIST. j/k has to walk the rows the
// operator can actually see: filtered, searched, tab-selected, collapsed. The
// render order IS that answer, and any copy of it kept in React would be a
// second source of truth that drifts the moment a filter changes. So the DOM
// gives the ORDER and the row registry gives the METADATA.

const OVERLAY = '.wb-tkscrim, .sheet-scrim, .wb-fsheet-scrim'

function inField(el: Element | null): boolean {
  if (!el) return false
  const t = el as HTMLElement
  return t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT'
    || t.isContentEditable === true
}

// A takeover window or a confirm sheet is open. The layer goes inert: the draft
// window owns j/k inside itself (DraftPane.tsx:958) and the magnet window owns
// its own (MagnetWindow.tsx:325). Two listeners walking two different queues off
// one keypress is the double-bind this check exists to prevent.
function overlayOpen(): boolean {
  return document.querySelector(OVERLAY) !== null
}

function visibleRows(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('.wb-work [data-wbrow]')]
    .filter(el => el.offsetParent !== null)
}

function rowLabel(el: HTMLElement): string {
  const id = el.getAttribute('data-wbrow') ?? ''
  const known = lookupRow(id)
  if (known) return known.label
  return (el.textContent ?? '').trim().slice(0, 60) || 'this row'
}

function searchField(): HTMLInputElement | null {
  return document.querySelector<HTMLInputElement>(
    '.wb-work input.ct-fsearch-in, .wb-work input.search-in, .wb-work input[type=search]',
  )
}

// The signature a selection is allowed to survive. Job, lane, tab and the search
// text: change any one of them and the rows underneath are different rows.
// The lane the search runs in. Shell publishes it on the work region
// (`data-wblane`) precisely so this propless layer does not have to guess: a
// search that inferred its own tenancy is the one defect this feature cannot
// have. Anything unrecognised falls back to Ivan's own lane rather than to a
// filterless query.
function readLane(): ContentLane {
  const v = document.querySelector('.wb-work')?.getAttribute('data-wblane')
  return v === 'risedtc' || v === 'arch' ? v : 'ivan'
}

const EMPTY_FIND: CrossResults = {
  hits: [], counts: { dm: 0, draft: 0, magnet: 0 }, lane: 'ivan', failed: [],
}

const FIND_DEBOUNCE_MS = 250

function readScope(): string {
  const job = parseWbHash(location.hash).job
  const lane = document.querySelector('.wb-work .ct-cmd-lane.on')?.textContent ?? ''
  const tab = document.querySelector('.wb-work .ct-tab.on')?.textContent ?? ''
  return `${job}|${lane}|${tab}|${searchField()?.value ?? ''}`
}

export function CommandLayer() {
  const [palette, setPalette] = useState(false)
  const [sheet, setSheet] = useState(false)
  const bulk = useBulkRun()

  // ---- cross-object search (AI pass item 3) -------------------------------
  //
  // Debounced, lane-scoped, read only, and it OPENS things. Nothing in this
  // path writes: a picked row dispatches 'wb-open' and Shell navigates to it,
  // which is the same thing a click on the row would have done.
  const [findQ, setFindQ] = useState('')
  const [findLane, setFindLane] = useState<ContentLane>('ivan')
  const [findRes, setFindRes] = useState<CrossResults>(EMPTY_FIND)
  const [findBusy, setFindBusy] = useState(false)
  // Only the newest query is allowed to write a result. Without this a slow
  // three-letter search landing after a fast five-letter one would repaint the
  // list with answers to a question he has already finished asking.
  const findSeq = useRef(0)

  useEffect(() => {
    const q = findQ.trim()
    if (q.length < CROSS_MIN) { setFindRes(EMPTY_FIND); setFindBusy(false); return }
    setFindBusy(true)
    const mine = ++findSeq.current
    const t = window.setTimeout(() => {
      void crossSearch(q, findLane).then(r => {
        if (findSeq.current !== mine) return
        setFindRes(r)
        setFindBusy(false)
      }).catch(() => {
        if (findSeq.current !== mine) return
        setFindRes({ ...EMPTY_FIND, lane: findLane, failed: ['anything'] })
        setFindBusy(false)
      })
    }, FIND_DEBOUNCE_MS)
    return () => window.clearTimeout(t)
  }, [findQ, findLane])

  const openHit = useCallback((h: CrossHit) => {
    window.dispatchEvent(new CustomEvent('wb-open', {
      detail: { kind: h.surface === 'dm' ? 'thread' : h.surface, id: h.id, lane: h.lane, row: h.row },
    }))
  }, [])

  const find: FindState = {
    ...findRes,
    lane: findLane,
    q: findQ,
    busy: findBusy,
    setLane: setFindLane,
  }

  const selected = useSyncExternalStore(subscribe, getSelected)
  const focusId = useSyncExternalStore(subscribe, getFocusId)

  // Tell the rows there are keys behind them. RowSelect is rendered from
  // InboxScreen, which the pre-revamp #exp/stock shell also renders without ever
  // mounting this layer, so without this the escape hatch grows a selection mark
  // it cannot drive. Announced on mount, withdrawn on unmount.
  useEffect(() => {
    setLayerMounted(true)
    return () => setLayerMounted(false)
  }, [])

  // Scope watch. Cheap poll rather than a subtree MutationObserver over a list
  // that can hold 300 rows: this asks four questions of four elements.
  useEffect(() => {
    const check = () => setScope(readScope())
    check()
    const t = window.setInterval(check, 400)
    return () => window.clearInterval(t)
  }, [])

  // Read only when something needs it. Walking 300 rows and asking each one for
  // its offsetParent is a layout read per row, so it happens when the palette
  // opens rather than on a timer.
  const rows = useMemo(() => (palette
    ? visibleRows().map(el => ({
      id: el.getAttribute('data-wbrow') ?? '',
      label: rowLabel(el),
      el,
    }))
    : []), [palette])
  // What "select all" would take. Only asked while a selection exists, and a
  // render only happens on a real interaction.
  const rowCount = selected.length > 0 ? visibleRows().length : 0

  const move = useCallback((delta: number) => {
    const list = visibleRows()
    if (list.length === 0) return
    const cur = getFocusId()
    const at = cur === null ? -1 : list.findIndex(el => el.getAttribute('data-wbrow') === cur)
    // No row focused yet: j starts at the top, k starts at the bottom. Nothing
    // scrolls until there is a row to scroll to.
    const next = at < 0
      ? (delta > 0 ? 0 : list.length - 1)
      : Math.min(list.length - 1, Math.max(0, at + delta))
    const el = list[next]
    if (!el) return
    setFocus(el.getAttribute('data-wbrow'))
    el.scrollIntoView({ block: 'nearest' })
  }, [])

  const focusedEl = useCallback((): HTMLElement | null => {
    const cur = getFocusId()
    if (cur === null) return null
    return visibleRows().find(el => el.getAttribute('data-wbrow') === cur) ?? null
  }, [])

  const openRow = useCallback((el: HTMLElement) => { el.click() }, [])

  const openFocused = useCallback(() => {
    const el = focusedEl()
    if (el) el.click()
  }, [focusedEl])

  const toggleFocused = useCallback(() => {
    const cur = getFocusId()
    if (cur === null) return
    const row = lookupRow(cur)
    if (row) toggleRow(row)
  }, [])

  const selectAll = useCallback(() => {
    const all = visibleRows()
      .map(el => lookupRow(el.getAttribute('data-wbrow') ?? ''))
      .filter((r): r is SelectedRow => r !== null)
    selectRows(all)
  }, [])

  const focusSearch = useCallback(() => {
    const f = searchField()
    if (!f) return
    f.focus()
    f.select()
  }, [])

  const go = useCallback((job: Job) => {
    // The hash IS the navigation. Shell already listens for hashchange and moves
    // the job, so the palette needs no wiring into the shell's state.
    location.hash = wbHash(job, null)
  }, [])

  const runBulk = useCallback((cap: RowCap) => {
    void bulk.run(cap, getSelected())
  }, [bulk])

  // Escape, in the order the layers stack. Each press closes exactly one thing:
  // an Escape that dropped the palette AND the selection would throw away a
  // 46-row pick as the side effect of closing a window.
  const closeTop = useCallback(() => {
    if (palette) { setPalette(false); return }
    if (sheet) { setSheet(false); return }
    if (getSelected().length > 0) { clearSelection(); return }
    if (getFocusId() !== null) { setFocus(null); return }
    // The last layer: a row that was opened. Measured at 390 with this probe:
    // a thread opened with Enter becomes a full-screen peer (layout.ts, work
    // 'hidden'), and NOTHING closed it from the keyboard: Takeover owns Escape
    // for the draft and magnet windows, but a peer is not a Takeover, so the
    // only way back was the back chevron. Escape presses the peer's own close
    // control rather than reaching into the shell's state, so there is one
    // close path and this cannot drift from the button.
    if (document.querySelector('.wb-tkscrim')) return
    // Three close controls, because the peers were built at three times: the
    // phone's chat peer draws `.wb-back`, the phone's thread peer draws the
    // inbox's older `.back`, and a desktop peer draws `.wb-pane-x`. The probe
    // caught the middle one: it was the only lane where Escape did nothing.
    const back = document.querySelector<HTMLElement>(
      '.wb-take .wb-back, .wb-take .back, .wb-peer .wb-pane-x',
    )
    if (back) back.click()
  }, [palette, sheet])

  // Built only while a surface is printing it. Both renderings read this one
  // array, so the sheet and the palette cannot disagree.
  const cmds = useMemo(() => (!palette && !sheet ? [] : buildCommands({
    job: parseWbHash(location.hash).job,
    rows,
    focusId,
    selected,
    capCount: capCountOf(selected),
    hasSearch: searchField() !== null,
    go,
    move,
    openFocused,
    toggleFocused,
    selectAll,
    clearSelection,
    focusSearch,
    openSheet: () => setSheet(true),
    openPalette: () => setPalette(true),
    closeTop,
    runBulk,
    openRow,
  })), [palette, sheet, rows, focusId, selected, go, move, openFocused, toggleFocused,
    selectAll, focusSearch, closeTop, runBulk, openRow])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // 🔴 GUARD ONE: never inside a field. Same rule as Takeover.tsx:42, and
      // wider: this listener binds bare letters, so a `j` typed into the chat
      // composer or the search box must reach the box and nothing else. The
      // palette's own input handles its keys locally (CommandPalette.onKey), so
      // the palette stays fully keyboard-driven under this rule.
      if (inField(document.activeElement)) return

      // 🔴 GUARD TWO: while our own layers are up, only Escape means anything
      // out here. The palette owns its keys; the sheet is a reading surface.
      if (palette || sheet) {
        if (e.key === 'Escape') {
          e.preventDefault()
          // Beats Takeover's window listener, which would otherwise close the
          // window underneath in the same keypress.
          e.stopImmediatePropagation()
          closeTop()
        }
        return
      }

      // ⌘K opens the palette from anywhere the layer is live, including over a
      // takeover window: it is the way to reach a command without hunting for a
      // button, which is the point of it.
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault()
        setScope(readScope())
        // The search opens on the lane he is looking at, and the palette says
        // which lane that is rather than leaving him to infer it.
        setFindLane(readLane())
        setFindQ('')
        setFindRes(EMPTY_FIND)
        setPalette(true)
        return
      }

      // 🔴 GUARD THREE: a takeover window or a confirm sheet owns the keyboard.
      // The draft window and the magnet window each walk their OWN queue with
      // j/k, and Takeover owns Escape.
      if (overlayOpen()) return
      if (e.metaKey || e.ctrlKey || e.altKey) return

      switch (e.key) {
        case 'j': e.preventDefault(); move(1); break
        case 'k': e.preventDefault(); move(-1); break
        case 'x': e.preventDefault(); toggleFocused(); break
        case '/': e.preventDefault(); focusSearch(); break
        case '?': e.preventDefault(); setSheet(true); break
        case 'Enter': {
          const el = focusedEl()
          if (!el) return
          e.preventDefault()
          el.click()
          break
        }
        case 'Escape': {
          e.preventDefault()
          closeTop()
          break
        }
        default: break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [palette, sheet, move, toggleFocused, focusSearch, focusedEl, closeTop])

  return (
    <>
      <BulkBar
        rows={selected}
        state={bulk.state}
        onRun={runBulk}
        onDismiss={bulk.dismiss}
        onSelectAll={selectAll}
        onClear={clearSelection}
        rowCount={rowCount}
      />
      {palette && (
        <CommandPalette
          cmds={cmds}
          find={find}
          onQuery={setFindQ}
          onPick={openHit}
          onClose={() => setPalette(false)}
        />
      )}
      {sheet && <ShortcutSheet cmds={cmds} onClose={() => setSheet(false)} />}
    </>
  )
}
