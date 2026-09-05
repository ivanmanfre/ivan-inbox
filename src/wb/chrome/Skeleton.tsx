/* ==========================================================================
   src/wb/chrome/Skeleton.tsx: S43, the three loaders, on the design system.

   Each one still echoes the shape of the rows that replace it, so nothing jumps
   when the data lands; each one is now built from the ds `Skeleton` primitive,
   so there is one shimmer in the app rather than three sheets' worth. The old
   copies stay on disk for `#exp/stock` (D2).
   ========================================================================== */
import { Skeleton as Bone } from '../../ds'
import './chrome.css'

/** S43-1: the conversation list, seven rows of avatar plus two lines. */
export function InboxSkeleton() {
  return (
    <div className="a-sk-rows" role="status" aria-label="Loading" aria-busy="true">
      {Array.from({ length: 7 }).map((_, i) => (
        <div className="a-sk-row" key={i}>
          <Bone shape="circle" />
          <div className="a-sk-lines">
            <Bone shape="line" width="42%" />
            <Bone shape="line" width="78%" />
          </div>
        </div>
      ))}
    </div>
  )
}

/** S43-2: the ops board, three cards of three lines. */
export function OpsSkeleton() {
  return (
    <div className="a-sk-cards" role="status" aria-label="Loading" aria-busy="true">
      {Array.from({ length: 3 }).map((_, i) => (
        <div className="a-sk-card" key={i}>
          <Bone shape="title" width="30%" />
          <Bone shape="line" width="92%" />
          <Bone shape="line" width="70%" />
        </div>
      ))}
    </div>
  )
}

/** S43-3: the send lanes, four cards of two lines, a run of bars and a figure. */
export function SendsSkeleton() {
  return (
    <div className="a-sk-cards" role="status" aria-label="Loading" aria-busy="true">
      {Array.from({ length: 4 }).map((_, i) => (
        <div className="a-sk-card a-sk-sends" key={i}>
          <div className="a-sk-lines">
            <Bone shape="line" width="46%" />
            <Bone shape="line" width="64%" />
            <Bone shape="block" width="100%" />
          </div>
          <Bone shape="block" width="72px" className="a-sk-figure" />
        </div>
      ))}
    </div>
  )
}
