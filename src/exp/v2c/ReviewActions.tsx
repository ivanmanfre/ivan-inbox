import { useRef, useState } from 'react'
import { useConfirm } from '../../components/ConfirmSheet'
import { approveDraft, skipDraft } from '../../lib/content'

// §10.5 — the app's ONE choreographed beat. The row lifts and fades over
// --dur-beat, the refetch fires when the movement ENDS (the list never jumps
// under a hand), and the section count above ticks as it lands on its new
// value. The keyframes have lived in faithful.css since the tournament; this
// run wires them (phase0-errors-hover found them as dead code). Under
// prefers-reduced-motion the animation is disabled by CSS, so the delay is
// skipped and the refetch is immediate.
const BEAT_MS = 200

function reducedMotion(): boolean {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches } catch { return false }
}

function playBeat(from: HTMLElement | null, then: () => void): void {
  const card = from?.closest('.ct-card') as HTMLElement | null
  if (!card || reducedMotion()) { then(); return }
  card.classList.add('wb-approving')
  const count = card.closest('section, div')?.querySelector('.wb-sech-c')
  window.setTimeout(() => {
    count?.classList.add('wb-ticked')
    window.setTimeout(() => count?.classList.remove('wb-ticked'), BEAT_MS + 50)
    then()
  }, BEAT_MS)
}

// The ONLY mutating affordance in the Content tab, now rendered from two places
// (the queue card and the draft detail screen) — so it lives in one component
// with one copy of the confirm wording. D6/D7: approve is a status write that
// does NOT publish, skip persists as 'disqualified', and Mattan’s lane never
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
  const rootRef = useRef<HTMLDivElement>(null)

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
      // The beat plays only on APPROVE — intensity in proportion to rarity;
      // a skip just leaves.
      if (kind === 'approve') playBeat(rootRef.current, onDone)
      else onDone()
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
      <div ref={rootRef} className={`ct-ac${compact ? '' : ' ct-ac-wide'}`} onClick={e => e.stopPropagation()}>
        <button type="button" className="btn s" disabled={busy} onClick={() => run('skip')}>Skip</button>
        <button type="button" className="btn p" disabled={busy} onClick={() => run('approve')}>
          {busy ? 'Working…' : 'Approve'}
        </button>
      </div>
    </>
  )
}
