import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { BrainMobileProps } from '../../../exp/brain/types'
import { JOB_LABEL, type Job } from '../../../exp/v2c/layout'
import {
  readPlace, resolveBootPlace, tabForJob, writePlace, TABS, TAB_LABEL, type Place,
} from '../../../exp/brain/b/place'
import { useFeedData } from '../../../exp/brain/b/useFeedData'
import { SKIN } from '../../../exp/brain/b/skin'
import {
  Badge, Header, Icon, IconButton, LiveDot, TabBar, cx, fadeT, spring, springSoft,
  type IconName,
} from '../../../ds'
import { DirB } from '../shell'
import { AskThread } from '../ask/AskThread'
import { Feed } from './Feed'
import './mobile.css'

/* =========================================================================
   S26. The phone chrome: the header island, the pager, the tab bar.

   The horizontal pager is the shipped one, unchanged: the same settle share,
   the same flick speed, the same axis lock, the same per-touchmove transform.
   Direction B adds a SECOND axis on top of it (move 19): the sheet has three
   snap points, tracks the finger 1:1 down, springs to the nearest one and
   dismisses on a flick. The two never fight, because a gesture that claims
   the vertical axis stops before the pager's own handler ever sees it.
   ========================================================================= */

// A drag has to travel this share of the pager's width before the release
// settles into the other state. Below it the sheet springs back, so a stray
// horizontal wobble during a vertical scroll never flips the surface.
const SETTLE_AT = 0.38
// A flick: fast enough that distance stops being the question.
const FLICK_PX_PER_MS = 0.5
// How far a finger has to move before the gesture claims the horizontal axis.
const AXIS_LOCK_PX = 8

// Move 19. Where the sheet rests, as a share of the pager's height, and how
// far down a release has to land before the sheet is gone instead of parked.
type Snap = 'full' | 'half' | 'peek'
const SNAPS: Snap[] = ['full', 'half', 'peek']
const SNAP_AT: Record<Snap, number> = { full: 0, half: 0.46, peek: 0.78 }
const SHEET_GONE_AT = 0.9

/** The five Job counts/severities, folded onto the five lane tabs (Ask carries
 * neither: it is not a Job and has no backlog of its own). */
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
type VDrag = { x0: number; y0: number; t0: number; dy: number; owns: boolean; grip: boolean }

/**
 * Move 17. The status capsule as a dynamic island. Idle it is one glyph with
 * the unread count on it; when an automation alarm is standing the capsule
 * morphs open, on the one spring, into the alert and its action, and it snaps
 * back to the glyph the moment the alarm clears. Both of the header's old
 * behaviours survive with their strings: the alert goes to Ops, the glyph
 * opens the feed.
 */
function Island({ alarm, unread, feedOpen, onOps, onFeed, onCloseFeed }: {
  alarm: string | null
  unread: number
  feedOpen: boolean
  onOps: () => void
  onFeed: () => void
  onCloseFeed: () => void
}) {
  const open = !feedOpen && alarm !== null
  return (
    <motion.div layout className="dirb-mob-island" data-open={open} transition={spring}>
      <AnimatePresence initial={false}>
        {open && alarm && (
          <motion.button
            key="alert" type="button" className="dirb-mob-alert dirb-tap" data-tap
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: fadeT }}
            transition={fadeT}
            onClick={onOps}
          >
            <Icon name="alert" size={16} />
            {alarm}
            <LiveDot label={alarm} />
          </motion.button>
        )}
      </AnimatePresence>
      {feedOpen
        ? (
          <IconButton
            icon="back" label="Close feed" data-tap onClick={onCloseFeed}
          />
        )
        : (
          <button
            type="button" className="dirb-mob-feedbtn" data-feed-open data-tap
            aria-label={`Feed, ${unread} unread`}
            onClick={onFeed}
          >
            <Icon name="ops" size={20} />
            {unread > 0 && <Badge tone="accent">{unread > 99 ? '99+' : unread}</Badge>}
          </button>
        )}
    </motion.div>
  )
}

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
  // the hash the page was loaded with: Shell's own `boot` is frozen at mount
  // for the same reason (route.ts).
  useEffect(() => {
    if (bootHandled.current) return
    bootHandled.current = true
    if (boot.thread && boot.thread !== chat.threadId) chat.openThread(boot.thread)
    if (boot.feed) setFeedOpen(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Motion row 5. `fading` is set for one beat when the place CHANGES; the
  // class is what restarts the animation, so nothing here remounts a surface.
  // The mounted guard is the same one the `job` effect below carries: a fade on
  // first paint is a splash screen, and this file already refuses that for the
  // feed rows in writing.
  const [fading, setFading] = useState(false)
  const placeMounted = useRef(false)
  useEffect(() => {
    if (!placeMounted.current) { placeMounted.current = true; return }
    setFading(true)
    const t = window.setTimeout(() => setFading(false), 200)
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
  // bar's own highlight never disagrees with what is on screen, but never on
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
  const heightOf = () => pager.current?.getBoundingClientRect().height ?? window.innerHeight

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

  // -------------------------------------------------------------------------
  // Move 19. The SECOND axis, added on top of the pager rather than in place of
  // it. A vertical gesture only engages from the grip, or when the feed's own
  // scroller is already at its top and the finger is heading down; anything
  // else is a list being read. Once it engages it stops propagating, so the
  // pager (which drops a y-axis gesture anyway) never double-counts it.
  // -------------------------------------------------------------------------
  const sheet = useRef<HTMLDivElement>(null)
  const vdrag = useRef<VDrag | null>(null)
  const [snap, setSnap] = useState<Snap>('full')
  const [sheetDy, setSheetDy] = useState<number | null>(null)

  useEffect(() => { setSnap('full'); setSheetDy(null) }, [feedOpen])

  const scrollerTop = () =>
    (sheet.current?.querySelector('[data-feed]') as HTMLElement | null)?.scrollTop ?? 0

  const onSheetStart = (e: React.TouchEvent) => {
    if (e.touches.length !== 1) return
    vdrag.current = {
      x0: e.touches[0].clientX, y0: e.touches[0].clientY, t0: Date.now(),
      dy: 0, owns: false,
      grip: Boolean((e.target as HTMLElement | null)?.closest?.('[data-grip]')),
    }
  }

  const onSheetMove = (e: React.TouchEvent) => {
    const d = vdrag.current
    if (!d) return
    const dy = e.touches[0].clientY - d.y0
    const dx = e.touches[0].clientX - d.x0
    if (!d.owns) {
      if (Math.abs(dy) < AXIS_LOCK_PX && Math.abs(dx) < AXIS_LOCK_PX) return
      // A horizontal gesture is the pager's. Hand it straight back.
      if (Math.abs(dy) <= Math.abs(dx)) { vdrag.current = null; return }
      const atTop = scrollerTop() <= 0
      if (!d.grip && !(atTop && (dy > 0 || snap !== 'full'))) { vdrag.current = null; return }
      d.owns = true
    }
    e.stopPropagation()
    d.dy = dy
    setSheetDy(dy)
  }

  const endSheetDrag = () => {
    const d = vdrag.current
    vdrag.current = null
    setSheetDy(null)
    if (!d || !d.owns) return
    const h = heightOf()
    const y = SNAP_AT[snap] * h + d.dy
    const speed = d.dy / Math.max(1, Date.now() - d.t0)
    if (speed >= FLICK_PX_PER_MS || y >= h * SHEET_GONE_AT) { setFeedOpen(false); return }
    if (speed <= -FLICK_PX_PER_MS) { setSnap('full'); return }
    let best: Snap = 'full'
    let bestGap = Infinity
    for (const k of SNAPS) {
      const gap = Math.abs(SNAP_AT[k] * h - y)
      if (gap < bestGap) { bestGap = gap; best = k }
    }
    setSnap(best)
  }

  const sheetH = heightOf()
  const sheetY = Math.min(sheetH, Math.max(0, SNAP_AT[snap] * sheetH + (sheetDy ?? 0)))
  const scrimOpacity = Math.min(1, Math.max(0, 1 - sheetY / Math.max(1, sheetH)))

  const openThreadAt = useCallback((id: string, turn?: string) => {
    chat.openThread(id)
    setFocusTurn(turn ?? null)
    setPlace('ask')
    writePlace('ask')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat])

  if (peerView) {
    return (
      <DirB className="dirb-mob-frame">
        <div className={`app wb wb-take wb-take-thread brain-b skin-${SKIN} dirb-mob`} data-place="lane">
          {peerView}
          {windows}
        </div>
      </DirB>
    )
  }

  const title = feedOpen ? 'Feed' : place === 'ask' ? 'Ask' : JOB_LABEL[job]
  const alarm = p.health.n > 0
    ? `${p.health.n} automation alert${p.health.n > 1 ? 's' : ''}`
    : null
  const tabCounts = foldOnTabs(counts)
  const tabSev = foldOnTabs(sev)

  return (
    <DirB className="dirb-mob-frame">
      <div
        className={`app wb brain-b skin-${SKIN} dirb-mob`}
        data-place={feedOpen ? 'feed' : place === 'ask' ? 'ask' : 'lane'}
      >
        <div className="dirb-mob-plate">
          {/* ONE header. The tournament build drew the place's header and then
              the feed sheet's header inside it, so opening the feed stacked two
              title rows and spent about 120px before the first card. The sheet
              is content; this row is chrome, and it swaps its own label. */}
          <Header
            title={title}
            sub={feedOpen ? `${feed.unreadTotal} unread` : undefined}
            tail={
              <Island
                alarm={alarm} unread={feed.unreadTotal} feedOpen={feedOpen}
                onOps={() => onTab('ops')}
                onFeed={() => setFeedOpen(true)}
                onCloseFeed={() => setFeedOpen(false)}
              />
            }
          />

          <div
            className="dirb-mob-pager" ref={pager}
            onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={endDrag} onTouchCancel={endDrag}
          >
            {/* Inert while the feed sheet is open: the sheet is a fully opaque
                overlay at the same inset, so the place beneath it must stop
                taking taps rather than merely being hidden behind it. */}
            <div
              className="dirb-mob-pane dirb-mob-place"
              data-inert={feedOpen && dragX === null}
            >
              <div className="dirb-mob-plane" data-fading={fading}>
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

            <AnimatePresence>
              {feedOpen && (
                <motion.div
                  className="dirb-mob-scrim" aria-hidden
                  initial={{ opacity: 0 }}
                  animate={{ opacity: scrimOpacity }}
                  exit={{ opacity: 0, transition: fadeT }}
                  transition={sheetDy === null ? springSoft : { duration: 0 }}
                />
              )}
            </AnimatePresence>

            <div
              className={cx('dirb-mob-pane', 'dirb-mob-sheet')}
              data-open={feedOpen}
              data-snap={snap}
              style={sheetStyle}
              ref={sheet}
            >
              <motion.div
                className="dirb-mob-sheet-inner"
                animate={{ y: sheetY }}
                transition={sheetDy === null ? springSoft : { duration: 0 }}
                onTouchStart={onSheetStart} onTouchMove={onSheetMove}
                onTouchEnd={endSheetDrag} onTouchCancel={endSheetDrag}
              >
                <div className="dirb-mob-grip" data-grip aria-hidden><span /></div>
                <Feed
                  feed={feed} goJob={goJob}
                  openThread={openThreadAt}
                  onNavigated={() => setFeedOpen(false)}
                />
              </motion.div>
            </div>
          </div>

          <TabBar
            className="dirb-mob-tabs"
            markerId="dirb-mob-place"
            active={place}
            items={TABS.map(t => ({
              id: t,
              icon: t as IconName,
              label: TAB_LABEL[t],
              count: tabCounts[t],
              sev: tabSev[t],
            }))}
            onSelect={id => onTab(id as Place)}
          />
        </div>
        {windows}
      </div>
    </DirB>
  )
}
