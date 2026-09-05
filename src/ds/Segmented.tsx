import { motion } from 'motion/react'
import type { ReactNode } from 'react'
import { Badge } from './Badge'
import { cx } from './util'

export interface SegmentedOption {
  id: string
  label: ReactNode
  count?: number
}

export interface SegmentedProps {
  options: SegmentedOption[]
  value: string
  onChange: (id: string) => void
  /** Names the whole control for a screen reader. */
  label: string
  block?: boolean
  /** Unique when two segmented controls share a screen (the marker slides per id). */
  markerId?: string
  className?: string
}

/** The solid selected pill slides between options; the track never re-renders. */
export function Segmented({
  options, value, onChange, label, block = false, markerId = 'ds-seg', className,
}: SegmentedProps) {
  return (
    <div data-ds="Segmented" role="tablist" aria-label={label} data-block={block} className={cx('ds-seg', className)}>
      {options.map((o) => {
        const on = o.id === value
        return (
          <button
            key={o.id}
            type="button"
            role="tab"
            aria-selected={on}
            data-active={on}
            className="ds-seg-item"
            onClick={() => onChange(o.id)}
          >
            {on ? <motion.span layoutId={markerId} className="ds-seg-marker" /> : null}
            <span>{o.label}</span>
            {typeof o.count === 'number' ? <Badge variant="ring">{o.count}</Badge> : null}
          </button>
        )
      })}
    </div>
  )
}
