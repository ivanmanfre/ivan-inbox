import { useState } from 'react'
import { seatLabel, type OpsDraft } from '../../lib/ops'
import { discardConfirm, dispatchApprove, dispatchDiscard, gateConfirm, inviteConfirm } from '../../wb/ops/batchActs'
import { useDConfirm } from '../ui/confirm'
import { Btn } from '../ui/Key'
import { seatBatches, type SeatBatch } from './model'
import type { Seat } from '../seats'

// THE QUICK BATCH at the top of a lane: two or more cards of one batchable
// kind (Ivan-lane comments through the gate, hand-sent invites). Every verb
// asks first and the writes are the card's own (wb/ops/batchActs.ts).

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function Batch({ seat, cards, refresh, onDone }: {
  seat: Seat; cards: OpsDraft[]; refresh: () => void; onDone?: (ids: string[]) => void
}) {
  const confirm = useDConfirm()
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<Record<string, string>>({})
  const batches = seatBatches(seat, cards)
  if (batches.length === 0) return null

  async function run(b: SeatBatch, verb: 'approve' | 'discard') {
    const n = b.cards.length
    const ask = verb === 'discard' ? discardConfirm(n) : b.kind === 'comment_outbound' ? gateConfirm(seatLabel(b.seat), n) : inviteConfirm(n)
    if (!(await confirm({ title: ask.title, message: ask.message, confirmText: ask.confirmText }))) return
    setBusy(b.key)
    let ok = 0
    const failed: string[] = []
    const gone: string[] = []
    for (const d of b.cards) {
      try {
        if (verb === 'discard') await dispatchDiscard(d)
        else {
          const r = await dispatchApprove(d)
          if (!r.ok) { failed.push(r.message); continue }
        }
        ok++; gone.push(d.id)
      } catch (e) { failed.push(errText(e)) }
    }
    setBusy(null)
    const past = verb === 'approve' ? 'approved' : 'discarded'
    setNote(s => ({ ...s, [b.key]: failed.length === 0 ? `${ok} ${past}.` : `${ok} of ${n} ${past}. ${failed[0]}` }))
    if (ok > 0) { onDone?.(gone); refresh() }
  }

  return (
    <>
      {batches.map(b => (
        <div className="op-qb" key={b.key}>
          <small>Quick batch · {b.label}</small>
          <div className="op-qbk">
            <Btn verb="batch-discard" disabled={busy !== null} onClick={() => void run(b, 'discard')}>Discard all</Btn>
            <Btn primary verb="batch-approve" disabled={busy !== null} onClick={() => void run(b, 'approve')}>
              {busy === b.key ? 'Working…' : b.kind === 'manual_invite' ? 'Mark all handled' : 'Approve all'}
            </Btn>
          </div>
          {note[b.key] && <div className="op-note">{note[b.key]}</div>}
        </div>
      ))}
    </>
  )
}
