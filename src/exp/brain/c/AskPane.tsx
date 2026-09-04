import { useMemo, useState } from 'react'
import type { BrainAskPaneProps } from '../types'
import { StreamList } from './StreamList'
import { useNotifications } from './useStreamData'
import { NotificationCard } from './NotificationCard'
import { groupNotifications, notificationDeepLink } from '../../../lib/turns'
import { parseWbHash } from '../../v2c/route'

/**
 * Desktop docked pane. Same thesis, same StreamList component the phone uses ,
 * parity of the thread is the point, not a second design. The one desktop-only
 * control is the Feed button: since the stream already carries notifications
 * inline, it opens a focused, notifications-only overlay for a bulk pass
 * (dismiss/open several without turns interleaved), rather than a second data
 * model.
 */
export function AskPane({ chat, about, aboutContext, onClose, onOpenAbout, mobile }: BrainAskPaneProps) {
  const notif = useNotifications()
  const [feedOpen, setFeedOpen] = useState(false)
  const groups = useMemo(() => groupNotifications(notif.rows), [notif.rows])

  return (
    <div className="brc-askpane">
      <div className="wb-pane-h brc-pane-h">
        {mobile && <button type="button" className="back wb-back" onClick={onClose} aria-label="Back">‹</button>}
        <span className="wb-pane-ic asst">✳</span>
        <div className="wb-pane-ttl">
          <div className="wb-pane-n">Claude</div>
          {about && <div className="wb-pane-s">{aboutContext ?? about}</div>}
        </div>
        <button
          type="button" className={`brc-feedbtn${feedOpen ? ' on' : ''}`}
          onClick={() => setFeedOpen(v => !v)}
        >
          Feed{notif.rows.filter(r => !r.read_at).length > 0 && <b>{notif.rows.filter(r => !r.read_at).length}</b>}
        </button>
        {about && onOpenAbout && (
          <button type="button" className="wb-pane-x" onClick={onOpenAbout} title="Back to what you were looking at">↩</button>
        )}
        {!mobile && <span className="wb-pane-x" onClick={onClose}>✕</span>}
      </div>

      <div className="brc-askbody">
        <StreamList chat={chat} about={aboutContext ?? about ?? null} notif={notif} />

        {feedOpen && (
          <div className="brc-feedoverlay">
            <div className="brc-feedoverlay-h">
              <span>Feed</span>
              <button type="button" onClick={() => setFeedOpen(false)} aria-label="Close feed">✕</button>
            </div>
            <div className="brc-feedoverlay-list">
              {groups.length === 0 && <div className="brc-empty">Nothing new.</div>}
              {groups.map(g => (
                <NotificationCard
                  key={g.key} group={g}
                  onOpen={() => {
                    const route = parseWbHash(notificationDeepLink(g.latest))
                    if (route.thread && route.thread !== chat.threadId) chat.openThread(route.thread)
                  }}
                  onDismiss={() => void notif.dismissMany(g.items.map(it => it.id), g.groupKey)}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
