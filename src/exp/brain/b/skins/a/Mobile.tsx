import { useCallback, useEffect, useRef, useState } from 'react'
import type { BrainMobileProps } from '../../../types'
import { JOB_LABEL, type Job } from '../../../../v2c/layout'
import { readPlace, resolveBootPlace, tabForJob, writePlace, TABS, type Place } from '../../place'
import { useFeedData } from '../../useFeedData'
import { SKIN } from '../../skin'
import { TabBar } from './TabBar'
import { AskThread } from './AskThread'
import { Feed } from './Feed'
import { Glyph } from './icons'

const SETTLE_AT = 0.38
const FLICK_PX_PER_MS = 0.5
const AXIS_LOCK_PX = 8

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
  const [focusTurn, setFocusTurn] = useState<string | null>(boot.turn ?? null)
  const bootHandled = useRef(false)

  useEffect(() => {
    if (bootHandled.current) return
    bootHandled.current = true
    if (boot.thread && boot.thread !== chat.threadId) chat.openThread(boot.thread)
    if (boot.feed) setFeedOpen(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // M1 — the content plane is REPLACED on a place change, so it arrives rather
  // than blinking into existence. Driven by a class rather than a `key`,
  // because re-keying the pane would remount the lane the Shell handed us and
  // make every tab tap refetch a surface that had not changed.
  const [fading, setFading] = useState(false)
  const firstPlace = useRef(true)
  useEffect(() => {
    if (firstPlace.current) { firstPlace.current = false; return }
    setFading(false)
    const raf = requestAnimationFrame(() => setFading(true))
    const t = window.setTimeout(() => setFading(false), 240)
    return () => { cancelAnimationFrame(raf); window.clearTimeout(t) }
  }, [place])

  const goPlace = (next: Place) => {
    setPlace(next)
    writePlace(next)
    if (next !== 'ask') goJob(next)
  }

  const onTab = (t: Place) => { setFeedOpen(false); goPlace(t) }

  const mounted = useRef(false)
  useEffect(() => {
    if (!mounted.current) { mounted.current = true; return }
    setPlace(cur => (cur === 'ask' ? cur : tabForJob(job)))
  }, [job])

  // ---------------------------------------------------------------------
  // The sheet is under the finger for the whole gesture (transform written
  // per frame, transition suppressed); only the RELEASE settles, on the one
  // easing (M2).
  // ---------------------------------------------------------------------
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
      d.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
      if (d.axis === 'y') { drag.current = null; setDragX(null); return }
    }
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
      <div className="wb-plate bb-plate">
        <div className="bb-head bb-a-head">
          <span className="bb-head-t bb-a-head-t">{title}</span>
          {feedOpen
            ? <span className="bb-head-s bb-a-head-s">{feed.unreadTotal} unread</span>
            : p.health.n > 0 && (
              <button type="button" className="bb-head-alarm bb-a-alarm" onClick={() => onTab('ops')}>
                {p.health.n} automation alert{p.health.n > 1 ? 's' : ''}
              </button>
            )}
          <span className="bb-head-sp" />
          {feedOpen ? (
            <button type="button" className="bb-feedbtn bb-a-headbtn" aria-label="Close feed" onClick={() => setFeedOpen(false)}>
              <Glyph name="back" />
            </button>
          ) : (
            <button
              type="button" className="bb-feedbtn bb-a-headbtn" data-feed-open
              aria-label={`Feed, ${feed.unreadTotal} unread`}
              onClick={() => setFeedOpen(true)}
            >
              <Glyph name="feed" />
              {feed.unreadTotal > 0 && <span className="bb-badge bb-a-badge">{feed.unreadTotal > 99 ? '99+' : feed.unreadTotal}</span>}
            </button>
          )}
        </div>

        <div
          className="bb-pager bb-a-pager" ref={pager}
          onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={endDrag} onTouchCancel={endDrag}
        >
          <div className={`bb-pane bb-place bb-a-plane${fading ? ' bb-a-fading' : ''}${feedOpen && dragX === null ? ' bb-inert' : ''}`}>
            {place === 'ask'
              ? (
                <AskThread
                  chat={chat} job={job} about={about} mobile
                  focusTurn={focusTurn} onFocused={() => setFocusTurn(null)}
                />
              )
              : workSurface}
          </div>
          <div className={`bb-pane bb-feed bb-a-sheet${feedOpen ? ' on' : ''}`} style={sheetStyle}>
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
