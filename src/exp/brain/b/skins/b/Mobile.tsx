import { useCallback, useEffect, useRef, useState } from 'react'
import type { BrainMobileProps } from '../../../types'
import { JOB_LABEL, type Job } from '../../../../v2c/layout'
import { readPlace, resolveBootPlace, tabForJob, writePlace, TABS, type Place } from '../../place'
import { TabBar } from '../../TabBar'
import { AskThread } from './AskThread'
import { Feed } from './Feed'
import { useFeedData } from '../../useFeedData'
import { SKIN } from '../../skin'

// A drag has to travel this share of the pager's width before the release
// settles into the other state. Below it the sheet springs back, so a stray
// horizontal wobble during a vertical scroll never flips the surface.
const SETTLE_AT = 0.38
// A flick: fast enough that distance stops being the question.
const FLICK_PX_PER_MS = 0.5
// How far a finger has to move before the gesture claims the horizontal axis.
const AXIS_LOCK_PX = 8

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

type Drag = { x0: number; y0: number; t0: number; dx: number; axis: 'none' | 'x' | 'y' }

export function Mobile(p: BrainMobileProps) {
  const { chat, job, goJob, counts, sev, boot, workSurface, windows, peerView, about } = p
  const feed = useFeedData()

  const [place, setPlace] = useState<Place>(() => resolveBootPlace(boot, readPlace()))
  const [feedOpen, setFeedOpen] = useState<boolean>(!!boot.feed)
  // The turn a push notification named. Held here rather than inside AskThread
  // so a feed tap and a cold boot arrive at the same one place.
  const [focusTurn, setFocusTurn] = useState<string | null>(boot.turn ?? null)
  const bootHandled = useRef(false)

  // Boot deep link: a thread opens Ask on THIS thread, a turn scrolls to that
  // turn inside it, a feed link opens the sheet. All only ever fire once, off
  // the hash the page was loaded with — Shell's own `boot` is frozen at mount
  // for the same reason (route.ts).
  useEffect(() => {
    if (bootHandled.current) return
    bootHandled.current = true
    if (boot.thread && boot.thread !== chat.threadId) chat.openThread(boot.thread)
    if (boot.feed) setFeedOpen(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Motion row 6. `fading` is set for one beat when the place changes; the
  // class is what restarts the animation, so nothing here remounts a surface.
  const [fading, setFading] = useState(false)
  useEffect(() => {
    setFading(true)
    const t = window.setTimeout(() => setFading(false), 140)
    return () => window.clearTimeout(t)
  }, [place])

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

  // -------------------------------------------------------------------------
  // Swipe: a TRACKED horizontal drag. The sheet is under the finger for the
  // whole gesture (transform written per touchmove, transition suppressed), and
  // only the release settles, with the short transition the stylesheet already
  // gates behind `prefers-reduced-motion: no-preference`. The tournament build
  // flipped at a fixed 60px threshold with nothing moving until the finger
  // left the glass, which is a different thing wearing the same name.
  // -------------------------------------------------------------------------
  const pager = useRef<HTMLDivElement>(null)
  const drag = useRef<Drag | null>(null)
  const [dragX, setDragX] = useState<number | null>(null)

  const widthOf = () => pager.current?.getBoundingClientRect().width ?? window.innerWidth

  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length !== 1) return
    drag.current = { x0: e.touches[0].clientX, y0: e.touches[0].clientY, t0: Date.now(), dx: 0, axis: 'none' }
  }

  const onTouchMove = (e: React.TouchEvent) => {
    const d = drag.current
    if (!d) return
    const dx = e.touches[0].clientX - d.x0
    const dy = e.touches[0].clientY - d.y0
    if (d.axis === 'none') {
      if (Math.abs(dx) < AXIS_LOCK_PX && Math.abs(dy) < AXIS_LOCK_PX) return
      // A list being scrolled owns the gesture from here on: claiming the
      // horizontal axis on a diagonal would make every flick down the feed
      // jitter the sheet sideways.
      d.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
      if (d.axis === 'y') { drag.current = null; setDragX(null); return }
    }
    // Only the direction that has somewhere to go: closed drags left, open
    // drags right. The other way is a rubber band with nothing behind it.
    const usable = feedOpen ? Math.max(0, dx) : Math.min(0, dx)
    d.dx = usable
    setDragX(usable)
  }

  const endDrag = () => {
    const d = drag.current
    drag.current = null
    setDragX(null)
    if (!d || d.axis !== 'x') return
    const w = widthOf()
    const travelled = Math.abs(d.dx)
    const speed = travelled / Math.max(1, Date.now() - d.t0)
    if (travelled >= w * SETTLE_AT || speed >= FLICK_PX_PER_MS) setFeedOpen(!feedOpen)
  }

  // The live transform for the sheet while a finger is on it. Null hands the
  // pane back to its class-driven transform, which now simply arrives: the
  // ground deletes motion from the pane switch and this file no longer argues.
  const w = dragX === null ? 0 : widthOf()
  const sheetStyle = dragX === null
    ? undefined
    : {
      transform: `translateX(${Math.min(w, Math.max(0, (feedOpen ? 0 : w) + dragX))}px)`,
      transition: 'none' as const,
    }

  const openThreadAt = useCallback((id: string, turn?: string) => {
    chat.openThread(id)
    setFocusTurn(turn ?? null)
    setPlace('ask')
    writePlace('ask')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat])

  if (peerView) {
    return (
      <div className={`app wb wb-take wb-take-thread brain-b skin-${SKIN}`} data-place="lane">
        {peerView}
        {windows}
      </div>
    )
  }

  const title = feedOpen ? 'Feed' : place === 'ask' ? 'Ask' : JOB_LABEL[job]

  return (
    <div className={`app wb brain-b skin-${SKIN}`} data-place={feedOpen ? 'feed' : place === 'ask' ? 'ask' : 'lane'}>
      <div className="wb-plate bb-plate bbf-plate">
        {/* ONE header. The tournament build drew the place's header and then the
            feed sheet's header inside it, so opening the feed stacked two title
            rows and spent about 120px before the first card. The sheet is
            content; this row is chrome, and it swaps its own label. */}
        <div className="bb-head bbf-head">
          <span className="bb-head-t">{title}</span>
          {feedOpen
            ? <span className="bb-head-s">{feed.unreadTotal} unread</span>
            : p.health.n > 0 && (
              <button type="button" className="bb-head-alarm" data-tap onClick={() => onTab('ops')}>
                {p.health.n} automation alert{p.health.n > 1 ? 's' : ''}
              </button>
            )}
          <span className="bb-head-sp" />
          {feedOpen ? (
            <button type="button" className="bb-feedbtn bbf-feedclose" data-tap aria-label="Close feed" onClick={() => setFeedOpen(false)}>‹</button>
          ) : (
            <button
              type="button" className="bb-feedbtn" data-feed-open data-tap aria-label={`Feed, ${feed.unreadTotal} unread`}
              onClick={() => setFeedOpen(true)}
            >
              ◈
              {feed.unreadTotal > 0 && <span className="bb-badge">{feed.unreadTotal > 99 ? '99+' : feed.unreadTotal}</span>}
            </button>
          )}
        </div>

        <div
          className="bb-pager" ref={pager}
          onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={endDrag} onTouchCancel={endDrag}
        >
          {/* `bb-inert` while the feed sheet is open: the sheet is a fully
              opaque overlay at the same inset, so the place beneath it must
              stop taking taps rather than merely being hidden behind it. */}
          <div className={`bb-pane bb-place${feedOpen && dragX === null ? ' bb-inert' : ''}`}>
            <div className={`bbf-plane${fading ? ' bbf-fade' : ''}`}>
              {place === 'ask'
                ? (
                  <AskThread
                    chat={chat} job={job} about={about} mobile
                    focusTurn={focusTurn} onFocused={() => setFocusTurn(null)}
                  />
                )
                : workSurface}
            </div>
          </div>
          <div className={`bb-pane bb-feed${feedOpen ? ' on' : ''}`} style={sheetStyle}>
            <Feed
              feed={feed} goJob={goJob}
              openThread={openThreadAt}
              onNavigated={() => setFeedOpen(false)}
            />
          </div>
        </div>

        <TabBar active={place} counts={foldOnTabs(counts)} sev={foldOnTabs(sev)} onTab={onTab} />
      </div>
      {windows}
    </div>
  )
}
