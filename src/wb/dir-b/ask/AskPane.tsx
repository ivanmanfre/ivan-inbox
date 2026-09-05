/* =========================================================================
   Direction B - S15, the docked desktop Ask pane.

   Copied from `src/exp/brain/b/skins/b/AskPane.tsx`. Brief item 7: "the point
   is parity of the thread, not a new desktop design", so this is `AskThread`
   again, the same brain visibility and the same turn states as the phone, now
   inside the design system's own dock: a `Peer` with a `Header`, the same
   thread column, the same composer, a wider measure (ask.css raises the
   bubble's max measure at 768px and widens the gutter).

   AskPane's props (BrainAskPaneProps) carry no `goJob`. Shell hands the
   working surface to AskPane's job, not a setter for it. A deep-linked feed
   card therefore navigates the same way a fresh page load would: writing the
   job onto the hash. Shell already listens for `hashchange` at runtime
   (Shell.tsx's own effect, wired for exactly this: a notification's link
   opening the app on a fresh load), so this is not a new code path, only the
   same one entered from inside the running app instead of from a click on a
   URL.

   The feed overlay renders the direction's OWN feed (`../mobile/Feed`, the
   sibling surface), so the pane never pulls the shipped skin's sheet in behind
   it. That is the one import this file takes from outside the ask folder.
   ========================================================================= */
import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Badge, Header, IconButton, Peer, rise } from '../../../ds'
import type { BrainAskPaneProps } from '../../../exp/brain/types'
import { useFeedData } from '../../../exp/brain/b/useFeedData'
import { Feed } from '../mobile/Feed'
import { wbHash } from '../../../exp/v2c/route'
import type { Job } from '../../../exp/v2c/layout'
import { DirB } from '../shell'
import { AskThread } from './AskThread'
import './ask.css'

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
    <DirB className="dirb-ask-pane">
      <Peer className="dirb-ask-peer">
        <Header
          title="Ask"
          lead={mobile ? <IconButton icon="back" label="Back" data-tap onClick={onClose} /> : undefined}
          tail={
            <>
              <span className="dirb-ask-badge-seat">
                <IconButton
                  icon="bell" label={`Feed, ${feed.unreadTotal} unread`} data-tap
                  onClick={() => setFeedOpen(v => !v)}
                />
                {feed.unreadTotal > 0 && (
                  <Badge tone="accent">{feed.unreadTotal > 99 ? '99+' : feed.unreadTotal}</Badge>
                )}
              </span>
              {!mobile && (
                <IconButton icon="close" label="Close the Ask pane" data-tap onClick={onClose} />
              )}
            </>
          }
        />

        <AskThread
          chat={chat} job={job} about={about} mobile={mobile}
          focusTurn={focusTurn} onFocused={() => setFocusTurn(null)}
        />

        <AnimatePresence>
          {feedOpen && (
            <motion.div
              key="feed" className="dirb-ask-overlay"
              variants={rise} initial="hidden" animate="show" exit="exit"
            >
              <Header
                title="Feed" sub={`${feed.unreadTotal} unread`}
                tail={<IconButton icon="close" label="Close feed" data-tap onClick={() => setFeedOpen(false)} />}
              />
              <Feed
                feed={feed}
                goJob={navigateToJob}
                openThread={(id, turn) => { chat.openThread(id); setFocusTurn(turn ?? null); setFeedOpen(false) }}
                onNavigated={() => setFeedOpen(false)}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </Peer>
    </DirB>
  )
}
