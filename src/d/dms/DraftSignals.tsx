// Read-only test signals under a pending reply draft (2026-10-19): the 45-day history of drafts like
// this one, and the decline shadow's read (draft_evidence.decline_shadow, log only). No buttons that
// change anything. All hooks sit above the only return (09-09 rule).
import { useEffect, useState } from 'react'
import type { InboxMessage, Thread } from '../../lib/inbox'
import { declineLine, fetchReplyHistory, historyLine, type DeclineShadow, type ReplyHistory } from '../../lib/replyHistory'
import { seatOf } from '../seats'

export function DraftSignals({ t, draft }: { t: Thread; draft: InboxMessage }) {
  const seat = seatOf(t.client_id)
  const on = seat === 'risedtc' || seat === 'arch' || seat === 'ivan'
  const [hist, setHist] = useState<{ id: string; h: ReplyHistory | null } | null>(null)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!on) return
    let live = true
    fetchReplyHistory(draft.id).then(h => { if (live) setHist({ id: draft.id, h }) }, () => { if (live) setHist({ id: draft.id, h: null }) })
    return () => { live = false }
  }, [on, draft.id])
  const shadow = (draft.draft_evidence as { decline_shadow?: DeclineShadow } | null | undefined)?.decline_shadow
  const decline = on && shadow ? declineLine(shadow) : null
  const h = hist?.id === draft.id ? hist.h : null
  if (!on || (!h && !decline)) return null
  const extra = shadow && (shadow.proposed_text || shadow.reason)
  const like = h ? `Like this = same drafter (${h.model}), their reply read as ${h.intent ?? 'unlabelled'}${h.move ? `, move ${h.move}` : ''}` : undefined
  return (
    <div className="dm-src dm-test" data-draft-signals={draft.id}>
      <div className="dm-src-g">
        <small>Test signals · read only</small>
        {h && <div className="dm-test-r" title={like}><b>History:</b> {historyLine(h)}</div>}
        {decline && <div className="dm-test-r"><b>Decline read (test):</b> {decline}</div>}
        {decline && extra && <>
          <button type="button" className="dm-test-t" aria-expanded={open} onClick={() => setOpen(o => !o)}>{open ? 'Hide' : shadow.proposed_text ? 'Show what it would send' : 'Show why'}</button>
          {open && <>
            {shadow.proposed_text && <p className="dm-test-q">{shadow.proposed_text}</p>}
            {shadow.reason && <p className="dm-test-w">Why: {shadow.reason}</p>}
          </>}
        </>}
      </div>
    </div>
  )
}
