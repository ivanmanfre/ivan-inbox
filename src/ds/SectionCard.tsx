import type { ReactNode } from 'react'
import { cx } from './util'

export interface SectionCardProps {
  /** The eyebrow above the group. */
  label?: ReactNode
  /** A count or a predicate beside the label. */
  tail?: ReactNode
  /** 'flush' drops the group fill: the rows sit on the canvas. */
  tone?: 'default' | 'flush'
  className?: string
  children?: ReactNode
}

/** A titled group of rows or settings. The group draws the container. */
export function SectionCard({ label, tail, tone = 'default', className, children }: SectionCardProps) {
  return (
    <section data-ds="SectionCard" data-tone={tone} className={cx('ds-section', className)}>
      {label || tail ? (
        <div className="ds-section-head">
          <div className="ds-section-head-main">
            <span className="ds-t-eyebrow">{label}</span>
          </div>
          {tail}
        </div>
      ) : null}
      <div className="ds-section-body">{children}</div>
    </section>
  )
}

export interface SettingRowProps {
  label: ReactNode
  /** What the switch actually does, in one line. */
  hint?: ReactNode
  /** The control: a Switch, a Segmented, a Button, a link. */
  control?: ReactNode
  tone?: 'default' | 'danger'
  className?: string
}

/** A settings row: label and hint on the left, one control on the right. */
export function SettingRow({ label, hint, control, tone = 'default', className }: SettingRowProps) {
  return (
    <div data-ds="SettingRow" data-tone={tone} className={cx('ds-setting', className)}>
      <div className="ds-setting-main">
        <span className="ds-t-body">{label}</span>
        {hint ? <span className="ds-t-meta">{hint}</span> : null}
      </div>
      {control ? <div className="ds-setting-tail">{control}</div> : null}
    </div>
  )
}
