// The spinner/arrow that rides down as you pull-to-refresh. Sits at the top of
// a scroll container; the parent translates its content down by `pull` px.

export function PullIndicator({ pull, refreshing, trigger }: {
  pull: number; refreshing: boolean; trigger: number
}) {
  if (pull <= 0 && !refreshing) return null
  const ready = pull >= trigger
  return (
    <div className="ptr" style={{ height: pull }}>
      <div
        className={`ptr-spin ${refreshing ? 'spinning' : ''}`}
        style={{
          opacity: refreshing ? 1 : Math.min(1, pull / trigger),
          transform: refreshing ? undefined : `rotate(${pull * 3}deg)`,
        }}
      >
        {refreshing ? '↻' : ready ? '↑' : '↓'}
      </div>
    </div>
  )
}
