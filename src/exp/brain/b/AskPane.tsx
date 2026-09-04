import { useState } from 'react'
import type { BrainAskPaneProps } from '../types'
import { AskThread } from './AskThread'
import { Feed } from './Feed'
import { useFeedData } from './useFeedData'
import { wbHash } from '../../v2c/route'
import type { Job } from '../../v2c/layout'

// The docked desktop pane. Brief item 7: "the point is parity of the thread,
// not a new desktop design" — so this is AskThread again, the same brain
// visibility and the same turn states as the phone, inside ChatPane's own
// docking chrome (wb-pane-h header, same close affordance).
//
// AskPane's props (BrainAskPaneProps) carry no `goJob` — Shell hands the
// working surface to AskPane's job, not a setter for it. A deep-linked feed
// card therefore navigates the same way a fresh page load would: writing the
// job onto the hash. Shell already listens for `hashchange` at runtime
// (Shell.tsx's own effect, wired for exactly this — a notification's link
// opening the app on a fresh load), so this is not a new code path, only the
// same one entered from inside the running app instead of from a click on a
// URL.
function navigateToJob(job: Job): void {
  location.hash = wbHash(job, null)
}

export function AskPane({ chat, job, about, onClose, mobile }: BrainAskPaneProps) {
  const feed = useFeedData()
  const [feedOpen, setFeedOpen] = useState(false)

  return (
    <div className="brain-b bb-desktop">
      <div className="bb-head wb-pane-h">
        {mobile && <button type="button" className="back wb-back" onClick={onClose} aria-label="Back">‹</button>}
        <span className="bb-head-t">Ask</span>
        <span className="bb-head-sp" />
        <button
          type="button" className="bb-feedbtn" aria-label={`Feed, ${feed.unreadTotal} unread`}
          onClick={() => setFeedOpen(v => !v)}
        >
          ◈
          {feed.unreadTotal > 0 && <span className="bb-badge">{feed.unreadTotal > 99 ? '99+' : feed.unreadTotal}</span>}
        </button>
        {!mobile && <span className="wb-pane-x" onClick={onClose}>✕</span>}
      </div>

      <AskThread chat={chat} job={job} about={about} mobile={mobile} />

      {feedOpen && (
        <div className="bb-feedoverlay">
          <div className="bb-head">
            <span className="bb-head-t">Feed</span>
            <span className="bb-head-s">{feed.unreadTotal} unread</span>
            <span className="bb-head-sp" />
            <button type="button" className="bb-feedbtn" aria-label="Close feed" onClick={() => setFeedOpen(false)}>✕</button>
          </div>
          <Feed
            feed={feed}
            goJob={navigateToJob}
            openThread={id => { chat.openThread(id); setFeedOpen(false) }}
            onNavigated={() => setFeedOpen(false)}
          />
        </div>
      )}
    </div>
  )
}
