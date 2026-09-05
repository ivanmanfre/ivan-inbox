/* ==========================================================================
   src/wb/ask/Mobile.tsx: S26, the phone chrome.

   One plate, one head, one pager, one tab bar.

   03-DIRECTION move 17: the head's alarm is a compact mono capsule. At idle it
   is one glyph and its figure; an event opens it into the alert and it snaps
   back on its own. A live dot marks a turn that is running right now.

   Move 18: the tab bar is the design system's, so the active place expands to
   icon plus label inside a highlight that slides between places on the one
   spring, and the counts are pills.

   Move 19: the feed is a sheet that tracks the finger 1:1, springs to its snap
   on release, fades its scrim with the drag distance and leaves on a flick.
   The axis it tracks is x, not y, because the gesture this screen already had
   is a horizontal pager and that gesture is the ledger's (S26-6).
   ========================================================================== */
import { useCallback, useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { Icon, IconButton, Badge, LiveDot, Shell, TabBar, fadeT, springSoft, type IconName, type TabItem } from '../../ds'
import { Head, Screen } from '../kit'
import type { BrainMobileProps } from '../../exp/brain/types'
import { JOB_LABEL, type Job } from '../../exp/v2c/layout'
import { readPlace, resolveBootPlace, tabForJob, writePlace, TABS, TAB_LABEL, type Place } from '../../exp/brain/b/place'
import { AskThread } from './AskThread'
import { Feed } from './Feed'
import { useFeedData } from '../../exp/brain/b/useFeedData'
import './ask.css'

// A drag has to travel this share of the pager's width before the release
// settles into the other state. Below it the sheet springs back, so a stray
// horizontal wobble during a vertical scroll never flips the surface.
const SETTLE_AT = 0.38
// A flick: fast enough that distance stops being the question.
const FLICK_PX_PER_MS = 0.5
// How far a finger has to move before the gesture claims the horizontal axis.
const AXIS_LOCK_PX = 8

/** The tab's place icon. The system's glyph map (SYSTEM.md §6) carries the same
 * six distinctions the phone and the desktop rail already agreed on, by name
 * rather than by a typed character. */
const TAB_ICON: Record<Place, IconName> = {
  ask: 'ask', today: 'today', dms: 'dms', content: 'content', sends: 'sends', ops: 'ops',
}

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

/** Move 17. One glyph and a mono figure at rest; an event opens it into the
 * alert and it snaps back. Tapping it goes to the place that holds the alert,
 * which is the one thing this control has always done. */
function StatusCapsule({ n, onClick }: { n: number; onClick: () => void }) {
  const [open, setOpen] = useState(false)
  const label = `${n} automation alert${n > 1 ? 's' : ''}`
  useEffect(() => {
    if (n <= 0) return
    setOpen(true)
    const t = window.setTimeout(() => setOpen(false), 4000)
    return () => window.clearTimeout(t)
  }, [n])
  return (
    <motion.button
      type="button" layout transition={springSoft}
      className="a-brain-cap" data-open={open ? '' : undefined}
      aria-label={label} title={label}
      onClick={onClick}
    >
      <Icon name="alert" size={16} />
      {open ? <span className="a-brain-cap-t">{label}</span> : <span>{n}</span>}
    </motion.button>
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
  // Move 3: the head condenses once the ledger under it has moved.
  const [condensed, setCondensed] = useState(false)

  // The place-change fade. `fading` is set for one beat when the place CHANGES,
  // and the replay is what plays the fade, so nothing here remounts a surface.
  // The mounted guard is the same one the `job` effect below carries: a fade on
  // first paint is a splash screen, and this file refuses that for the feed
  // rows in writing.
  const [fading, setFading] = useState(false)
  const placeMounted = useRef(false)
  useEffect(() => {
    if (!placeMounted.current) { placeMounted.current = true; return }
    setFading(true)
    const t = window.setTimeout(() => setFading(false), 200)
    return () => window.clearTimeout(t)
  }, [place])

  // Boot deep link: a thread opens Ask on THIS thread, a turn scrolls to that
  // turn inside it, a feed link opens the sheet. All only ever fire once, off
  // the hash the page was loaded with.
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
  // whole gesture (a transform written per touchmove, its transition off), and
  // only the release settles, on the one soft spring.
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

  // The live position of the sheet. While a finger is on it the transition is
  // zero so it tracks 1:1; on release it springs to the snap.
  const w = dragX === null ? 0 : widthOf()
  const tracked = dragX === null ? null : Math.min(w, Math.max(0, (feedOpen ? 0 : w) + dragX))
  const openness = tracked === null ? (feedOpen ? 0 : 1) : (w === 0 ? 0 : tracked / w)
  const sheetTo = `${openness * 100}%`
  const scrimTo = 1 - openness

  const openThreadAt = useCallback((id: string, turn?: string) => {
    chat.openThread(id)
    setFocusTurn(turn ?? null)
    setPlace('ask')
    writePlace('ask')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat])

  if (peerView) {
    return (
      <div className="app wb wb-take wb-take-thread" data-place="lane">
        {peerView}
        {windows}
      </div>
    )
  }

  const title = feedOpen ? 'Feed' : place === 'ask' ? 'Ask' : JOB_LABEL[job]

  const tabCounts = foldOnTabs(counts)
  const tabSev = foldOnTabs(sev)
  const tabs: TabItem[] = TABS.map(t => ({
    id: t,
    icon: TAB_ICON[t],
    label: TAB_LABEL[t],
    count: tabCounts[t],
    sev: tabSev[t],
  }))

  return (
    <div className="brain-b a-brain-root" data-place={feedOpen ? 'feed' : place === 'ask' ? 'ask' : 'lane'}>
      <Shell
        layout="phone"
        tabBar={<TabBar items={tabs} active={place} onSelect={id => onTab(id as Place)} markerId="a-brain-tab" />}
      >
        <Screen className="a-brain-screen">
          {/* ONE header. The place's own header and the feed sheet's header
              stacked into two title rows in an earlier build and spent about
              120px before the first row. The sheet is content; this row is
              chrome, and it swaps its own label. */}
          <Head
            title={title}
            sub={feedOpen && !condensed ? `${feed.unreadTotal} unread` : undefined}
            tail={
              <>
                {chat.busy && <LiveDot label="Claude is working" />}
                {!feedOpen && p.health.n > 0 && (
                  <StatusCapsule n={p.health.n} onClick={() => onTab('ops')} />
                )}
                {feedOpen
                  ? <IconButton icon="back" label="Close feed" onClick={() => setFeedOpen(false)} />
                  : (
                    <span className="a-brain-feedbtn" data-feed-open>
                      <IconButton
                        icon="bell" label={`Feed, ${feed.unreadTotal} unread`}
                        onClick={() => setFeedOpen(true)}
                      />
                      {feed.unreadTotal > 0 && (
                        <span className="a-brain-feedbtn-n">
                          <Badge tone="neutral" label={`${feed.unreadTotal} unread`}>
                            {feed.unreadTotal > 99 ? '99+' : feed.unreadTotal}
                          </Badge>
                        </span>
                      )}
                    </span>
                  )}
              </>
            }
          />

          <div
            className="a-brain-pager" ref={pager}
            onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={endDrag} onTouchCancel={endDrag}
          >
            {/* Inert while the feed sheet is open: the sheet is a fully opaque
                overlay at the same inset, so the place beneath it must stop
                taking taps rather than merely being hidden behind it. */}
            <div className="a-brain-pane" data-inert={feedOpen && dragX === null ? '' : undefined}>
              <motion.div
                className="a-brain-plane"
                animate={{ opacity: fading ? [0, 1] : 1 }}
                transition={fadeT}
              >
                {place === 'ask'
                  ? (
                    <AskThread
                      chat={chat} job={job} about={about} mobile
                      focusTurn={focusTurn} onFocused={() => setFocusTurn(null)}
                    />
                  )
                  : workSurface}
              </motion.div>
            </div>

            <motion.div
              className="a-brain-scrim" aria-hidden
              animate={{ opacity: scrimTo }}
              transition={tracked === null ? springSoft : { duration: 0 }}
            />

            <motion.div
              className="a-brain-sheet" data-off={feedOpen ? undefined : ''}
              animate={{ x: sheetTo }}
              transition={tracked === null ? springSoft : { duration: 0 }}
            >
              <Feed
                feed={feed} goJob={goJob}
                openThread={openThreadAt}
                onNavigated={() => setFeedOpen(false)}
                onScrolled={setCondensed}
              />
            </motion.div>
          </div>
        </Screen>
      </Shell>
      {windows}
    </div>
  )
}
