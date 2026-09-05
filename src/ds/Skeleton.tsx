import { cx } from './util'

export interface SkeletonProps {
  shape?: 'line' | 'title' | 'block' | 'circle'
  width?: string
  className?: string
}

/** The one continuous motion in the system: a shimmer sweep. Nothing else loops. */
export function Skeleton({ shape = 'line', width, className }: SkeletonProps) {
  return (
    <span
      data-ds="Skeleton"
      data-shape={shape}
      aria-hidden="true"
      style={width ? { width } : undefined}
      className={cx('ds-skel', className)}
    />
  )
}

/** Three ghost rows: what a list looks like while it is still loading. */
export function SkeletonRows({ rows = 3, label = 'Loading' }: { rows?: number; label?: string }) {
  return (
    <div data-ds="SkeletonRows" className="ds-skel-rows" role="status" aria-label={label} aria-busy="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="ds-skel-row">
          <Skeleton shape="circle" />
          <Skeleton shape="line" />
          <Skeleton shape="line" width="20%" />
        </div>
      ))}
    </div>
  )
}
