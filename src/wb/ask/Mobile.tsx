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
import { AnimatePresence, motion } from 'motion/react'
import { Button, Icon, IconButton, Badge, LiveDot, Shell, TabBar, fadeT, springSoft, type IconName, type TabItem } from '../../ds'
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

/**
 * Move 17, the island.
 *
 * At rest it is one glyph and a mono figure, the width of a control. When an
 * alert arrives it MORPHS OPEN into the alert itself — the count as a
 * sentence, the alert's own line under it, and the one action that answers it
 * — then snaps back on its own. Tapping it either way goes to the place that
 * holds the alert, which is the one thing this control has ever done.
 *
 * The morph is `layout` on the one soft spring, so the capsule and the panel
 * are the SAME element growing, never a popover appearing beside a badge.
 *
 * `note` is the alert's own headline, which is what the ribbon this replaced
 * already printed. The capsule says it; it does not invent a second sentence
 * about it.
 */
function StatusCapsule({ n, note, onClick }: { n: number; note: string; onClick: () => void }) {
  const [open, setOpen] = useState(false)
  const label = `${n} automation alert${n > 1 ? 's' : ''}`
  useEffect(() => {
    if (n <= 0) return
    setOpen(true)
    const t = window.setTimeout(() => setOpen(false), 4000)
    return () => window.clearTimeout(t)
  }, [n])
  return (
    /* The island floats: the panel is absolutely placed over the header rather
       than laid out inside it, and a ghost holds the 44px the closed pill
       occupies. Growing it IN FLOW squeezed the header's own title down to
       three characters, which is the one thing the header has to say. */
    <span className="a-brain-capwrap">
      <span className="a-brain-cap-ghost" aria-hidden="true" />
      <motion.div
        layout transition={springSoft}
        className="a-brain-cap" data-open={open ? '' : undefined}
      >
      <button
        type="button" className="a-brain-cap-face"
        aria-label={label} aria-expanded={open}
        onClick={() => (open ? onClick() : setOpen(true))}
      >
        <Icon name="alert" size={16} />
        {open ? <span className="a-brain-cap-t">{label}</span> : <span className="a-mono">{n}</span>}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            className="a-brain-cap-body"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: fadeT }}
            exit={{ opacity: 0, transition: fadeT }}
          >
            {note && <span className="a-brain-cap-note a-clamp">{note}</span>}
            <span className="a-brain-cap-acts">
              <Button variant="quiet" size="sm" iconEnd="next" onClick={onClick}>Open</Button>
              <Button variant="quiet" size="sm" onClick={() => setOpen(false)}>Later</Button>
            </span>
          </motion.div>
        )}
        </AnimatePresence>
      </motion.div>
    </span>
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
  // Move 9: the rectangle of the feed card that opened the focused turn. Held
  // here rather than inside the thread because the card that owns it lives in
  // the sheet, which is this component's other half. A cold boot has none, so
  // a deep link from a push notification simply arrives without the morph
  // rather than growing out of a card that was never on screen.
  const [morphFrom, setMorphFrom] = useState<DOMRect | null>(null)
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

  const onTab = (t: Place) => { setFeedOpen(false); setSnap(0); goPlace(t) }

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

  // -------------------------------------------------------------------------
  // Move 19. THE SNAP POINTS, on the axis that has room for them.
  //
  // The gesture that opens and closes this sheet is the horizontal pager, and
  // that gesture is the ledger's (S26-6): it is not available for a second
  // meaning. So the snaps live on the vertical axis, which nothing else uses:
  // once the feed is open, the grip drags it DOWN, and it springs to the
  // nearest of three — full, half (the place under it visible again), or gone.
  //
  // The drag is on the GRIP and never on the list, because a vertical drag
  // inside a scrolling column is an ambiguity a thumb cannot resolve. The
  // scrim fades with the distance travelled, so the surface underneath comes
  // back as the sheet leaves rather than the instant it is let go.
  // -------------------------------------------------------------------------
  const SNAPS = [0, 0.45, 1] as const
  const [snap, setSnap] = useState(0)
  const vdrag = useRef<{ y0: number; t0: number; from: number } | null>(null)
  const [vy, setVy] = useState<number | null>(null)
  const heightOf = () => pager.current?.getBoundingClientRect().height ?? window.innerHeight

  const onGripStart = (e: React.TouchEvent) => {
    if (e.touches.length !== 1) return
    vdrag.current = { y0: e.touches[0].clientY, t0: Date.now(), from: snap }
  }
  const onGripMove = (e: React.TouchEvent) => {
    const d = vdrag.current
    if (!d) return
    e.stopPropagation()
    const h = heightOf()
    setVy(Math.min(1, Math.max(0, d.from + (e.touches[0].clientY - d.y0) / Math.max(1, h))))
  }
  const endGrip = () => {
    const d = vdrag.current
    vdrag.current = null
    const at = vy
    setVy(null)
    if (!d || at === null) return
    // A flick past the threshold means the direction, not the distance.
    const speed = (at - d.from) * heightOf() / Math.max(1, Date.now() - d.t0)
    if (speed > 0.5) { closeSheet(); return }
    const nearest = SNAPS.reduce((a, b) => (Math.abs(b - at) < Math.abs(a - at) ? b : a), SNAPS[0])
    if (nearest === 1) { closeSheet(); return }
    setSnap(nearest)
  }
  const closeSheet = () => { setFeedOpen(false); setSnap(0); setVy(null) }
  // Opening always starts at the top snap: a sheet that remembered it was half
  // way down would open half way down for a reason nobody could see.
  useEffect(() => { if (feedOpen) setSnap(0) }, [feedOpen])

  const drop = vy ?? snap
  const sheetY = feedOpen ? `${drop * 100}%` : '0%'
  // The scrim answers both axes: how far in the sheet is, and how far down.
  const scrimTo = (1 - openness) * (1 - drop)

  const openThreadAt = useCallback((id: string, turn?: string, from?: DOMRect | null) => {
    chat.openThread(id)
    setFocusTurn(turn ?? null)
    setMorphFrom(from ?? null)
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
    /* `wb` rides here for one reason: the surfaces this frame HOSTS are not all
       rebuilt yet. Magnets, Styles, Strategy, Money and the windows still read
       nine sheets that scope every rule to `.wb.wb.wb`, and the phone chrome
       this replaced carried the class, so dropping it left those five surfaces
       bare at 390 while they still looked right at 1440. It leaves with them,
       in W6. */
    <div className="brain-b wb a-brain-root" data-place={feedOpen ? 'feed' : place === 'ask' ? 'ask' : 'lane'}>
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
                  <StatusCapsule n={p.health.n} note={p.health.note} onClick={() => onTab('ops')} />
                )}
                {feedOpen
                  ? <IconButton icon="back" label="Close feed" onClick={closeSheet} />
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
                      morphFrom={morphFrom}
                      onMorphed={() => setMorphFrom(null)}
                      // The other half of move 9: a drag down on the answer he
                      // arrived at goes back to the card he arrived from.
                      onDragBack={() => { setFocusTurn(null); setFeedOpen(true) }}
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
              animate={{ x: sheetTo, y: sheetY }}
              transition={tracked === null && vy === null ? springSoft : { duration: 0 }}
            >
              {/* The grip is the drag surface AND the thing that says the sheet
                  can be dragged. It carries a real control too, so a reader who
                  never drags anything can still put the feed away. */}
              <div
                className="a-brain-grip"
                onTouchStart={onGripStart} onTouchMove={onGripMove}
                onTouchEnd={endGrip} onTouchCancel={endGrip}
              >
                <button
                  type="button" className="a-brain-grip-b"
                  aria-label={drop > 0.2 ? 'Put the feed back up' : 'Push the feed down'}
                  onClick={() => setSnap(drop > 0.2 ? 0 : 0.45)}
                ><span /></button>
              </div>
              <Feed
                feed={feed} goJob={goJob}
                openThread={openThreadAt}
                onNavigated={closeSheet}
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
