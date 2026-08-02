import { useRef } from 'react'
import { PullIndicator } from '../../components/PullIndicator'
import { usePullToRefresh } from '../../hooks/usePullToRefresh'
import { useIdeaCandidates, useResources } from '../../hooks/useContent'
import { CONTENT_LANES, LANE_LABEL, type ContentLane } from '../../lib/content'
import { ResourceLane } from './ContentSections'

// Magnets — the lead-magnet pipeline as ITS OWN JOB (phase: usability-voice).
//
// Ivan: "lead magnets is on the same fucking window just make it another tab
// because i have to scroll down till the end otherwise." The ResourceLane used
// to render at the BOTTOM of both Content lanes' scroll — under the post
// pipeline, the ideas bank, and up to nine stage sections. It is now the whole
// working surface of the `magnets` job, one rail click (or one Work-segment
// tap) away, and the Content scroll ends at its own summary sections.
//
// The lane model is IDENTICAL to Content's — the same `lane` state object is
// passed down from Shell, so switching to Mattan here is reflected when Ivan
// flips back to Content, and vice versa. One state, two surfaces.
//
// The idea partition rule travels with the lane: lm_idea_candidates carries no
// tenancy column, so ONLY the Ivan lane has a lead-magnet idea stage —
// inventing a Mattan side would be a cross-tenant claim (see ContentList's
// original comment, preserved on the risedtc branch below).
export function MagnetsList({ lane, setLane, onOpen }: {
  lane: ContentLane
  setLane: (l: ContentLane) => void
  // Opens a lead-magnet row's detail window (the takeover register).
  onOpen?: (id: string, label: string) => void
}) {
  const resources = useResources(lane)
  // Ivan lane only: the LM side of the content_type partition. The hook is
  // enabled per lane so Mattan's view never pays the fetch for a row set it is
  // forbidden to render.
  const ideas = useIdeaCandidates(lane === 'ivan')
  const rowsRef = useRef<HTMLDivElement>(null)
  const ptr = usePullToRefresh(rowsRef, () => resources.refresh())

  return (
    <>
      <div className="nav wb-head">
        <div className="row-top">
          <h2>Lead magnets</h2>
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
        {lane === 'ivan' ? (
          <ResourceLane
            rows={resources.rows} lane="ivan"
            ideas={ideas.split.lead_magnet} ideaCount={ideas.counts.lead_magnet}
            ideaState={ideas}
            loading={resources.loading}
            error={resources.error} loadedAt={resources.loadedAt} refresh={resources.refresh}
            onOpen={onOpen}
          />
        ) : (
          <ResourceLane
            rows={resources.rows} lane="risedtc" ideas={null} ideaCount={null}
            loading={resources.loading}
            error={resources.error} loadedAt={resources.loadedAt} refresh={resources.refresh}
            onOpen={onOpen}
          />
        )}
        <div style={{ height: 24 }} />
      </div>
    </>
  )
}
