import { useEffect, useRef, useState } from 'react'
import type { BrainMobileProps } from '../types'
import { JOB_LABEL, type Job } from '../../v2c/layout'
import { readPlace, resolveBootPlace, tabForJob, writePlace, TABS, type Place } from './place'
import { TabBar } from './TabBar'
import { AskThread } from './AskThread'
import { Feed } from './Feed'
import { useFeedData } from './useFeedData'

const SWIPE_PX = 60

/** The five Job counts/severities, folded onto the five lane tabs (Ask carries
 * neither — it is not a Job and has no backlog of its own). */
function foldOnTabs<V>(byJob: Partial<Record<Job, V>>): Partial<Record<Place, V>> {
  const out: Partial<Record<Place, V>> = {}
  for (const t of TABS) {
    if (t === 'ask') continue
    const v = byJob[t as Job]
    if (v !== undefined) out[t] = v
  }
  return out
}

export function Mobile(p: BrainMobileProps) {
  const { chat, job, goJob, counts, sev, boot, workSurface, windows, peerView, about } = p
  const feed = useFeedData()

  const [place, setPlace] = useState<Place>(() => resolveBootPlace(boot, readPlace()))
  const [feedOpen, setFeedOpen] = useState<boolean>(!!boot.feed)
  const bootHandled = useRef(false)

  // Boot deep link: a thread opens Ask on THIS thread, a feed link opens the
  // sheet. Both only ever fire once, off the hash the page was loaded with —
  // Shell's own `boot` is frozen at mount for the same reason (route.ts).
  useEffect(() => {
    if (bootHandled.current) return
    bootHandled.current = true
    if (boot.thread && boot.thread !== chat.threadId) chat.openThread(boot.thread)
    if (boot.feed) setFeedOpen(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const goPlace = (next: Place) => {
    setPlace(next)
    writePlace(next)
    if (next !== 'ask') goJob(next)
  }

  const onTab = (t: Place) => { setFeedOpen(false); goPlace(t) }

  // A Content sub-lane change (WorkSegment, inside workSurface) calls the same
  // `goJob` this component was handed, so `job` can drift to magnets/styles/
  // strategy without a tab tap here. Fold it back onto the Content tab so the
  // bar's own highlight never disagrees with what is on screen — but never on
  // the very first render, or the boot-resolved 'ask' place would be
  // immediately clobbered by whatever `job` Shell booted with.
  const mounted = useRef(false)
  useEffect(() => {
    if (!mounted.current) { mounted.current = true; return }
    setPlace(cur => (cur === 'ask' ? cur : tabForJob(job)))
  }, [job])

  // Swipe: a real horizontal drag toggles the feed sheet. Direct manipulation
  // (Rauno rule) would follow the finger; this build settles for a threshold
  // flip animated by the CSS transition already in brain-b.css — a scope cut
  // written down in NOTES.md rather than pretended away.
  const touch = useRef<{ x: number; y: number } | null>(null)
  const onTouchStart = (e: React.TouchEvent) => { touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY } }
  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touch.current
    touch.current = null
    if (!start) return
    const dx = e.changedTouches[0].clientX - start.x
    const dy = e.changedTouches[0].clientY - start.y
    if (Math.abs(dx) < SWIPE_PX || Math.abs(dx) < Math.abs(dy) * 1.5) return
    if (dx < 0 && !feedOpen) setFeedOpen(true)
    else if (dx > 0 && feedOpen) setFeedOpen(false)
  }

  if (peerView) {
    return (
      <div className="app wb brain-b" data-place="lane">
        {peerView}
        {windows}
      </div>
    )
  }

  const title = place === 'ask' ? 'Ask' : JOB_LABEL[job]

  return (
    <div className="app wb brain-b" data-place={feedOpen ? 'feed' : place === 'ask' ? 'ask' : 'lane'}>
      <div className="bb-head">
        <span className="bb-head-t">{title}</span>
        {p.health.n > 0 && place !== 'ask' && (
          <span className="bb-head-s">{p.health.n} automation alert{p.health.n > 1 ? 's' : ''}</span>
        )}
        <span className="bb-head-sp" />
        <button
          type="button" className="bb-feedbtn" aria-label={`Feed, ${feed.unreadTotal} unread`}
          onClick={() => setFeedOpen(v => !v)}
        >
          ◈
          {feed.unreadTotal > 0 && <span className="bb-badge">{feed.unreadTotal > 99 ? '99+' : feed.unreadTotal}</span>}
        </button>
      </div>

      <div className="bb-pager" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        <div className="bb-pane bb-place">
          {place === 'ask'
            ? <AskThread chat={chat} job={job} about={about} mobile />
            : workSurface}
        </div>
        <div className={`bb-pane bb-feed${feedOpen ? ' on' : ''}`}>
          <div className="bb-head">
            <span className="bb-head-t">Feed</span>
            <span className="bb-head-s">{feed.unreadTotal} unread</span>
            <span className="bb-head-sp" />
            <button type="button" className="bb-feedbtn" aria-label="Close feed" onClick={() => setFeedOpen(false)}>‹</button>
          </div>
          <Feed
            feed={feed} goJob={goJob} openThread={id => { chat.openThread(id); goPlace('ask') }}
            onNavigated={() => setFeedOpen(false)}
          />
        </div>
      </div>

      <TabBar active={place} counts={foldOnTabs(counts)} sev={foldOnTabs(sev)} onTab={onTab} />
      {windows}
    </div>
  )
}
