import type { ReactNode } from 'react'
import { Icon } from './icons'
import { cx } from './util'

export interface StatTileProps {
  label: ReactNode
  /** The measured number. Leave undefined for "not measured" — never draw a 0. */
  value?: ReactNode
  /** What the number counts. A number with an unstated predicate is a guess. */
  note?: ReactNode
  delta?: { dir: 'up' | 'down' | 'flat'; text: ReactNode }
  /** Bars 0 to 1; the last one is drawn as the current period. */
  spark?: number[]
  tone?: 'default' | 'quiet'
  /** Copy shown when there is no reading. */
  emptyText?: ReactNode
  className?: string
}

export function StatTile({
  label, value, note, delta, spark, tone = 'default', emptyText = 'No reading', className,
}: StatTileProps) {
  const empty = value === undefined || value === null
  return (
    <div data-ds="StatTile" data-tone={tone} data-empty={empty} className={cx('ds-tile', className)}>
      <span className="ds-t-eyebrow">{label}</span>
      <span className="ds-tile-value">
        <span className="ds-t-figure">{empty ? emptyText : value}</span>
        {delta ? (
          <span className="ds-tile-delta ds-t-meta" data-dir={delta.dir}>
            <Icon name={delta.dir === 'down' ? 'deltaDown' : delta.dir === 'up' ? 'deltaUp' : 'minus'} size={16} />
            {delta.text}
          </span>
        ) : null}
      </span>
      {spark && spark.length > 0 ? (
        <span className="ds-tile-spark" aria-hidden="true">
          {spark.map((v, i) => (
            <span
              key={i}
              data-current={i === spark.length - 1 || undefined}
              style={{ height: `${Math.max(6, Math.round(v * 28))}px` }}
            />
          ))}
        </span>
      ) : null}
      {note ? <span className="ds-t-meta">{note}</span> : null}
    </div>
  )
}
