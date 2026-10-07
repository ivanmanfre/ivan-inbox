import { useState } from 'react'
import { batchResultLine, isStillPending, runBatch } from '../../lib/focus'
import { outboundApproveUrl, seatLabel, type GateOutcome, type OpsDraft } from '../../lib/ops'
import { discardConfirm, dispatchApprove, dispatchDiscard, gateConfirm, inviteConfirm } from '../../wb/ops/batchActs'
import { useDConfirm } from '../ui/confirm'
import { Working } from '../../ds/Working'
import { Btn } from '../ui/Key'
import { seatBatches, type SeatBatch } from './model'

// THE QUICK BATCH at the top of a lane: two or more cards of one batchable
// kind (Ivan-lane comments through the gate, hand-sent invites). Today's
// FocusBlock, move for move:
//  - only cards STILL pending (pendingIdsOf): a gate-held comment is already
//    approved and parked, so "Discard all" must never cancel it at the poster;
//  - ids resolved here hide at once (doneIds), so a second tap cannot re-fire;
//  - the label opens the list, each body with its own Approve / Discard and its
//    own gate note (a `timing` refusal is a queue position, not an error).
// Writes are the card's own (wb/ops/batchActs.ts).

type Note = { message: string; outcome: GateOutcome | 'error' }
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function Batch({ lane, cards, refresh, look = 'v3', onActed, onHighlight }: { lane: string; cards: OpsDraft[]; refresh: () => void; look?: 'v3' | 'v4'; onActed?: (id: string, verb: string) => void; onHighlight?: (ids: string[]) => void }) {
  const confirm = useDConfirm()
  const [done, setDone] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<Set<string>>(new Set())
  const [open, setOpen] = useState<string | null>(null)
  const [note, setNote] = useState<Record<string, string>>({})
  const [one, setOne] = useState<Record<string, Note>>({})
  const [running, setRunning] = useState<{ ids: string[]; verb: 'approve' | 'discard'; batch: SeatBatch } | null>(null)
  const current = seatBatches(lane, cards.filter(d => !done.has(d.id) && isStillPending(d)))
  const batches = running ? [running.batch, ...current.filter(b => b.key !== running.batch.key)] : current
  // A batch that just emptied itself still says what happened (the result line outlives the row).
  const gone = Object.keys(note).filter(k => !batches.some(b => b.key === k))
  if (batches.length === 0 && gone.length === 0) return null

  const mark = (ids: string[], on: boolean) => setBusy(s => {
    const n = new Set(s); for (const id of ids) { if (on) n.add(id); else n.delete(id) } return n
  })
  const markDone = (id: string) => setDone(s => (s.has(id) ? s : new Set(s).add(id)))
  const clearOne = (id: string) => setOne(s => { if (!(id in s)) return s; const { [id]: _drop, ...rest } = s; return rest })
  const approveAsk = (b: SeatBatch, n: number) => b.kind === 'comment_outbound' ? gateConfirm(seatLabel(b.lane), n) : inviteConfirm(n)

  async function approveOne(d: OpsDraft) {
    if (busy.has(d.id) || done.has(d.id)) return
    // Today: the gate asks first; a hand-sent invite is tap-through, same as its card.
    if (d.kind === 'comment_outbound' && outboundApproveUrl(d) !== null && !(await confirm(gateConfirm(seatLabel(d.client_id))))) return
    mark([d.id], true); clearOne(d.id)
    try {
      onActed?.(d.id, 'Approved')
      const r = await dispatchApprove(d)
      if (r.ok) { markDone(d.id); refresh() } else setOne(s => ({ ...s, [d.id]: { message: r.message, outcome: r.outcome } }))
    } catch (e) { setOne(s => ({ ...s, [d.id]: { message: errText(e), outcome: 'error' } })) }
    finally { mark([d.id], false) }
  }

  async function discardOne(d: OpsDraft) {
    if (busy.has(d.id) || done.has(d.id)) return
    if (!(await confirm(discardConfirm(1)))) return
    mark([d.id], true)
    try { onActed?.(d.id, 'Discarded'); await dispatchDiscard(d); markDone(d.id); refresh() }
    catch (e) { setOne(s => ({ ...s, [d.id]: { message: errText(e), outcome: 'error' } })) }
    finally { mark([d.id], false) }
  }

  async function run(b: SeatBatch, verb: 'approve' | 'discard') {
    const list = b.cards.filter(d => !done.has(d.id) && !busy.has(d.id) && isStillPending(d))
    const n = list.length
    if (n === 0) return
    const ask = verb === 'discard' ? discardConfirm(n) : approveAsk(b, n)
    if (!(await confirm(ask))) return
    const byId = new Map(list.map(d => [d.id, d]))
    const ids = list.map(d => d.id)
    if (look === 'v4') setRunning({ ids, verb, batch: b })
    mark(ids, true)
    const r = await runBatch(ids, async id => {
      const d = byId.get(id)!
      onActed?.(id, verb === 'discard' ? 'Discarded' : 'Approved')
      if (verb === 'discard') { await dispatchDiscard(d); markDone(id); return }
      const res = await dispatchApprove(d)
      if (res.ok) { markDone(id); return }
      setOne(s => ({ ...s, [id]: { message: res.message, outcome: res.outcome } }))
      throw new Error(res.message)
    })
    if (look === 'v4') setRunning(null)
    mark(ids, false)
    setNote(s => ({ ...s, [b.key]: batchResultLine(r, n, verb === 'approve' ? 'approved' : 'discarded').replace(/: open$/, ', open the list') }))
    if (r.succeeded.length > 0) refresh()
  }

  return (
    <>
      {gone.map(k => <div className="op-note" key={k} data-batch-result>{note[k]}</div>)}
      {batches.map(b => {
        const isOpen = open === b.key
        const any = b.cards.some(d => busy.has(d.id))
        return (
          <div className={`op-qb${look === 'v4' ? ' op4-batch' : ''}`} key={b.key} data-batch={b.key}
            onMouseEnter={() => onHighlight?.(b.cards.map(d => d.id))} onMouseLeave={() => onHighlight?.([])}
            onFocus={() => onHighlight?.(b.cards.map(d => d.id))} onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) onHighlight?.([]) }}>
            <button type="button" className="op-qbl" aria-expanded={isOpen} data-verb="batch-open" onClick={() => setOpen(isOpen ? null : b.key)}>
              <small>{look === 'v4' && any && running ? <Working>{running.verb === 'approve' ? 'Approving' : 'Discarding'} {Math.min(running.ids.filter(id => done.has(id)).length + 1, running.ids.length)} of {running.ids.length}…</Working> : <>{look === 'v3' ? 'Quick batch · ' : ''}{b.label} {isOpen ? '▾' : '▸'}</>}</small>
            </button>
            <div className="op-qbk">
              <Btn verb="batch-discard" disabled={any} onClick={() => void run(b, 'discard')}>Discard all</Btn>
              <Btn primary={look === 'v3'} verb="batch-approve" disabled={any} onClick={() => void run(b, 'approve')}>
                {any ? 'Working…' : b.kind === 'manual_invite' ? 'Mark all handled' : 'Approve all'}
              </Btn>
            </div>
            {note[b.key] && <div className="op-note">{note[b.key]}</div>}
            {isOpen && b.cards.filter(d => !done.has(d.id)).map(d => (
              <div className="op-qbi" key={d.id} data-batch-item={d.id}>
                <div className="op-qbi-r">
                  <span>{d.body}</span>
                  <span className="op-qbi-k">
                    <Btn verb="batch-item-discard" disabled={busy.has(d.id)} onClick={() => void discardOne(d)}>Discard</Btn>
                    <Btn primary={look === 'v3'} verb="batch-item-approve" disabled={busy.has(d.id)} onClick={() => void approveOne(d)}>
                      {b.kind === 'comment_outbound' ? 'Approve' : 'Handled'}
                    </Btn>
                  </span>
                </div>
                {one[d.id] && <div data-batch-note={look === 'v4' || undefined} className={one[d.id].outcome === 'timing' ? 'op-note' : 'op-err'}>{one[d.id].outcome === 'timing' ? `Waiting for the send window: ${one[d.id].message}` : one[d.id].message}</div>}
              </div>
            ))}
          </div>
        )
      })}
    </>
  )
}
