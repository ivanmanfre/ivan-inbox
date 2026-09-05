import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Icon, type IconName } from './icons'
import { cx } from './util'

export type ButtonVariant = 'default' | 'primary' | 'quiet' | 'outline' | 'danger'

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'ref'> {
  /** 'primary' is the accent fill. Budget: one per screen. */
  variant?: ButtonVariant
  size?: 'sm' | 'md' | 'lg'
  /** Leading icon. */
  icon?: IconName
  /** Trailing icon. */
  iconEnd?: IconName
  /** Spins the leading icon and blocks input while a write is in flight. */
  busy?: boolean
  block?: boolean
  children?: ReactNode
}

export function Button({
  variant = 'default', size = 'md', icon, iconEnd, busy = false, block = false,
  className, children, disabled, ...rest
}: ButtonProps) {
  return (
    <button
      data-ds="Button"
      type="button"
      data-variant={variant}
      data-size={size}
      data-busy={busy}
      data-block={block}
      aria-busy={busy || undefined}
      disabled={disabled || busy}
      className={cx('ds-btn', className)}
      {...rest}
    >
      {icon ? <Icon name={busy ? 'loading' : icon} size={16} /> : busy ? <Icon name="loading" size={16} /> : null}
      {children}
      {iconEnd ? <Icon name={iconEnd} size={16} /> : null}
    </button>
  )
}
