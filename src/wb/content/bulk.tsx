/* ==========================================================================
   S24 — THE BULK BAR, on the ds primitive.

   Copied from `src/exp/v2c/BulkBar.tsx`. The WRITES are untouched and are not
   re-implemented here: `useBulkRun` is imported from that module, so every
   confirm, every per-row refusal message, the archived-fallback sentence and
   the cross-surface refresh signal are the same code the shipped bar runs.

   The three rules it keeps, each one a defect somewhere else in this app:

    1. THE COUNT NAMES THE OBJECT. "12 selected" makes the reader guess twelve
       of what. It says "12 drafts selected", and the noun comes from the rows.
    2. AN ACTION RUNS ON EVERY SELECTED ROW OR NONE. If four of twelve rows
       cannot take it, the button is refused and says which number.
    3. ONE CONFIRM, NAMING THE COUNT AND THE CONSEQUENCE.

   PROMOTE TAKES A ROW OF ITS OWN, above the actions, and that is a measured
   width constraint rather than a style choice: the bar sizes to its content, so
   appending a fifth verb slid Delete sideways into the place a hand had learned
   as Delete. It is also the honest layout: the one action here that a paying
   client feels should not be a fourth verb in a row of verbs.

   While this screen is mounted, the app's own copy of the bar is withdrawn
   (one attribute on the document element, cleaned up on unmount) so the two do
   not stack: the SELECTION is shared through the store, so both would
   otherwise draw the same rows.
   ========================================================================== */
import { useCallback, useEffect, useSyncExternalStore } from 'react'
import {
  CAP_BUTTONS, CAP_ORDER, capCountOf, promoteAudience, useBulkRun,
} from '../../exp/v2c/BulkBar'
import { selectionNoun } from '../../exp/v2c/commandSource'
import {
  clearSelection, getSelected, lookupRow, selectRows, subscribe,
  type RowCap, type SelectedRow,
} from '../../exp/v2c/commandStore'
import { BulkBar, Button } from '../../ds'
import './content.css'

const VERB: Record<RowCap, string> = {
  approve: 'Approve', skip: 'Skip', promote: 'Put on board', delete: 'Delete', discard: 'Discard',
}

/** The rows the keyboard layer would walk: the DOM is the order, and the
    registry is the metadata. Read only when something needs it. */
function visibleRows(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('.wb-work [data-wbrow]')]
    .filter(el => el.offsetParent !== null)
}

export function ContentBulkBar() {
  const selected = useSyncExternalStore(subscribe, getSelected)
  const bulk = useBulkRun()

  // The app mounts its own bar from the command layer. While this screen is up,
  // this one is the bar on screen.
  useEffect(() => {
    const root = document.documentElement
    root.setAttribute('data-a-content-bulk', '')
    return () => root.removeAttribute('data-a-content-bulk')
  }, [])

  const selectAll = useCallback(() => {
    const all = visibleRows()
      .map(el => lookupRow(el.getAttribute('data-wbrow') ?? ''))
      .filter((r): r is SelectedRow => r !== null)
    selectRows(all)
  }, [])

  const run = useCallback((cap: RowCap) => {
    void bulk.run(cap, getSelected())
  }, [bulk])

  const n = selected.length
  const state = bulk.state
  if (n === 0 && !state.note && !state.busy) return <BulkBar open={false} count={null} />

  // MID-RUN AND POST-RUN. The selection bar is replaced by what the batch did:
  // "{done} of {total}" while it runs, "Done" after, and the note says how many
  // landed, how many failed and were left alone, or how many the database
  // refused to remove and archived instead.
  if (n === 0) {
    return (
      <BulkBar
        open
        count={state.busy ? `${state.done} of ${state.total}` : 'Done'}
        note={
          <>
            {state.note ?? 'Working through the selection.'}
            {state.errors.length > 0 && (
              <span className="a-ct-err" title={state.errors.join('\n')}> {state.errors[0]}</span>
            )}
          </>
        }
        progress={state.busy ? { done: state.done, total: state.total } : undefined}
        actions={!state.busy
          ? <Button variant="quiet" size="sm" onClick={bulk.dismiss}>Dismiss</Button>
          : undefined}
      />
    )
  }

  const caps = capCountOf(selected)
  const noun = selectionNoun(selected)
  const kinds = new Set(selected.map(r => r.kind))
  // Read off CAP_ORDER rather than a hand-written list, so a capability added
  // later cannot be left out of this check and silently print the refusal over
  // a bar that does have a button to offer.
  const noWrites = CAP_ORDER.every(c => caps[c] === 0)
  const rowCount = visibleRows().length
  const partial = !noWrites && CAP_ORDER.some(c => caps[c] > 0 && caps[c] < n)

  return (
    <BulkBar
      open
      count={`${n} ${noun} selected`}
      actions={
        <>
          {/* THE CLIENT-FACING ROW, first and on its own line. */}
          {caps.promote > 0 && (
            <Button
              variant="primary" size="sm"
              disabled={caps.promote !== n || state.busy}
              title={caps.promote === n
                ? `Put all ${n} on ${promoteAudience(selected)}’s board. He sees them.`
                : `${caps.promote} of the ${n} selected rows can take this. A bulk action runs on every selected row or none.`}
              onClick={() => run('promote')}
            >
              {VERB.promote} {caps.promote === n ? n : `${caps.promote}/${n}`}
            </Button>
          )}
          {!noWrites && CAP_BUTTONS.map(cap => {
            const have = caps[cap]
            if (have === 0) return null
            const all = have === n
            return (
              <Button
                key={cap}
                // Delete and discard both carry a danger confirm, so both read
                // as destructive here. Promote never reaches this map at all.
                variant={cap === 'delete' || cap === 'discard' ? 'danger' : 'default'}
                size="sm"
                disabled={!all || state.busy}
                title={all
                  ? `${VERB[cap]} all ${n}`
                  : `${have} of the ${n} selected rows can take this. A bulk action runs on every selected row or none.`}
                onClick={() => run(cap)}
              >
                {VERB[cap]} {all ? n : `${have}/${n}`}
              </Button>
            )
          })}
        </>
      }
      note={
        noWrites
          ? (kinds.has('thread')
            ? 'A conversation is answered one at a time. Open one to read it and reply.'
            : 'Nothing on this tab can be changed in bulk. Open a row to act on it.')
          // Rule 2, said out loud rather than left to a disabled button.
          : partial
            ? <>Some of these rows cannot take every action. A bulk action runs on all {n} or none, so narrow the selection first.</>
            : undefined
      }
      onSelectAll={n < rowCount ? selectAll : undefined}
      selectAllLabel={`Select all ${rowCount}`}
      onClear={clearSelection}
    />
  )
}
