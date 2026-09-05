/* ==========================================================================
   src/wb/dir-a/brain/AskPane.tsx: S15, the docked desktop Ask pane.

   The point is parity of the thread, not a second desktop design, so this is
   `AskThread` again, the same turn states as the phone, inside the docking
   chrome the pane already had. The head is the kit's compact head; the feed is
   the design system's own `Sheet` (03-DIRECTION move 19), which is where the
   sheet primitive lands for real: nothing docks a horizontal pager here, so
   the sheet keeps its own finger tracking, its snap, its scrim fading with the
   drag and its flick to dismiss.

   AskPane's props carry no `goJob`. A deep-linked feed row therefore navigates
   the way a fresh page load would: by writing the job onto the hash. The Shell
   already listens for `hashchange` at runtime, wired for exactly this, so this
   is not a new code path, only the same one entered from inside the running
   app instead of from a click on a URL.
   ========================================================================== */
import { useState } from 'react'
import { Badge, IconButton, Sheet } from '../../../ds'
import { Head } from '../kit'
import type { BrainAskPaneProps } from '../../../exp/brain/types'
import { AskThread } from './AskThread'
import { Feed } from './Feed'
import { useFeedData } from '../../../exp/brain/b/useFeedData'
import { wbHash } from '../../../exp/v2c/route'
import type { Job } from '../../../exp/v2c/layout'
import './brain.css'

function navigateToJob(job: Job): void {
  location.hash = wbHash(job, null)
}

export function AskPane({ chat, job, about, onClose, mobile }: BrainAskPaneProps) {
  const feed = useFeedData()
  const [feedOpen, setFeedOpen] = useState(false)
  // The turn a feed row names, so the docked pane lands on the same answer the
  // phone would (a `claude_turn` row's url carries `&turn=`).
  const [focusTurn, setFocusTurn] = useState<string | null>(null)

  return (
    <div className="a-brain-desktop">
      <Head
        title="Ask"
        lead={mobile ? <IconButton icon="back" label="Back" onClick={onClose} /> : undefined}
        tail={
          <>
            <span className="a-brain-feedbtn">
              <IconButton
                icon="bell" label={`Feed, ${feed.unreadTotal} unread`}
                active={feedOpen}
                onClick={() => setFeedOpen(v => !v)}
              />
              {feed.unreadTotal > 0 && (
                <span className="a-brain-feedbtn-n">
                  <Badge tone="neutral" label={`${feed.unreadTotal} unread`}>
                    {feed.unreadTotal > 99 ? '99+' : feed.unreadTotal}
                  </Badge>
                </span>
              )}
            </span>
            {!mobile && <IconButton icon="close" label="Close the Ask pane" onClick={onClose} />}
          </>
        }
      />

      <AskThread
        chat={chat} job={job} about={about} mobile={mobile}
        focusTurn={focusTurn} onFocused={() => setFocusTurn(null)}
      />

      <Sheet
        open={feedOpen}
        onClose={() => setFeedOpen(false)}
        title="Feed"
        sub={`${feed.unreadTotal} unread`}
        className="a-brain-feedsheet"
      >
        <Feed
          feed={feed}
          goJob={navigateToJob}
          openThread={(id, turn) => { chat.openThread(id); setFocusTurn(turn ?? null); setFeedOpen(false) }}
          onNavigated={() => setFeedOpen(false)}
        />
      </Sheet>
    </div>
  )
}
