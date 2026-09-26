/* ==========================================================================
   src/wb/ops/QuickBatch.tsx - the quick batch, at the top of Ops.

   Moved from Today (blueprint v3: "The quick batch from Today moves to the
   top, and its missing confirms get added"). A batch is two or more cards of
   one kind in one lane that approve the same way (lanes.ts `quickBatches`).
   Every verb asks first: approve names the gate or says nothing is sent,
   discard names what goes. Writes are the card's own (batchActs.ts). The row
   is closed on open like every section here; tapping its label lists the
   cards, each with its own Approve and Discard.
   ========================================================================== */
import { useState } from 'react'
import { Button, Icon } from '../../ds'
import { useConfirm } from '../chrome/ConfirmSheet'
import { isBatchable } from '../../lib/focus'
import { seatLabel, type OpsDraft } from '../../lib/ops'
import { discardConfirm, dispatchApprove, dispatchDiscard, gateConfirm, inviteConfirm } from './batchActs'
import { quickBatches, type QuickBatch as Batch } from './lanes'

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function QuickBatch({ cards, refresh }: { cards: OpsDraft[]; refresh: () => void }) {
  const confirm = useConfirm()
  // Ids already resolved here, hidden until the next read catches up, so a
  // second tap can never fire the same write twice.
  const [done, setDone] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<Set<string>>(new Set())
  const [open, setOpen] = useState<string | null>(null)
  const [notes, setNotes] = useState<Record<string, string>>({})
  const batches = quickBatches(cards.filter(d => !done.has(d.id)), isBatchable)
  if (batches.length === 0) return null

  const mark = (ids: string[], on: boolean) => setBusy(s => {
    const n = new Set(s); for (const id of ids) { if (on) n.add(id); else n.delete(id) } return n
  })
  const approveAsk = (b: Batch, n: number) => b.kind === 'comment_outbound'
    ? gateConfirm(seatLabel(b.client), n) : inviteConfirm(n)

  async function run(b: Batch, list: OpsDraft[], verb: 'approve' | 'discard') {
    const n = list.length
    if (!(await confirm(verb === 'approve' ? approveAsk(b, n) : discardConfirm(n)))) return
    const ids = list.map(d => d.id)
    mark(ids, true)
    let ok = 0
    const failed: string[] = []
    for (const d of list) {
      try {
        if (verb === 'discard') await dispatchDiscard(d)
        else {
          const r = await dispatchApprove(d)
          if (!r.ok) { failed.push(r.message); continue }
        }
        ok++
        setDone(s => new Set(s).add(d.id))
      } catch (e) { failed.push(errText(e)) }
    }
    mark(ids, false)
    const past = verb === 'approve' ? 'approved' : 'discarded'
    setNotes(s => ({
      ...s,
      [b.key]: failed.length === 0 ? `${ok} ${past}.` : `${ok} of ${n} ${past}. ${failed[0]}`,
    }))
    if (ok > 0) refresh()
  }

  return (
    <section className="a-ops-qb" aria-label="Quick batch">
      {batches.map(b => {
        const isOpen = open === b.key
        const any = b.cards.some(d => busy.has(d.id))
        return (
          <div key={b.key} className="a-ops-qb-batch" data-open={isOpen ? '' : undefined}>
            <div className="a-ops-qb-row">
              <button
                type="button" className="a-ops-qb-label wb-ops-qb"
                aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : b.key)}
              >
                <Icon name={isOpen ? 'disclose' : 'forward'} size={16} />
                <span>{b.label}</span>
              </button>
              <span className="a-ops-qb-acts">
                <Button variant="quiet" size="sm" busy={any} onClick={() => run(b, b.cards, 'discard')}>Discard all</Button>
                <Button variant="outline" size="sm" busy={any} onClick={() => run(b, b.cards, 'approve')}>
                  {b.kind === 'comment_outbound' ? 'Approve all' : 'Mark all handled'}
                </Button>
              </span>
            </div>
            {notes[b.key] && <div className="a-ops-qb-note a-meta">{notes[b.key]}</div>}
            {isOpen && b.cards.map(d => (
              <div key={d.id} className="a-ops-qb-one">
                <span className="a-ops-qb-body">{d.body}</span>
                <span className="a-ops-qb-acts">
                  <Button variant="quiet" size="sm" busy={busy.has(d.id)} onClick={() => run(b, [d], 'discard')}>Discard</Button>
                  <Button variant="outline" size="sm" busy={busy.has(d.id)} onClick={() => run(b, [d], 'approve')}>
                    {b.kind === 'comment_outbound' ? 'Approve' : 'Handled'}
                  </Button>
                </span>
              </div>
            ))}
          </div>
        )
      })}
    </section>
  )
}
