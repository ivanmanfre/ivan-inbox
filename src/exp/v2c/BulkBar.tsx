import { useCallback, useState } from 'react'
import { useConfirm } from '../../components/ConfirmSheet'
import {
  approveDraft, deleteClientDraft, deleteDraft, skipDraft,
} from '../../lib/content'
import { selectionNoun } from './commandSource'
import { clearSelection, type RowCap, type SelectedRow } from './commandStore'

// THE BULK BAR.
//
// The acceptance case is the Errors tab (46 rows) and the Archive (88): both
// have to be workable in one pass, which is what a bar over a selection buys
// over 46 trips into a row and back out.
//
// THREE RULES IT KEEPS, each one a defect somewhere else in this app:
//
//  1. THE COUNT NAMES THE OBJECT. "12 selected" makes the reader guess twelve
//     of what. It says "12 drafts selected", and the noun comes from the rows
//     themselves.
//  2. AN ACTION RUNS ON EVERY SELECTED ROW OR NONE. If four of twelve rows
//     cannot take it, the button is refused and says which number, rather than
//     applying quietly to a subset. A bulk action that silently skips rows is
//     how an operator learns to distrust the count.
//  3. ONE CONFIRM, NAMING THE COUNT AND THE CONSEQUENCE, and for the
//     destructive ones, naming what cannot be undone. The stale-draft bar
//     already fires N terminal writes behind one confirm; this does not copy
//     that shape without the sentence.
//
// The writes are the SAME functions the single-row controls call. No bulk path
// has a write of its own to drift from the one the buttons use.

export type BulkState = {
  busy: boolean
  done: number
  total: number
  errors: string[]
  note: string | null
}

const IDLE: BulkState = { busy: false, done: 0, total: 0, errors: [], note: null }

const VERB: Record<RowCap, string> = { approve: 'Approve', skip: 'Skip', delete: 'Delete' }

export function capCountOf(rows: SelectedRow[]): Record<RowCap, number> {
  return {
    approve: rows.filter(r => r.caps.includes('approve')).length,
    skip: rows.filter(r => r.caps.includes('skip')).length,
    delete: rows.filter(r => r.caps.includes('delete')).length,
  }
}

export function useBulkRun(): {
  state: BulkState
  run: (cap: RowCap, rows: SelectedRow[]) => Promise<void>
  dismiss: () => void
} {
  const confirm = useConfirm()
  const [state, setState] = useState<BulkState>(IDLE)

  const run = useCallback(async (cap: RowCap, rows: SelectedRow[]) => {
    const n = rows.length
    if (n === 0) return
    // Rule 2, enforced here and not only in the disabled state: the palette can
    // reach this too, and a refusal that only lives in a button is not a rule.
    const eligible = rows.filter(r => r.caps.includes(cap))
    if (eligible.length !== n) return
    const noun = selectionNoun(rows)

    const ok = await confirm(cap === 'approve'
      ? {
        title: `Approve ${n} ${noun}?`,
        message: `Each one is marked approved. Nothing publishes and no date is set, so the schedule stays exactly where it is.`,
        confirmText: `Approve ${n}`,
      }
      : cap === 'skip'
        ? {
          title: `Skip ${n} ${noun}?`,
          message: `Each one is marked disqualified and leaves the queue. This screen has no way to bring them back.`,
          confirmText: `Skip ${n}`,
          danger: true,
        }
        : {
          title: `Delete ${n} ${noun}?`,
          message: `This removes them for good and nothing here can undo it. Any row the database refuses to delete is archived instead, and the bar says how many.`,
          confirmText: `Delete ${n}`,
          danger: true,
        })
    if (!ok) return

    setState({ busy: true, done: 0, total: n, errors: [], note: null })
    const errors: string[] = []
    let archived = 0
    let done = 0
    for (const r of rows) {
      try {
        if (cap === 'approve') await approveDraft(r.id)
        else if (cap === 'skip') await skipDraft(r.id)
        else {
          const how = r.lane && r.lane !== 'ivan'
            ? await deleteClientDraft(r.id, r.taxonomy)
            : await deleteDraft(r.id, r.taxonomy)
          if (how === 'disqualified') archived += 1
        }
      } catch (e) {
        errors.push(`${r.label}: ${e instanceof Error ? e.message : String(e)}`)
      }
      done += 1
      setState(s => ({ ...s, done }))
    }

    const okCount = n - errors.length
    const note = cap === 'delete' && archived > 0
      // Honest about deleteDraft's fallback: the row was archived, not removed.
      ? `${okCount} of ${n} done. ${archived} could not be removed from the database and were archived instead, so they leave every list but the record stays.`
      : errors.length === 0
        ? `${okCount} of ${n} done.`
        : `${okCount} of ${n} done. ${errors.length} failed and were left alone.`
    setState({ busy: false, done: n, total: n, errors, note })
    clearSelection()
    // The lists refetch. ContentList listens for this; nothing else has to know
    // a bulk action exists.
    window.dispatchEvent(new CustomEvent('wb-rows-changed'))
  }, [confirm])

  const dismiss = useCallback(() => setState(IDLE), [])

  return { state, run, dismiss }
}

export function BulkBar({ rows, state, onRun, onDismiss, onSelectAll, onClear, rowCount }: {
  rows: SelectedRow[]
  state: BulkState
  onRun: (cap: RowCap) => void
  onDismiss: () => void
  onSelectAll: () => void
  onClear: () => void
  rowCount: number
}) {
  const n = rows.length
  if (n === 0 && !state.note && !state.busy) return null

  if (n === 0) {
    return (
      <div className="wb-bulk" role="status">
        <span className="wb-bulk-n">{state.busy ? `${state.done} of ${state.total}` : 'Done'}</span>
        <span className="wb-bulk-note">{state.note ?? 'Working through the selection.'}</span>
        {state.errors.length > 0 && (
          <span className="wb-bulk-err" title={state.errors.join('\n')}>
            {state.errors[0]}
          </span>
        )}
        {!state.busy && (
          <button type="button" className="wb-bulk-b" onClick={onDismiss}>Dismiss</button>
        )}
      </div>
    )
  }

  const caps = capCountOf(rows)
  const noun = selectionNoun(rows)
  const kinds = new Set(rows.map(r => r.kind))
  const noWrites = caps.approve === 0 && caps.skip === 0 && caps.delete === 0

  return (
    <div className="wb-bulk" role="region" aria-label="Selected rows">
      <span className="wb-bulk-n">{n} {noun} selected</span>

      {noWrites ? (
        <span className="wb-bulk-note">
          {kinds.has('thread')
            ? 'A conversation is answered one at a time. Open one to read it and reply.'
            : 'Nothing on this tab can be changed in bulk. Open a row to act on it.'}
        </span>
      ) : (
        <div className="wb-bulk-acts">
          {(['approve', 'skip', 'delete'] as RowCap[]).map(cap => {
            const have = caps[cap]
            if (have === 0) return null
            const all = have === n
            return (
              <button
                type="button"
                key={cap}
                className={`wb-bulk-b${cap === 'delete' ? ' danger' : ''}`}
                disabled={!all || state.busy}
                title={all
                  ? `${VERB[cap]} all ${n}`
                  : `${have} of the ${n} selected rows can take this. A bulk action runs on every selected row or none.`}
                onClick={() => onRun(cap)}
              >
                {VERB[cap]} {all ? n : `${have}/${n}`}
              </button>
            )
          })}
        </div>
      )}

      {/* Rule 2, said out loud rather than left to a disabled button. */}
      {!noWrites && (['approve', 'skip', 'delete'] as RowCap[]).some(c => caps[c] > 0 && caps[c] < n) && (
        <span className="wb-bulk-note">
          Some of these rows cannot take every action. A bulk action runs on all
          {' '}{n} or none, so narrow the selection first.
        </span>
      )}

      <div className="wb-bulk-tail">
        {n < rowCount && (
          <button type="button" className="wb-bulk-b s" onClick={onSelectAll}>
            Select all {rowCount}
          </button>
        )}
        <button type="button" className="wb-bulk-b s" onClick={onClear}>Clear</button>
      </div>
    </div>
  )
}
