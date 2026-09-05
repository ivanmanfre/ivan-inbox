import type { ButtonHTMLAttributes } from 'react'
import { Icon, type IconName, type IconSize } from './icons'
import { cx } from './util'

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'ref' | 'aria-label'> {
  icon: IconName
  /** REQUIRED. An icon-only control without a name is a control no one can read. */
  label: string
  variant?: 'ghost' | 'solid' | 'accent' | 'danger'
  size?: 'sm' | 'md'
  iconSize?: IconSize
  active?: boolean
  round?: boolean
}

export function IconButton({
  icon, label, variant = 'ghost', size = 'md', iconSize, active = false, round = false,
  className, ...rest
}: IconButtonProps) {
  return (
    <button
      data-ds="IconButton"
      type="button"
      data-variant={variant}
      data-size={size}
      data-active={active}
      data-round={round}
      aria-label={label}
      title={label}
      aria-pressed={active || undefined}
      className={cx('ds-ibtn', className)}
      {...rest}
    >
      <Icon name={icon} size={iconSize ?? (size === 'sm' ? 16 : 20)} />
    </button>
  )
}
