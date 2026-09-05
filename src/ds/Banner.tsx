import type { ReactNode } from 'react'
import { Icon, type IconName } from './icons'
import { IconButton } from './IconButton'
import { cx } from './util'

export interface BannerProps {
  /** Severity tones are live signals only. */
  tone?: 'neutral' | 'accent' | 'clear' | 'attention' | 'urgent'
  icon?: IconName
  title?: ReactNode
  children?: ReactNode
  /** A retry, a link, one action. */
  action?: ReactNode
  onDismiss?: () => void
  className?: string
}

/** An in-flow strip: a seat alarm, a queue note, a failed read with its retry. */
export function Banner({ tone = 'neutral', icon, title, children, action, onDismiss, className }: BannerProps) {
  return (
    <div data-ds="Banner" data-tone={tone} role={tone === 'urgent' ? 'alert' : 'status'} className={cx('ds-banner', className)}>
      {icon ? <Icon name={icon} size={20} /> : null}
      <div className="ds-banner-main">
        {title ? <span className="ds-t-title">{title}</span> : null}
        {children ? <span className="ds-t-body ds-dim">{children}</span> : null}
      </div>
      {action || onDismiss ? (
        <div className="ds-banner-tail">
          {action}
          {onDismiss ? <IconButton icon="close" label="Dismiss" size="sm" onClick={onDismiss} /> : null}
        </div>
      ) : null}
    </div>
  )
}
