import type { InputHTMLAttributes, ReactNode } from 'react'
import { useId } from 'react'
import { Icon, type IconName } from './icons'
import { cx } from './util'

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'ref' | 'size'> {
  label?: ReactNode
  /** Visually hide the label but keep it for a screen reader. */
  labelHidden?: boolean
  icon?: IconName
  /** A trailing control: a clear mark, a unit, a key hint. */
  tail?: ReactNode
  hint?: ReactNode
  /** Names what is wrong. An invalid field with no reason is a dead end. */
  error?: ReactNode
  mono?: boolean
}

export function Input({
  label, labelHidden = false, icon, tail, hint, error, mono = false,
  className, id, disabled, ...rest
}: InputProps) {
  const auto = useId()
  const inputId = id ?? auto
  return (
    <div data-ds="Input" className={cx('ds-field', className)}>
      {label ? (
        <label htmlFor={inputId} className={cx('ds-t-meta', labelHidden && 'ds-sr')}>{label}</label>
      ) : null}
      <div className="ds-input-wrap" data-invalid={Boolean(error)} data-disabled={Boolean(disabled)}>
        {icon ? <Icon name={icon} size={16} /> : null}
        <input
          id={inputId}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={error || hint ? `${inputId}-note` : undefined}
          className={cx('ds-input', mono && 'ds-t-mono')}
          {...rest}
        />
        {tail}
      </div>
      {error ? (
        <span id={`${inputId}-note`} className="ds-t-meta" style={{ color: 'var(--ds-sev-urgent)' }}>{error}</span>
      ) : hint ? (
        <span id={`${inputId}-note`} className="ds-t-meta">{hint}</span>
      ) : null}
    </div>
  )
}
