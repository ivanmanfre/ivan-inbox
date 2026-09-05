import type { ReactNode, TextareaHTMLAttributes } from 'react'
import { useId } from 'react'
import { cx } from './util'

export interface TextareaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'ref'> {
  label?: ReactNode
  labelHidden?: boolean
  hint?: ReactNode
  error?: ReactNode
}

export function Textarea({ label, labelHidden = false, hint, error, className, id, ...rest }: TextareaProps) {
  const auto = useId()
  const fieldId = id ?? auto
  return (
    <div data-ds="Textarea" className={cx('ds-field', className)}>
      {label ? (
        <label htmlFor={fieldId} className={cx('ds-t-meta', labelHidden && 'ds-sr')}>{label}</label>
      ) : null}
      <textarea
        id={fieldId}
        className="ds-textarea"
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? `${fieldId}-note` : undefined}
        {...rest}
      />
      {error ? (
        <span id={`${fieldId}-note`} className="ds-t-meta" style={{ color: 'var(--ds-sev-urgent)' }}>{error}</span>
      ) : hint ? (
        <span id={`${fieldId}-note`} className="ds-t-meta">{hint}</span>
      ) : null}
    </div>
  )
}
