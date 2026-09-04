import { useState } from 'react'
import { SKIN } from '../../skin'
import type { BrainAskPaneProps } from '../../../types'
import { AskThread } from './AskThread'
import { Feed } from './Feed'
import { useFeedData } from '../../useFeedData'
import { wbHash } from '../../../../v2c/route'
import type { Job } from '../../../../v2c/layout'
import { Glyph } from './icons'

function navigateToJob(job: Job): void {
  location.hash = wbHash(job, null)
}

// Parity, not a new desktop design: the same thread, the same ledger, the same
// footer line, inside ChatPane's own docking chrome. What the wider pane buys
// is the measure — the answer column caps at 62ch instead of running the full
// width of the dock.
export function AskPane({ chat, job, about, onClose, mobile }: BrainAskPaneProps) {
  const feed = useFeedData()
  const [feedOpen, setFeedOpen] = useState(false)
  const [focusTurn, setFocusTurn] = useState<string | null>(null)

  return (
    <div className={`brain-b bb-desktop skin-${SKIN}`}>
      <div className="bb-head bb-a-head wb-pane-h">
        {mobile && <button type="button" className="back wb-back" onClick={onClose} aria-label="Back">‹</button>}
        <span className="bb-head-t bb-a-head-t">Ask</span>
        <span className="bb-head-sp" />
        <button
          type="button" className="bb-feedbtn bb-a-headbtn" aria-label={`Feed, ${feed.unreadTotal} unread`}
          onClick={() => setFeedOpen(v => !v)}
        >
          <Glyph name="feed" />
          {feed.unreadTotal > 0 && <span className="bb-badge bb-a-badge">{feed.unreadTotal > 99 ? '99+' : feed.unreadTotal}</span>}
        </button>
        {!mobile && <span className="wb-pane-x" onClick={onClose}>✕</span>}
      </div>

      <AskThread
        chat={chat} job={job} about={about} mobile={mobile}
        focusTurn={focusTurn} onFocused={() => setFocusTurn(null)}
      />

      {feedOpen && (
        <div className="bb-feedoverlay bb-a-overlay">
          <div className="bb-head bb-a-head">
            <span className="bb-head-t bb-a-head-t">Feed</span>
            <span className="bb-head-s bb-a-head-s">{feed.unreadTotal} unread</span>
            <span className="bb-head-sp" />
            <button type="button" className="bb-feedbtn bb-a-headbtn" aria-label="Close feed" onClick={() => setFeedOpen(false)}>
              <Glyph name="x" />
            </button>
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
