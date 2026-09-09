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
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { Button, Icon, IconButton, Badge, LiveDot, Shell, TabBar, fadeT, springSoft, type IconName, type TabItem } from '../../ds'
import { Head, RibSlotCtx, Screen } from '../kit'
import type { BrainMobileProps } from '../../exp/brain/types'
import { JOB_LABEL, type Job } from '../../exp/v2c/layout'
import { readPlace, resolveBootPlace, tabForJob, writePlace, TABS, TAB_LABEL, type Place } from '../../exp/brain/b/place'
import { hashNamesJob, parseWbHash } from '../../exp/v2c/route'
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
  ask: 'ask', today: 'today', sales: 'sales', dms: 'dms', content: 'content', sends: 'sends', ops: 'ops',
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
  // An EVENT opens it, and an event is the count going UP. It used to open on
  // every mount, and this control unmounts whenever the feed sheet is open —
  // so closing the feed threw the alert over the header again, four seconds at
  // a time, with nothing having happened. A standing alarm is a badge; a new
  // one is an event.
  const seen = useRef<number | null>(null)
  useEffect(() => {
    const before = seen.current
    seen.current = n
    if (before === null || n <= before) return
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

  // A link that names a job (`#exp/brain-b/sales`, `?section=sales`) opens that
  // place; a bare cold boot still lands where he left off.
  const [place, setPlace] = useState<Place>(
    () => resolveBootPlace({ ...boot, place: hashNamesJob(location.hash) ? tabForJob(job) : null }, readPlace()),
  )
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
  //
  // W2-1: `boot.thread` names an Ask conversation ONLY on the push's own
  // shape (`#exp/v2/ask?thread=…`, no place segment, `boot.focus==='chat'`).
  // A DM deep link (`#exp/brain-b/dms?thread=<uuid>`) names 'dms' as the
  // place instead, and Shell.tsx already opened that thread as a peer before
  // this component mounted (resolveBootPlace lands `place` on 'dms' for it)
  //, calling chat.openThread with a DM's prospect id here would feed a peer
  // thread id into the Ask conversation opener as if it were a chat run id.
  useEffect(() => {
    if (bootHandled.current) return
    bootHandled.current = true
    if (boot.focus === 'chat' && boot.thread && boot.thread !== chat.threadId) chat.openThread(boot.thread)
    if (boot.feed) setFeedOpen(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const goPlace = (next: Place) => {
    setPlace(next)
    writePlace(next)
    if (next !== 'ask') goJob(next)
  }

  const onTab = (t: Place) => { setFeedOpen(false); setSnap(0); goPlace(t) }

  // An explicit link must leave Ask, even when the destination job was
  // already mounted behind it. The job-change effect alone cannot do that.
  useEffect(() => {
    const onHash = () => {
      if (!hashNamesJob(location.hash)) return
      const route = parseWbHash(location.hash)
      if (route.focus === 'chat' || route.feed) return
      const next = tabForJob(route.job)
      setPlace(next)
      writePlace(next)
      setFeedOpen(false)
      setSnap(0)
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

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

  // ONE TITLE PER PLACE. D27: every phone place printed its name twice -- this
  // chrome row and, right under it, the screen's own head, which says the same
  // word plus the thing that makes it useful (the date on Today, the avatar and
  // search on DMs, the stage counts on Content). Two identical <h2>s stacked
  // cost ~56px of a 844px viewport and told a reader nothing the second time.
  // The chrome row keeps its CONTROLS -- the alarm capsule, the feed bell, the
  // live dot -- and gives the name back to the screen. Ask and Feed keep theirs:
  // neither has a head of its own underneath.
  //
  // W2-7: the FEED is no longer one of them. Its name and its unread count sat
  // on this row, which does not travel with the sheet: at the half snap the
  // sheet's body slid down to reveal the DMs head underneath while "Feed / 198
  // unread" stayed pinned at y0, and the screen read as two feeds stacked. The
  // feed's head is inside the sheet now, so head and body move together, and
  // this row goes back to being the lane's chrome, which is exactly what the
  // drop reveals.
  // N2b-1: set by the surface head that opts into carrying the chrome tiles.
  // Null means no surface claimed them and the rib draws its own row.
  const [ribSlot, setRibSlot] = useState<HTMLDivElement | null>(null)

  // N2b-1: the chrome's tiles, in the reference's own order once the surface's
  // own search lands ahead of them: search, alerts, bell, settings. They render
  // in exactly one place per commit, either this file's rib or the surface
  // head's slot, so no control is ever drawn twice.
  const ribTiles = (
    <>
      {chat.busy && <LiveDot label="Claude is working" />}
      {p.health.n > 0 && (
        <StatusCapsule n={p.health.n} note={p.health.note} onClick={() => onTab('ops')} />
      )}
      <span className="a-brain-feedbtn" data-feed-open>
        <IconButton
          icon="bell" label={`Feed, ${feed.unreadTotal} unread`}
          // Also the way back up from the half snap: the feed is already open
          // there, so opening it again has to mean putting it back where it was.
          onClick={() => { setFeedOpen(true); setSnap(0); setVy(null) }}
        />
        {feed.unreadTotal > 0 && (
          <span className="a-brain-feedbtn-n">
            <Badge tone="neutral" label={`${feed.unreadTotal} unread`}>
              {feed.unreadTotal > 99 ? '99+' : feed.unreadTotal}
            </Badge>
          </span>
        )}
      </span>
      {/* W1-2: the only route into Settings on the phone chrome was the direct
          hash (`#exp/brain-b/settings`, GAPS2-1), no tap target anywhere. The
          `IM` avatar this used to be hoped to be is `role="img"` with no
          handler (ds/Avatar.tsx), decoration by construction, so a real control
          goes here instead, beside the feed bell it already shares the rib
          with. `goJob('settings')` is the exact same job the hash route
          resolves to; the hash keeps working unchanged. */}
      <IconButton
        icon="settings" label="Settings"
        onClick={() => goJob('settings')}
      />
    </>
  )

  const ownsTitle = place === 'ask'
  const title = place === 'ask' ? 'Ask' : undefined

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
        <RibSlotCtx.Provider value={setRibSlot}>
        <Screen className="a-brain-screen">
          {/* ONE header. The place's own header and the feed sheet's header
              stacked into two title rows in an earlier build and spent about
              120px before the first row. The sheet is content; this row is
              chrome, and it swaps its own label. */}
          {/* N2b-1: the rib draws its own row ONLY while no surface head has
              claimed the tiles. A surface that publishes a slot (kit's
              `chrome`) takes them into its own 56px row and this one goes,
              which is the one head the reference has. Ask keeps the rib,
              because its pane has no head of its own to merge into. */}
          {ribSlot ? null : (
            <Head
              title={title}
              lead={ownsTitle ? undefined : <span className="ds-sr">{JOB_LABEL[job]}</span>}
              tail={ribTiles}
            />
          )}
          {ribSlot ? createPortal(ribTiles, ribSlot) : null}

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
              {/* The feed's own head, INSIDE the element that carries the drop,
                  so the name, the count and the way out travel with the rows
                  they belong to. */}
              <Head
                title="Feed"
                sub={condensed ? undefined : `${feed.unreadTotal} unread`}
                tail={<IconButton icon="back" label="Close feed" onClick={closeSheet} />}
              />
              <Feed
                feed={feed} goJob={j => {
                  const next = tabForJob(j)
                  setPlace(next)
                  writePlace(next)
                  goJob(j)
                }}
                openThread={openThreadAt}
                onNavigated={closeSheet}
                onScrolled={setCondensed}
              />
            </motion.div>
          </div>
        </Screen>
        </RibSlotCtx.Provider>
      </Shell>
      {windows}
    </div>
  )
}
