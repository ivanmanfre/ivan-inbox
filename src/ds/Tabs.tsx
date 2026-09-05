import { motion } from 'motion/react'
import type { ReactNode } from 'react'
import { Badge } from './Badge'
import { cx } from './util'

export interface TabsOption {
  id: string
  label: ReactNode
  count?: number
  /** A live problem in this tab. Never a plain backlog. */
  sev?: 'attention' | 'urgent'
}

export interface TabsProps {
  options: TabsOption[]
  value: string
  onChange: (id: string) => void
  label: string
  markerId?: string
  className?: string
}

/** Stage tabs with counts. The underline slides; nothing else moves. */
export function Tabs({ options, value, onChange, label, markerId = 'ds-tabs', className }: TabsProps) {
  return (
    <div data-ds="Tabs" role="tablist" aria-label={label} className={cx('ds-tabs', className)}>
      {options.map((o) => {
        const on = o.id === value
        return (
          <button
            key={o.id}
            type="button"
            role="tab"
            aria-selected={on}
            data-active={on}
            className="ds-tabs-item"
            onClick={() => onChange(o.id)}
          >
            <span>{o.label}</span>
            {typeof o.count === 'number' ? (
              <Badge tone={o.sev ?? 'neutral'} variant={o.sev ? 'count' : 'ring'}>{o.count}</Badge>
            ) : null}
            {on ? <motion.span layoutId={markerId} className="ds-tabs-underline" /> : null}
          </button>
        )
      })}
    </div>
  )
}
