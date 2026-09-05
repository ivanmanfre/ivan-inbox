import type { ReactNode } from 'react'
import { Icon } from './icons'
import { cx } from './util'

export interface Step {
  id: string
  label: ReactNode
  state: 'done' | 'current' | 'todo'
}

export interface StepperProps {
  steps: Step[]
  label: string
  className?: string
}

/** The stage ladder. The connector fills only behind the steps already done. */
export function Stepper({ steps, label, className }: StepperProps) {
  return (
    <ol data-ds="Stepper" aria-label={label} className={cx('ds-stepper', className)}>
      {steps.map((s, i) => (
        <li key={s.id} className="ds-step" data-state={s.state} aria-current={s.state === 'current' ? 'step' : undefined}>
          <span className="ds-step-rail">
            <span className="ds-step-mark">
              {s.state === 'done' ? <Icon name="check" size={16} /> : i + 1}
            </span>
            <span className="ds-step-line" />
          </span>
          <span className="ds-step-label ds-t-meta">{s.label}</span>
        </li>
      ))}
    </ol>
  )
}
