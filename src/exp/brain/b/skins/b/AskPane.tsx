import { useState } from 'react'
import { SKIN } from '../../skin'
import type { BrainAskPaneProps } from '../../../types'
import { AskThread } from './AskThread'
import { Feed } from './Feed'
import { useFeedData } from '../../useFeedData'
import { wbHash } from '../../../../v2c/route'
import type { Job } from '../../../../v2c/layout'

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
  // The turn a feed card names, so the docked pane lands on the same answer the
  // phone would (a `claude_turn` row's url carries `&turn=`).
  const [focusTurn, setFocusTurn] = useState<string | null>(null)

  return (
    <div className={`brain-b bb-desktop bbf-desktop skin-${SKIN}`}>
      <div className="bb-head bbf-head wb-pane-h">
        {mobile && <button type="button" className="back wb-back" onClick={onClose} aria-label="Back">‹</button>}
        <span className="bb-head-t">Ask</span>
        <span className="bb-head-sp" />
        <button
          type="button" className="bb-feedbtn" data-tap aria-label={`Feed, ${feed.unreadTotal} unread`}
          onClick={() => setFeedOpen(v => !v)}
        >
          ◈
          {feed.unreadTotal > 0 && <span className="bb-badge">{feed.unreadTotal > 99 ? '99+' : feed.unreadTotal}</span>}
        </button>
        {!mobile && (
          <button
            type="button" className="wb-pane-x bbf-pane-x" data-tap
            aria-label="Close the Ask pane" onClick={onClose}
          >✕</button>
        )}
      </div>

      <AskThread
        chat={chat} job={job} about={about} mobile={mobile}
        focusTurn={focusTurn} onFocused={() => setFocusTurn(null)}
      />

      {feedOpen && (
        <div className="bb-feedoverlay bbf-feedoverlay">
          <div className="bb-head bbf-head">
            <span className="bb-head-t">Feed</span>
            <span className="bb-head-s">{feed.unreadTotal} unread</span>
            <span className="bb-head-sp" />
            <button type="button" className="bb-feedbtn bbf-feedclose" data-tap aria-label="Close feed" onClick={() => setFeedOpen(false)}>✕</button>
          </div>
          <Feed
            feed={feed}
            goJob={navigateToJob}
            openThread={(id, turn) => { chat.openThread(id); setFocusTurn(turn ?? null); setFeedOpen(false) }}
            onNavigated={() => setFeedOpen(false)}
          />
        </div>
      )}
    </div>
  )
}
