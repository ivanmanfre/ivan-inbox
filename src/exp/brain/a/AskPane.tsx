// AskPane.tsx - the desktop dock. Same thread, same brain-visibility facts,
// same turn states as the phone's Ask place (AskThread is the shared
// component); this file only adds what is desktop-specific: the pane's own
// close control and a Feed button that opens the feed as an overlay panel
// inside the pane, per the brief.
import { useState } from 'react'
import type { BrainAskPaneProps } from '../types'
import { AskThread } from './AskThread'
import { Feed } from './Feed'
import { resolveNotificationRoute } from './deepLink'

export function BrainAskPane({ chat, job, about, aboutContext, subjects, onClose, onOpenAbout, mobile }: BrainAskPaneProps) {
  const [feedOpen, setFeedOpen] = useState(false)
  const [unread, setUnread] = useState(0)

  // Both pane controls live IN the header row, and the close is last. Floating
  // it over the top-right corner put it on top of the New thread button at 1440.
  const headerExtra = (
    <button
      type="button" className={`ba-feedbtn${feedOpen ? ' on' : ''}`}
      onClick={() => setFeedOpen(v => !v)}
    >
      Feed{unread > 0 && <span className="ba-feedbtn-n">{unread}</span>}
    </button>
  )
  const headerEnd = !mobile
    ? <button type="button" className="ba-pane-x" onClick={onClose} aria-label="Close the pane">✕</button>
    : null

  return (
    <div className="brain-a ba-deskwrap">
      {mobile && (
        <div className="ba-pane-x-row">
          <button type="button" className="back" onClick={onClose} aria-label="Back">‹</button>
        </div>
      )}
      <AskThread
        chat={chat} job={job} about={about} aboutContext={aboutContext} subjects={subjects}
        mobile={mobile} onOpenAbout={onOpenAbout} headerExtra={headerExtra} headerEnd={headerEnd}
      />
      {feedOpen && (
        <div className="ba-feedoverlay">
          <div className="ba-feedoverlay-h">
            <span>Feed</span>
            <button type="button" className="ba-feedoverlay-x" onClick={() => setFeedOpen(false)}>✕</button>
          </div>
          <Feed
            active={feedOpen}
            onUnreadChange={setUnread}
            onNavigate={n => {
              const route = resolveNotificationRoute(n)
              setFeedOpen(false)
              if (route.place === 'ask') { if (route.thread) chat.openThread(route.thread); return }
              // A desktop lane switch is outside this pane's authority (it does
              // not own `job`); the pane closes the overlay and leaves the
              // in-app hash navigation the notification would already trigger
              // on the phone to the workbench's own hash listener.
              location.hash = `#exp/${location.hash.match(/^#exp\/([^/]+)/)?.[1] ?? 'v2'}/${route.job}`
            }}
          />
        </div>
      )}
    </div>
  )
}
