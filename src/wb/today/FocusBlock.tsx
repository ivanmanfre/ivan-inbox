/* ==========================================================================
   src/wb/today/FocusBlock.tsx - Today's first line (instantly-picks item 1).

   The one shared view both Today shells mount (src/screens/TodayScreen.tsx
   and src/wb/today/index.tsx), so a phone-shell change and a workbench
   change can never drift into two different sentences or two different
   approve paths. All the derivation (count, line, batching, partial-failure
   orchestration) is the pure src/lib/focus.ts module, unit-tested on literal
   inputs; this file is the thin, impure layer that wires that logic to the
   real per-item approve/discard calls, the SAME functions OpsScreen.tsx /
   PendingCard.tsx use, so a batch tap is never a second, divergent send path.

   Fable review round (2026-09-22), addressed here:
   - Any live comment-gate call (batch approve on a comment_outbound batch,
     or a single card inside an expanded batch) shows the same confirm the
     card does before firing (PendingCard.tsx:320-330 / OpsScreen.tsx:479-486)
     manual_invite stays tap-through.
   - Discard mirrors the card's best-effort feed-row cancel
     (PendingCard.tsx:604-609) before the real discard write.
   - Every id that resolves (success OR failure) is tracked so a re-tap can
     never re-fire it while state has not yet caught up with the server.
   - A single card's gate refusal shows the gate's own sentence under that
     row, and a clock refusal (`timing`) reads as a queue position, not an
     error (OpsScreen.tsx:508-516's own rule).
   - `data-fresh` reads Shell's `liveRead` (both hooks' loadedAt set; Shell.tsx's
     `inbox.fromCache`) for the threads half, and a local since-mount check
     for the ops half (useOps has no persisted cache, so any change from its
     initial value is a genuine live fetch).
   ========================================================================== */
import { useState } from 'react'
import { Button } from '../../ds'
import { useConfirm } from '../chrome/ConfirmSheet'
import {
  approveWeeklyReport, discardOpsDraft, dispatchCommentGate, outboundApproveUrl,
  outboundSkipUrl, seatLabel, type GateOutcome, type OpsDraft,
} from '../../lib/ops'
import {
  batchResultLine, focusSummary, pendingIdsOf, runBatch, type Batch,
} from '../../lib/focus'
import type { GovernorRow, PipelineRow } from '../../lib/kpis'
import type { Thread } from '../../lib/inbox'
import './today.css'

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

// The exact confirm PendingCard.tsx:320-330 / OpsScreen.tsx:479-486 show
// before firing the ivan-lane comment gate, kept byte-for-byte (title is the
// part the review named exactly; message/confirmText copied from
// PendingCard.tsx's already-copy-linted version, both files agree on it).
function gateConfirm(where: string) {
  return {
    title: `Send this to the ${where} comment gate?`,
    message: 'The poster’s rate caps, cooldown and jitter still decide. You get their answer on the card, no new tab.',
    confirmText: 'Approve & queue',
  }
}

// Ivan's rule: every destructive batch verb asks first. Discard is undoable
// elsewhere, and the sheet still names what goes. One builder for the batch and
// the single row, so the two can never ask different questions.
function discardConfirm(n: number) {
  return {
    title: n === 1 ? 'Discard this one?' : `Discard these ${n}?`,
    message: n === 1
      ? 'Nothing gets posted. The draft is dropped.'
      : `Nothing gets posted. All ${n} drafts are dropped.`,
    confirmText: 'Discard',
    danger: true,
  }
}

type ApproveResult =
  | { ok: true }
  | { ok: false; message: string; outcome: GateOutcome | 'error' }

// The same approve branch OpsScreen.tsx:476-579 runs, kept verbatim in
// substance: manual_invite double-stamps (nothing is sent). comment_outbound
// either fires the ivan-lane gate and only stamps on accepted/already, or
// (risedtc lane, no approve_url; never reached from FocusBlock today since
// groupBatches only batches the ivan-lane case, kept here so this function
// mirrors the card's full contract rather than a narrowed copy) copies to
// the clipboard and stamps. Never throws: the caller reads `ok` and, on a
// gate refusal, the outcome (a `timing` refusal is a queue position, not an
// error - OpsScreen.tsx:508-516).
async function dispatchApprove(d: OpsDraft): Promise<ApproveResult> {
  if (d.kind === 'manual_invite') {
    await approveWeeklyReport(d.id, d.body)
    return { ok: true }
  }
  if (d.kind === 'comment_outbound') {
    const approveUrl = outboundApproveUrl(d)
    if (approveUrl) {
      const v = await dispatchCommentGate(approveUrl)
      if (v.outcome === 'accepted' || v.outcome === 'already') {
        await approveWeeklyReport(d.id, d.body)
        return { ok: true }
      }
      return { ok: false, message: v.message, outcome: v.outcome }
    }
    await navigator.clipboard.writeText(d.body)
    await approveWeeklyReport(d.id, d.body)
    return { ok: true }
  }
  return { ok: false, message: `focus: kind ${d.kind} has no batch approve path`, outcome: 'error' }
}

// PendingCard.tsx:604-609: a best-effort cancel of the underlying feed row
// (ivan-lane comment cards only - outboundSkipUrl returns null for every
// other kind), fire-and-forget, before the real discard write. A failure here
// is fine: the row expires on its own 5-day gate either way.
async function dispatchDiscard(d: OpsDraft): Promise<void> {
  const skip = outboundSkipUrl(d)
  if (skip) { try { void fetch(skip, { mode: 'no-cors' }) } catch { /* fire and forget */ } }
  await discardOpsDraft(d.id, d.kind)
}

type SingleNote = { message: string; outcome: GateOutcome | 'error' }

export function FocusBlock({
  threads, opsDrafts, pipeline, governor, now, onChanged, liveRead,
}: {
  threads: Thread[]
  opsDrafts: OpsDraft[]
  pipeline?: PipelineRow[]
  governor?: GovernorRow[]
  now?: number
  // Fired after any write that changed a draft's state (approve or discard,
  // single or batch), so the caller's own ops read (realtime-subscribed
  // already, this is belt and braces) reconciles promptly. Optional: Shell.tsx
  // is the only wiring site authorised to pass its real `ops.refresh`
  // (fable review item 4, 2026-09-22); every other mount leaves it unset.
  onChanged?: () => void
  // Shell.tsx's `inbox.fromCache` (useInbox's own stale-while-revalidate
  // flag), forwarded here so data-fresh reads the real signal for the
  // threads half instead of a guess (fable review item 6, 2026-09-22).
  // Undefined (no host wired it) reads as "not known to be cached".
  liveRead?: boolean
}) {
  const confirm = useConfirm()

  // "fresh" = both halves of the count came from a network read in this page
  // load: Shell passes true only once useInbox AND useOps have stamped their
  // own loadedAt (set only on a successful live read, never from the SWR seed).
  const fresh = !!liveRead

  // Ids this component has already resolved (approved or discarded), kept
  // client-side until the parent's own ops read catches up - without this a
  // re-tap between "the write landed" and "the realtime update arrived" could
  // fire the same approve/discard twice.
  const [doneIds, setDoneIds] = useState<Set<string>>(new Set())
  const liveOpsDrafts = opsDrafts.filter(d => !doneIds.has(d.id))
  function markDone(id: string) {
    setDoneIds(s => (s.has(id) ? s : new Set(s).add(id)))
  }

  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set())
  const [batchNote, setBatchNote] = useState<Record<string, string>>({})
  const [singleNotes, setSingleNotes] = useState<Record<string, SingleNote>>({})

  const summary = focusSummary({ threads, opsDrafts: liveOpsDrafts, now, pipeline, governor })
  const byId = new Map(liveOpsDrafts.map(d => [d.id, d]))

  function toggleExpanded(key: string) {
    setExpanded(s => {
      const next = new Set(s)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }
  function markBusy(ids: string[], on: boolean) {
    setBusyIds(s => {
      const next = new Set(s)
      for (const id of ids) { if (on) next.add(id); else next.delete(id) }
      return next
    })
  }
  // A gate call needs the reader's confirm first; manual_invite (and the
  // clipboard/risedtc comment branch, unreached from here today) stay
  // tap-through, same as the card.
  function needsGateConfirm(d: OpsDraft): boolean {
    return d.kind === 'comment_outbound' && outboundApproveUrl(d) !== null
  }

  async function onApproveOne(d: OpsDraft) {
    if (needsGateConfirm(d)) {
      const ok = await confirm(gateConfirm(seatLabel(d.client_id)))
      if (!ok) return
    }
    markBusy([d.id], true)
    setSingleNotes(s => { if (!(d.id in s)) return s; const { [d.id]: _drop, ...rest } = s; return rest })
    try {
      const r = await dispatchApprove(d)
      if (r.ok) {
        markDone(d.id)
        onChanged?.()
      } else {
        setSingleNotes(s => ({ ...s, [d.id]: { message: r.message, outcome: r.outcome } }))
      }
    } catch (e) {
      setSingleNotes(s => ({ ...s, [d.id]: { message: errText(e), outcome: 'error' } }))
    } finally {
      markBusy([d.id], false)
    }
  }

  async function onDiscardOne(d: OpsDraft) {
    if (!(await confirm(discardConfirm(1)))) return
    markBusy([d.id], true)
    try {
      await dispatchDiscard(d)
      markDone(d.id)
      onChanged?.()
    } catch (e) {
      setSingleNotes(s => ({ ...s, [d.id]: { message: errText(e), outcome: 'error' } }))
    } finally {
      markBusy([d.id], false)
    }
  }

  async function onApproveBatch(b: Batch) {
    const ids = pendingIdsOf(b, liveOpsDrafts)
    if (ids.length === 0) return
    if (b.kind === 'comment_outbound') {
      const ok = await confirm(gateConfirm(seatLabel(b.client ?? 'ivan')))
      if (!ok) return
    }
    markBusy(ids, true)
    const r = await runBatch(ids, async id => {
      const d = byId.get(id)
      if (!d) return
      const res = await dispatchApprove(d)
      if (res.ok) {
        markDone(id)
      } else {
        setSingleNotes(s => ({ ...s, [id]: { message: res.message, outcome: res.outcome } }))
        throw new Error(res.message)
      }
    })
    setBatchNote(s => ({ ...s, [b.key]: batchResultLine(r, ids.length) }))
    markBusy(ids, false)
    if (r.succeeded.length > 0) onChanged?.()
  }

  async function onDiscardBatch(b: Batch) {
    const ids = pendingIdsOf(b, liveOpsDrafts)
    if (ids.length === 0) return
    if (!(await confirm(discardConfirm(ids.length)))) return
    markBusy(ids, true)
    const r = await runBatch(ids, async id => {
      const d = byId.get(id)
      if (!d) return
      await dispatchDiscard(d)
      markDone(id)
    })
    setBatchNote(s => ({ ...s, [b.key]: batchResultLine(r, ids.length, 'discarded') }))
    markBusy(ids, false)
    if (r.succeeded.length > 0) onChanged?.()
  }

  return (
    <div className="a-focus">
      <div
        className="a-focus-line"
        data-focus-line
        data-focus-count={summary.count}
        data-focus-replies={summary.replyCount}
        data-focus-ops={summary.opsCount}
        data-fresh={fresh ? '1' : '0'}
      >
        {/* Until both live reads land the count is partial (skeptic 1, 2026-09-22:
            a cold load whose thread read never arrived showed "2 things" for 2 min
            with 13 replies live). The number stays in the data attributes. */}
        {fresh ? summary.line : 'Checking what needs you.'}
      </div>
      {summary.batches.length > 0 && (
        <div className="a-focus-batches">
          {summary.batches.map(b => {
            const pendingIds = pendingIdsOf(b, liveOpsDrafts)
            const batchBusy = pendingIds.some(id => busyIds.has(id))
            return (
              <div key={b.key} className="a-focus-batch">
                <div className="a-focus-batch-row">
                  <button type="button" className="a-focus-batch-label" onClick={() => toggleExpanded(b.key)}>
                    {b.label}
                  </button>
                  <span className="a-focus-batch-actions">
                    <Button variant="primary" size="sm" busy={batchBusy} onClick={() => onApproveBatch(b)}>✓</Button>
                    <Button variant="quiet" size="sm" busy={batchBusy} onClick={() => onDiscardBatch(b)}>✗</Button>
                  </span>
                </div>
                {batchNote[b.key] && <div className="a-focus-batch-note">{batchNote[b.key]}</div>}
                {expanded.has(b.key) && (
                  <div className="a-focus-batch-expand">
                    {b.ids.map(id => {
                      const d = byId.get(id)
                      if (!d) return null
                      const note = singleNotes[id]
                      return (
                        <div key={id} className="a-focus-single">
                          <div className="a-focus-single-row">
                            <span className="a-focus-single-body">{d.body}</span>
                            <span className="a-focus-batch-actions">
                              <Button variant="primary" size="sm" busy={busyIds.has(id)} onClick={() => onApproveOne(d)}>✓</Button>
                              <Button variant="quiet" size="sm" busy={busyIds.has(id)} onClick={() => onDiscardOne(d)}>✗</Button>
                            </span>
                          </div>
                          {note && (
                            <div className={`a-focus-single-note${note.outcome === 'timing' ? '' : ' a-focus-single-note-err'}`}>
                              {note.message}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
