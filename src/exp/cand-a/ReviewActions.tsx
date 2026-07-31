import { useState } from 'react'
import { useConfirm } from '../../components/ConfirmSheet'
import { approveDraft, skipDraft } from '../../lib/content'

// The ONLY mutating affordance in the Content tab, now rendered from two places
// (the queue card and the draft detail screen) — so it lives in one component
// with one copy of the confirm wording. D6/D7: approve is a status write that
// does NOT publish, skip persists as 'disqualified', and the Rise lane never
// shows either (client-facing decisions stay on the client board behind its own
// gates). No schedule/publish affordance exists here on purpose. The "may this
// row be actioned at all" rule itself lives in lib/content.ts (reviewActionable)
// where it is unit-tested.
export function ReviewActions({ id, onDone, compact }: {
  id: string
  onDone: () => void
  // The detail screen's copy of these buttons sits at the end of a long scroll
  // and gets the roomier register; the card's stays tight.
  compact?: boolean
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const confirm = useConfirm()

  async function run(kind: 'approve' | 'skip') {
    const ok = await confirm(kind === 'approve' ? {
      title: 'Approve this draft?',
      message: 'Marks approved. Nothing publishes — scheduling stays on the board.',
      confirmText: 'Approve',
    } : {
      title: 'Skip this draft?',
      message: 'Marks it disqualified — it drops out of the queue for good.',
      confirmText: 'Skip',
      danger: true,
    })
    if (!ok) return
    setBusy(true); setError('')
    try {
      await (kind === 'approve' ? approveDraft(id) : skipDraft(id))
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : `Could not ${kind}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {error && <div className="ops-err" style={{ marginTop: 8 }}>{error}</div>}
      {/* A tap on a queue card opens the detail screen; the buttons must not
          also fire that. */}
      <div className={`ct-ac${compact ? '' : ' ct-ac-wide'}`} onClick={e => e.stopPropagation()}>
        <div className="btn s" onClick={busy ? undefined : () => run('skip')}>Skip</div>
        <div className="btn p" onClick={busy ? undefined : () => run('approve')}>
          {busy ? 'Working…' : 'Approve'}
        </div>
      </div>
    </>
  )
}
