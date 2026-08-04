import { useRef } from 'react'
import { PullIndicator } from '../../components/PullIndicator'
import { usePullToRefresh } from '../../hooks/usePullToRefresh'
import { useContent, useStyleRoster } from '../../hooks/useContent'
import { CONTENT_LANES, LANE_LABEL, type ContentLane } from '../../lib/content'
import { StyleRoster } from './ContentSections'

// Styles as ITS OWN JOB (Ivan, 2026-08-04: "STYLES SHOULD BE A TAB"). Same
// move Magnets made on 08-03, same reason: it used to be a collapsed pill at
// the very bottom of the Content scroll. The lane model is Content's own —
// the shared `lane` state from Shell — because the usage previews are computed
// from the lane's published rows and read differently per lane.
export function StylesList({ lane, setLane }: {
  lane: ContentLane
  setLane: (l: ContentLane) => void
}) {
  const roster = useStyleRoster()
  const { drafts } = useContent(lane)
  const rowsRef = useRef<HTMLDivElement>(null)
  const ptr = usePullToRefresh(rowsRef, () => roster.refresh())

  return (
    <>
      <div className="nav wb-head">
        <div className="row-top">
          <h2>Styles</h2>
        </div>
        <div className="chips">
          {CONTENT_LANES.map(k => (
            <button type="button" key={k} className={`chip ${lane === k ? 'on' : ''}`} onClick={() => setLane(k)}>
              {LANE_LABEL[k]}
            </button>
          ))}
        </div>
      </div>
      <div className="rows ct-rows" ref={rowsRef}>
        <PullIndicator pull={ptr.pull} refreshing={ptr.refreshing} trigger={ptr.trigger} />
        <StyleRoster
          roster={roster.rows} laneRows={drafts} lane={lane}
          loading={roster.loading} error={roster.error} refresh={roster.refresh}
          bare
        />
        <div style={{ height: 24 }} />
      </div>
    </>
  )
}
