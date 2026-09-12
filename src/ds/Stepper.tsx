import type { ReactNode } from 'react'
import { Icon } from './icons'
import { cx } from './util'

export interface Step {
  id: string
  label: ReactNode
  /** `failed` is a LIVE SIGNAL and must be proven by a field, never inferred
      from a stage that merely stopped moving. See `ladderSteps` in lib/inbox. */
  state: 'done' | 'current' | 'todo' | 'failed'
}

export interface StepperProps {
  steps: Step[]
  label: string
  className?: string
}

/* THE STAGE LADDER.

   E1 (goal run inbox-repair-floor-and-21st-moves-2026-09-12) · IT COULD NOT SAY
   A THING HAD FAILED. Three states — done, current, todo — describe a pipeline
   that only ever moves forward, so a send that was blocked at the send moment
   drew exactly like a person who simply has not replied yet. The fourth state
   is the failure, and it is spelled the way the reference spells it (nyxbui's
   timeline: done/current/error/default dots over a two-weight connector): a
   cross on an urgent fill, and the LABEL keeps its own colour, because the mark
   carries the severity and a red word beside a red dot says it twice.

   The connector is two-weight for the same reason it is in the reference — the
   trail behind the walker is solid and the road ahead is faint — but it is
   skinned from our tokens only: the accent behind a done step, the hairline
   ahead of it. Nothing proceeds from a failure, so the line after a failed step
   stays faint. */
export function Stepper({ steps, label, className }: StepperProps) {
  return (
    <ol data-ds="Stepper" aria-label={label} className={cx('ds-stepper', className)}>
      {steps.map((s, i) => (
        <li key={s.id} className="ds-step" data-state={s.state} aria-current={s.state === 'current' ? 'step' : undefined}>
          <span className="ds-step-rail">
            <span className="ds-step-mark">
              {s.state === 'done' ? <Icon name="check" size={16} />
                : s.state === 'failed' ? <Icon name="close" size={16} />
                : i + 1}
            </span>
            <span className="ds-step-line" />
          </span>
          <span className="ds-step-label ds-t-meta">{s.label}</span>
        </li>
      ))}
    </ol>
  )
}
