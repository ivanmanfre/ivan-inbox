import { motion } from 'motion/react'
import { spring } from './motion'
import { cx } from './util'

export interface SwitchProps {
  checked: boolean
  onChange: (next: boolean) => void
  /** REQUIRED. A switch with no name is a switch nobody can operate blind. */
  label: string
  disabled?: boolean
  /** A write is in flight: the knob holds, input is blocked. */
  busy?: boolean
  className?: string
}

export function Switch({ checked, onChange, label, disabled = false, busy = false, className }: SwitchProps) {
  return (
    <button
      data-ds="Switch"
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-busy={busy || undefined}
      data-on={checked}
      data-busy={busy}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx('ds-switch', className)}
    >
      <motion.span className="ds-switch-knob" animate={{ x: checked ? 18 : 0 }} transition={spring} />
    </button>
  )
}
