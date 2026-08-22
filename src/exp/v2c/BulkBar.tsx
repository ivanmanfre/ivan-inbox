import { useCallback, useState } from 'react'
import { useConfirm } from '../../components/ConfirmSheet'
import {
  LANE_LABEL, approveDraft, deleteClientDraft, deleteDraft, setBoardVisible, skipDraft,
  type ContentLane,
} from '../../lib/content'
import { discardDraft } from '../../lib/inbox'
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

const VERB: Record<RowCap, string> = {
  approve: 'Approve', skip: 'Skip', promote: 'Put on board', delete: 'Delete', discard: 'Discard',
}

// 🔴 WHY PROMOTE IS NOT IN THE BUTTON GROUP, MEASURED.
//
// Before p4b a client review selection offered exactly ONE button, Delete, so
// that position IS the learned target for a destructive action on those rows.
// The first attempt here appended promote after delete inside `.wb-bulk-acts`,
// on the reasoning that appending never moves what is already there. That
// reasoning is wrong on this bar and the browser said so: `.wb-bulk` is
// `left:50%; transform:translateX(-50%)`, so it is CENTERED and its width is its
// content's width. Adding one button widened the bar by 126.8px and slid Delete
// 63.4px LEFT, and the point a hand had learned as Delete landed inside the new
// client-facing button. Promoting 54 drafts to a paying client's live board
// while reaching for Delete is the exact accident this bar exists to prevent.
//
// So promote takes a ROW OF ITS OWN, above the actions. The bar's width is the
// width of its widest row, and the action row is much wider than one button, so
// the bar does not widen and Delete's x does not move at all. Delete moves UP by
// the height of the new row, into empty space, and the coordinate it vacated is
// bar background. Re-measured after the change, in probe-ui.mjs `deleteHitbox`.
//
// It also happens to be the honest layout: the one action on this bar that a
// paying client feels should not be a fourth verb in a row of verbs.
// Exported for capCoverage.test.tsx, which holds this list to the RowCap union:
// a cap that never reaches this array is a cap the bar cannot count, refuse or
// print, and nothing in the compiler notices a short array literal.
export const CAP_ORDER: RowCap[] = ['approve', 'skip', 'promote', 'discard', 'delete']
// The ones that render as buttons in the action group. Promote is deliberately
// absent; it is rendered separately, above.
//
// Discard sits before delete and never beside promote: the two branches that
// merged here added their capability independently, and the measured hazard
// above is about a client-facing button appearing where a hand has learned a
// destructive one. Discard is neither client-facing nor destructive (a
// discarded draft can be brought back), and a conversation row never carries
// promote, so the two never render in the same group on the same selection.
export const CAP_BUTTONS: RowCap[] = ['approve', 'skip', 'discard', 'delete']

export function capCountOf(rows: SelectedRow[]): Record<RowCap, number> {
  return {
    approve: rows.filter(r => r.caps.includes('approve')).length,
    skip: rows.filter(r => r.caps.includes('skip')).length,
    promote: rows.filter(r => r.caps.includes('promote')).length,
    delete: rows.filter(r => r.caps.includes('delete')).length,
    discard: rows.filter(r => r.caps.includes('discard')).length,
  }
}

// Whose board this batch would land on. A promote confirm that does not name the
// client is not a confirm. Every selection here is lane-scoped by the fetch
// (content.ts laneFilter), so this is one value in practice, but it is READ off
// the rows rather than assumed, and a mixed selection says so instead of
// picking one.
export function promoteAudience(rows: SelectedRow[]): string {
  const lanes = [...new Set(rows.map(r => r.lane).filter((l): l is string => !!l && l !== 'ivan'))]
  if (lanes.length === 1) return LANE_LABEL[lanes[0] as ContentLane] ?? lanes[0]
  return lanes.length === 0 ? 'a client' : lanes.map(l => LANE_LABEL[l as ContentLane] ?? l).join(' and ')
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
        // 🔴 THE ONE ACTION ON THIS BAR THAT A PAYING CLIENT SEES. It names the
        // client and it names the count, in that order, because "Promote 54"
        // does not tell a reader whose board 54 posts are about to appear on.
        // There is no silent path to this: it is behind the same confirm the
        // takeover's single-row promote uses, saying the same thing.
        : cap === 'promote'
          ? {
            title: `Put ${n} ${noun} on ${promoteAudience(rows)}’s board?`,
            message:
              `${promoteAudience(rows)} sees all ${n} of them. Each one fires his board’s own sync, so they `
              + `land within moments and not at some later batch. Nothing publishes: this writes board `
              + `visibility and never touches the publisher. Taking one back off is one click per post.`,
            confirmText: `Put ${n} on his board`,
          }
          : cap === 'discard'
            ? {
              title: `Discard ${n} draft${n === 1 ? '' : 's'}?`,
              message: `None of these send anything, which is why this is the one bulk action a conversation row carries. A discarded draft can still be brought back, but only by opening its thread.`,
              confirmText: `Discard ${n}`,
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
        // The SAME write the takeover's single-row promote makes, row by row.
        // No batched variant exists and none is written here: the RPC fires the
        // client board's sync webhook inline, so N calls are N syncs, which is
        // the behaviour the board already depends on.
        else if (cap === 'promote') await setBoardVisible(r.id, true)
        else if (cap === 'discard') {
          const stopped = await discardDraft(r.id)
          if (!stopped) errors.push(`${r.label}: already approved or sent, nothing to discard`)
        } else if (cap === 'delete') {
          const how = r.lane && r.lane !== 'ivan'
            ? await deleteClientDraft(r.id, r.taxonomy)
            : await deleteDraft(r.id, r.taxonomy)
          if (how === 'disqualified') archived += 1
        } else {
          // 🔴 DELETE IS NAMED, NOT LEFT AS THE FALL-THROUGH. This chain used to
          // end in a bare `else` that ran the delete, so a capability added to
          // RowCap and not taught here would have DELETED every selected row
          // while the operator read a confirm for something else. The compiler
          // sees nothing wrong with a short if/else chain. This branch is
          // unreachable today (`cap` narrows to never) and it stays as the
          // stop: an unknown cap writes nothing and reports itself per row.
          errors.push(`${r.label}: this bar has no write for "${String(cap)}"`)
        }
      } catch (e) {
        errors.push(`${r.label}: ${e instanceof Error ? e.message : String(e)}`)
      }
      done += 1
      setState(s => ({ ...s, done }))
    }

    const okCount = n - errors.length
    // 🔴 A row the server refused is never counted as done. `okCount` is
    // n minus the rows that THREW, and every refusal keeps its own message with
    // the row's own label, so a partial batch reports what it did and what it
    // did not, per row. ClientRpcError carries the database's own code
    // ('not_in_review' when a row moved out of review under the selection), so
    // the refusal that reaches the bar is the one the database gave.
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
  // Read off CAP_ORDER rather than a hand-written list of caps, so a capability
  // added later cannot be left out of this check and silently print the refusal
  // over a bar that does have a button to offer.
  const noWrites = CAP_ORDER.every(c => caps[c] === 0)

  return (
    <div className="wb-bulk" role="region" aria-label="Selected rows">
      <span className="wb-bulk-n">{n} {noun} selected</span>

      {/* THE CLIENT-FACING ROW. First child and `flex-basis:100%`, so it claims
          the top line of the bar and the action row below it keeps the exact x
          it had before this capability existed. */}
      {caps.promote > 0 && (
        <div className="wb-bulk-client">
          {/* 🔴 THE ROW HOLDS THE BUTTON AND NOTHING ELSE, and that is a width
              constraint rather than a style choice. The bar sizes to its widest
              ROW, so a sentence here would widen the bar and move Delete again,
              which is the whole defect this layout exists to avoid. The client's
              name rides in the title and in the confirm; the partial-selection
              refusal is the bar's existing sentence, below. */}
          <button
            type="button"
            className="wb-bulk-b client"
            disabled={caps.promote !== n || state.busy}
            title={caps.promote === n
              ? `Put all ${n} on ${promoteAudience(rows)}’s board. He sees them.`
              : `${caps.promote} of the ${n} selected rows can take this. A bulk action runs on every selected row or none.`}
            onClick={() => onRun('promote')}
          >
            {VERB.promote} {caps.promote === n ? n : `${caps.promote}/${n}`}
          </button>
        </div>
      )}

      {noWrites ? (
        <span className="wb-bulk-note">
          {kinds.has('thread')
            ? 'A conversation is answered one at a time. Open one to read it and reply.'
            : 'Nothing on this tab can be changed in bulk. Open a row to act on it.'}
        </span>
      ) : (
        <div className="wb-bulk-acts">
          {CAP_BUTTONS.map(cap => {
            const have = caps[cap]
            if (have === 0) return null
            const all = have === n
            return (
              <button
                type="button"
                key={cap}
                // Delete and discard both carry a danger confirm, so both read
                // as destructive here. Promote never reaches this map at all,
                // because CAP_BUTTONS leaves it out and it draws its own
                // `client` styling on its own row above, for the measured
                // reason recorded there.
                className={`wb-bulk-b${cap === 'delete' || cap === 'discard' ? ' danger' : ''}`}
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
      {!noWrites && CAP_ORDER.some(c => caps[c] > 0 && caps[c] < n) && (
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
