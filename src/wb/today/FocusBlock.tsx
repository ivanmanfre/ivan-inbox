/* ==========================================================================
   src/wb/today/FocusBlock.tsx — Today's first line (instantly-picks item 1).

   The one shared view both Today shells mount (src/screens/TodayScreen.tsx
   and src/wb/today/index.tsx), so a phone-shell change and a workbench
   change can never drift into two different sentences or two different
   approve paths. All the derivation (count, line, batching, partial-failure
   orchestration) is the pure src/lib/focus.ts module, unit-tested on literal
   inputs; this file is the thin, impure layer that wires that logic to the
   real per-item approve/discard calls — the SAME functions OpsScreen.tsx /
   PendingCard.tsx use, so a batch tap is never a second, divergent send path.
   ========================================================================== */
import { useEffect, useRef, useState } from 'react'
import { Button } from '../../ds'
import {
  approveWeeklyReport, discardOpsDraft, dispatchCommentGate, outboundApproveUrl,
  type OpsDraft,
} from '../../lib/ops'
import {
  batchResultLine, focusSummary, pendingIdsOf, runBatch, type Batch,
} from '../../lib/focus'
import type { GovernorRow, PipelineRow } from '../../lib/kpis'
import type { Thread } from '../../lib/inbox'
import './today.css'

// The exact approve branch OpsScreen.tsx:476-579 runs for the two batchable
// kinds, kept verbatim: manual_invite double-stamps (nothing is sent, see
// OpsScreen's own comment at that line), comment_outbound either fires the
// ivan-lane gate and only stamps on accepted/already, or copies to the
// clipboard for the risedtc lane and stamps. A refusal/unknown gate outcome
// throws, so the card stays pending and the batch reports it as a failure —
// the same "not stamped" behaviour the single card has always had.
async function approveDraft(d: OpsDraft): Promise<void> {
  if (d.kind === 'manual_invite') {
    await approveWeeklyReport(d.id, d.body)
    return
  }
  if (d.kind === 'comment_outbound') {
    const approveUrl = outboundApproveUrl(d)
    if (approveUrl) {
      const v = await dispatchCommentGate(approveUrl)
      if (v.outcome === 'accepted' || v.outcome === 'already') {
        await approveWeeklyReport(d.id, d.body)
        return
      }
      throw new Error(v.message)
    }
    await navigator.clipboard.writeText(d.body)
    await approveWeeklyReport(d.id, d.body)
    return
  }
  throw new Error(`focus: kind ${d.kind} has no batch approve path`)
}

async function discardDraft(d: OpsDraft): Promise<void> {
  await discardOpsDraft(d.id, d.kind)
}

export function FocusBlock({
  threads, opsDrafts, pipeline, governor, now,
}: {
  threads: Thread[]
  opsDrafts: OpsDraft[]
  pipeline?: PipelineRow[]
  governor?: GovernorRow[]
  now?: number
}) {
  // "Fresh" tracks whether the arrays this render is using have been updated
  // at least once since FocusBlock mounted — the best signal available
  // without a cache flag threaded through Shell.tsx (out of this item's
  // owned files; useInbox's own `fromCache` never reaches this component).
  // useOps has no persisted cache at all (every value after mount is a real
  // fetch or a realtime update), so in practice this flips to fresh as soon
  // as either hook's first live read lands.
  const initialThreads = useRef(threads)
  const initialOps = useRef(opsDrafts)
  const [fresh, setFresh] = useState(false)
  useEffect(() => {
    if (!fresh && (threads !== initialThreads.current || opsDrafts !== initialOps.current)) setFresh(true)
  }, [threads, opsDrafts, fresh])

  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set())
  const [batchNote, setBatchNote] = useState<Record<string, string>>({})

  const summary = focusSummary({ threads, opsDrafts, now, pipeline, governor })
  const byId = new Map(opsDrafts.map(d => [d.id, d]))

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

  async function onApproveOne(d: OpsDraft) {
    markBusy([d.id], true)
    try { await approveDraft(d) } catch { /* stays pending, same as OpsScreen's own refusal path */ }
    finally { markBusy([d.id], false) }
  }
  async function onDiscardOne(d: OpsDraft) {
    markBusy([d.id], true)
    try { await discardDraft(d) } catch { /* stays pending on failure */ }
    finally { markBusy([d.id], false) }
  }
  async function onApproveBatch(b: Batch) {
    const ids = pendingIdsOf(b, opsDrafts)
    markBusy(ids, true)
    const r = await runBatch(ids, id => approveDraft(byId.get(id)!))
    setBatchNote(s => ({ ...s, [b.key]: batchResultLine(r, b.ids.length) }))
    markBusy(ids, false)
  }
  async function onDiscardBatch(b: Batch) {
    const ids = pendingIdsOf(b, opsDrafts)
    markBusy(ids, true)
    await runBatch(ids, id => discardDraft(byId.get(id)!))
    markBusy(ids, false)
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
        {summary.line}
      </div>
      {summary.batches.length > 0 && (
        <div className="a-focus-batches">
          {summary.batches.map(b => (
            <div key={b.key} className="a-focus-batch">
              <div className="a-focus-batch-row">
                <button type="button" className="a-focus-batch-label" onClick={() => toggleExpanded(b.key)}>
                  {b.label}
                </button>
                <span className="a-focus-batch-actions">
                  <Button
                    variant="primary" size="sm"
                    busy={pendingIdsOf(b, opsDrafts).some(id => busyIds.has(id))}
                    onClick={() => onApproveBatch(b)}
                  >✓</Button>
                  <Button
                    variant="quiet" size="sm"
                    busy={pendingIdsOf(b, opsDrafts).some(id => busyIds.has(id))}
                    onClick={() => onDiscardBatch(b)}
                  >✗</Button>
                </span>
              </div>
              {batchNote[b.key] && <div className="a-focus-batch-note">{batchNote[b.key]}</div>}
              {expanded.has(b.key) && (
                <div className="a-focus-batch-expand">
                  {b.ids.map(id => {
                    const d = byId.get(id)
                    if (!d) return null
                    return (
                      <div key={id} className="a-focus-single">
                        <span className="a-focus-single-body">{d.body}</span>
                        <span className="a-focus-batch-actions">
                          <Button variant="primary" size="sm" busy={busyIds.has(id)} onClick={() => onApproveOne(d)}>✓</Button>
                          <Button variant="quiet" size="sm" busy={busyIds.has(id)} onClick={() => onDiscardOne(d)}>✗</Button>
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
