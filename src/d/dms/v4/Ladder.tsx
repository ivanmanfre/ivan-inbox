// The stage ladder as a stepper (SPEC-dms §2.4.2): done dots solid, the current one haloed, a failed
// send in danger with its words kept, the future hollow. Only the current label is drawn; every label
// sits in the aria-label and each dot's tooltip. Off-ladder and unknown stages say so in words.
import type { Thread } from '../../../lib/inbox'
import { ladderSteps } from '../../../lib/inbox'
import { label } from '../../../lib/labels'

export function Ladder({ t }: { t: Pick<Thread, 'stage' | 'messages'> }) {
  const lad = ladderSteps(t)
  if (lad.kind !== 'steps') return <span className="dm-lad dx-lad-word">stage <b>{label(lad.stage) || 'none'}</b></span>
  const cur = lad.steps.find(s => s.state === 'current' || s.state === 'failed')
  const words = lad.steps.map(s => `${s.label}${s.state === 'current' ? ' (current)' : s.state === 'failed' ? ' (send failed)' : ''}`).join(', ')
  return (
    <span className="dm-lad dx-lad" role="img" aria-label={`Stage: ${words}`}>
      {lad.steps.map((s, i) => (
        <span key={s.id} className={`dx-step dx-step-${s.state}`} title={`${s.label}${s.state === 'failed' ? ' (send failed)' : ''}`}>
          {i > 0 && <i className="dx-link" aria-hidden="true" />}
          <i className="dx-dot" aria-hidden="true" />
        </span>
      ))}
      {cur && <b className={cur.state === 'failed' ? 'dm-failed' : undefined}>{cur.label}{cur.state === 'failed' ? ' (send failed)' : ''}</b>}
    </span>
  )
}
