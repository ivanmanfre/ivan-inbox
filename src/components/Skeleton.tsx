// Shimmer placeholders shown on first load instead of a bare "Loading…".
// Shapes echo the real row/card so the layout doesn't jump when data lands.

export function InboxSkeleton() {
  return (
    <div className="rows" aria-hidden>
      {Array.from({ length: 7 }).map((_, i) => (
        <div className="r sk-r" key={i}>
          <div className="sk sk-av" />
          <div className="mid">
            <div className="sk sk-line" style={{ width: '42%' }} />
            <div className="sk sk-line" style={{ width: '78%', marginTop: 8 }} />
          </div>
        </div>
      ))}
    </div>
  )
}

export function OpsSkeleton() {
  return (
    <div className="ops-rows" aria-hidden>
      {Array.from({ length: 3 }).map((_, i) => (
        <div className="ops-card sk-ops" key={i}>
          <div className="sk sk-line" style={{ width: '30%' }} />
          <div className="sk sk-line" style={{ width: '92%', marginTop: 12 }} />
          <div className="sk sk-line" style={{ width: '70%', marginTop: 8 }} />
        </div>
      ))}
    </div>
  )
}

export function SendsSkeleton() {
  return (
    <div className="rows sc-rows" aria-hidden>
      {Array.from({ length: 4 }).map((_, i) => (
        <div className="sc sk-sc" key={i}>
          <div className="sc-l">
            <div className="sk sk-line" style={{ width: '46%' }} />
            <div className="sk sk-line" style={{ width: '64%', marginTop: 8 }} />
            <div className="sk sk-spark" />
          </div>
          <div className="sc-r">
            <div className="sk sk-big" />
          </div>
        </div>
      ))}
    </div>
  )
}
