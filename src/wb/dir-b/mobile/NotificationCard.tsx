import { useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { Notification, NotificationGroup } from '../../../lib/turns'
import {
  FAMILY_LANE, groupStateWord, severityShape, stateWord,
} from '../../../exp/brain/b/families'
import { JOB_LABEL } from '../../../exp/v2c/layout'
import {
  dayWord, detailLine, formFor, pageCard, quoteCard, raised, rowLine, subjectFor,
} from '../../../exp/brain/b/skins/b/forms'
import { Button, Chip, Icon, IconButton, cx, fadeT, spring } from '../../../ds'
import './mobile.css'

/* =========================================================================
   S28. The notification card and the group deck, rebuilt on src/ds.

   The card FORMS (quote / time / strip / page / tile) and every word on them
   still come from the shared pure modules (families.ts, forms.ts), imported
   at their real paths. What changed is density: direction B move 1 splits one
   list into two of them. A human event (a reply, a comment, a booking) keeps
   the full card with its quote; a system event (a lane report, a thing that
   broke) is one quiet line with a mono time. A Claude answer stays a card
   because it is a document you can go back into, not an event.

   Every data hook the evidence harness reads is kept: `data-card`,
   `data-family`, `data-shape`, `data-group`, `data-tap`.
   ========================================================================= */

const clock = (iso: string): string =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })

/** The quiet-line densities. Everything else keeps the full card. */
const LINE_FORMS = new Set(['tile', 'strip'])

/**
 * Move 4. A running row wears its state as motion. The predicate reads the
 * row's OWN printed state word rather than a family list, so the wash can
 * never claim a lane is working while the card says something else.
 */
const RUNNING = /\b(running|in progress|building|generating|sending|working|queued|syncing)\b/i

/** Does this row's own printed state word say a lane is working right now?
 * The feed asks, so that at most ONE row on the surface carries the sweep. */
export function isRunning(n: Pick<Notification, 'family' | 'title' | 'body' | 'severity' | 'count'>): boolean {
  return RUNNING.test(stateWord(n))
}

function TenantChip({ tenant }: { tenant: string | null }) {
  if (!tenant) return null
  const label = /rise/i.test(tenant) ? 'RISE' : /arch/i.test(tenant) ? 'ARCH' : /ivan/i.test(tenant) ? 'Mine' : tenant
  return <Chip tone="quiet">{label}</Chip>
}

function laneLabel(family: string): string | null {
  const lane = FAMILY_LANE[family as keyof typeof FAMILY_LANE]
  return lane ? JOB_LABEL[lane] : null
}

/** The severity mark: a filled square (needs you), a solid bar (an error), a
 * hollow ring (information). Shape carries it; colour only agrees. */
function Mark({ shape }: { shape: 'square' | 'bar' | 'dot' }) {
  return <span className="dirb-mob-mark" data-shape={shape}><i /></span>
}

/**
 * The headline every form leads with: the mark, the short word for what
 * changed, and WHO OR WHAT it happened to, in the card's own largest type.
 * A bare verb is not a notification, so the subject joins the state word on
 * the same line rather than sitting on one of its own.
 */
function Headline({ shape, word, subject, big = false, live = false, tail }: {
  shape: 'square' | 'bar' | 'dot'
  word: string
  subject?: string | null
  big?: boolean
  live?: boolean
  tail?: React.ReactNode
}) {
  return (
    <div className="dirb-mob-head" data-big={big}>
      <Mark shape={shape} />
      <span className={cx('dirb-mob-state', live && 'dirb-working')} data-live={live}>
        <span className="dirb-mob-word">{word}</span>
      </span>
      {subject && (
        <>
          <span className="dirb-mob-sep" aria-hidden />
          <span className="dirb-mob-subj dirb-truncate">{subject}</span>
        </>
      )}
      {tail ? <><span className="dirb-grow" />{tail}</> : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Swipe to dismiss. The card follows the finger with its transition suppressed
// and only the release settles; past a third of the card's width it leaves.
// LEFT only: a right drag inside an open feed belongs to the sheet, which is
// the surface behind this one, and two gestures on one axis is one gesture too
// many. The dismiss control stays for anyone who would rather press a button.
// ---------------------------------------------------------------------------
const SWIPE_LOCK = 8
const SWIPE_MAX = 108
const SWIPE_SETTLE = 0.33

function useSwipe(onDismiss: () => void) {
  const start = useRef<{ x: number; y: number; axis: 'none' | 'x' | 'y' } | null>(null)
  const [dx, setDx] = useState(0)
  const [dragging, setDragging] = useState(false)

  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length !== 1) return
    start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, axis: 'none' }
  }
  const onTouchMove = (e: React.TouchEvent) => {
    const s = start.current
    if (!s) return
    const mx = e.touches[0].clientX - s.x
    const my = e.touches[0].clientY - s.y
    if (s.axis === 'none') {
      if (Math.abs(mx) < SWIPE_LOCK && Math.abs(my) < SWIPE_LOCK) return
      // A list being scrolled owns the gesture: claiming the horizontal axis on
      // a diagonal makes every flick down the feed jitter the card sideways.
      s.axis = Math.abs(mx) > Math.abs(my) ? 'x' : 'y'
      if (s.axis === 'y') { start.current = null; setDx(0); setDragging(false); return }
      setDragging(true)
    }
    // Once the card owns the x axis the pager must not also see it: the pager's
    // own handler locked x, clamped its travel to zero and dropped the inert
    // guard off the place underneath for the length of the swipe.
    e.stopPropagation()
    setDx(Math.max(-SWIPE_MAX, Math.min(0, mx)))
  }
  const end = () => {
    const s = start.current
    start.current = null
    setDragging(false)
    if (!s || s.axis !== 'x') { setDx(0); return }
    if (Math.abs(dx) >= SWIPE_MAX * SWIPE_SETTLE) onDismiss()
    setDx(0)
  }
  const style = dx !== 0
    ? { transform: `translateX(${dx}px)`, transition: dragging ? ('none' as const) : undefined }
    : undefined
  return { onTouchStart, onTouchMove, onTouchEnd: end, onTouchCancel: end, style, open: dx !== 0 }
}

// ---------------------------------------------------------------------------

export function NotificationCard({ n, onOpen, onDismiss, nested = false, slotClass = '', going = false, fresh = false, index = 0, live = false }: {
  n: Notification
  onOpen: (n: Notification) => void
  onDismiss: (id: string) => void
  nested?: boolean
  /** The feed's own enter/leave classes, applied to the row this component
   * owns rather than to a wrapper around it: the evidence harness reaches a
   * card through the feed body's direct children. */
  slotClass?: string
  going?: boolean
  fresh?: boolean
  index?: number
  /** Move 4: the feed grants the sweep to one row at a time. */
  live?: boolean
}) {
  // Move 8. The tick draws in place BEFORE the row leaves, but the write still
  // fires on the press: `resolve` sets the tick and calls straight through.
  const [resolved, setResolved] = useState(false)
  const resolve = (id: string) => { setResolved(true); onDismiss(id) }
  const swipe = useSwipe(() => resolve(n.id))
  const shape = severityShape(n.severity)
  const form = formFor(n.family)
  const lane = laneLabel(n.family)
  const unread = !n.read_at
  const time = clock(n.last_seen_at || n.created_at)
  const word = stateWord(n)

  // A row inside an expanded deck answers "which one of these", so it drops the
  // mark, the form and the state the parent card has already said, and leads
  // with its own sentence.
  if (nested) {
    // A deck exists so he can clear the one he has dealt with and leave the
    // rest. The row keeps its own dismiss and its own swipe; it drops only the
    // mark and the state the parent card has already said.
    return (
      <motion.div
        layout
        className="dirb-mob-row"
        data-card data-family={n.family} data-unread={unread}
        style={swipe.style}
        transition={spring}
        onClick={() => onOpen(n)}
        onTouchStart={swipe.onTouchStart} onTouchMove={swipe.onTouchMove}
        onTouchEnd={swipe.onTouchEnd} onTouchCancel={swipe.onTouchCancel}
      >
        <span className="dirb-grow dirb-truncate">{rowLine(n)}</span>
        <span className="ds-t-mono">{time}</span>
        <IconButton
          icon="close" label="Dismiss" size="sm" data-tap
          onClick={e => { e.stopPropagation(); resolve(n.id) }}
        />
      </motion.div>
    )
  }

  const action = lane || form === 'page'
    ? (
      <Button
        variant="quiet" size="sm" data-tap
        onClick={e => { e.stopPropagation(); onOpen(n) }}
      >{form === 'page' && !lane ? 'Pick this up' : form === 'quote' ? 'Reply' : form === 'time' ? 'Open' : lane}</Button>
    )
    : null

  // The `page` form carries both controls the ledger names: its lane action and
  // the one that says what the card actually is.
  const pageAction = form === 'page' && lane
    ? (
      <Button
        variant="quiet" size="sm" data-tap
        onClick={e => { e.stopPropagation(); onOpen(n) }}
      >Pick this up</Button>
    )
    : null

  const foot = (opts?: { clock?: boolean }) => (
    <div className="dirb-mob-foot">
      <TenantChip tenant={n.tenant} />
      {/* The time block already prints this clock as its figure; a second copy
          three lines under it was one of the panel's craft findings. */}
      {opts?.clock !== false && <span className="ds-t-mono">{time}</span>}
      <span className="dirb-grow" />
      {action}
      {pageAction}
    </div>
  )

  const subject = subjectFor(n)
  const density = LINE_FORMS.has(form) ? 'line' : 'card'

  let inner: React.ReactNode
  if (form === 'quote') {
    const { quote } = quoteCard(n)
    inner = (
      <>
        <Headline shape={shape} word={word} subject={subject} live={live} />
        {quote && <blockquote className="dirb-quote">{quote}</blockquote>}
        {foot()}
      </>
    )
  } else if (form === 'time') {
    const detail = detailLine(n.body, `${word} ${subject ?? ''}`, 90)
    inner = (
      <>
        <Headline shape={shape} word={word} subject={subject} live={live} />
        <div className="dirb-mob-timeblock">
          <span className="dirb-col">
            <span className="dirb-mob-day-word">{dayWord(n.last_seen_at || n.created_at)}</span>
            <span className="dirb-mob-fig">{time}</span>
          </span>
          {detail && <span className="dirb-mob-detail dirb-clamp3">{detail}</span>}
        </div>
        {foot({ clock: false })}
      </>
    )
  } else if (form === 'page') {
    const { state, snippet, asked } = pageCard(n)
    inner = (
      <>
        <Headline shape={shape} word={state} subject={subject} live={live} />
        {snippet && <div className="dirb-inset"><p className="dirb-clamp3">{snippet}</p></div>}
        {asked && <span className="dirb-mob-asked dirb-truncate">You asked: {asked}</span>}
        {foot()}
      </>
    )
  } else {
    // Move 1 + move 2. A system event is ONE quiet line: actor, verb, object,
    // a mono time, and the one action inline on the row. The strip form keeps
    // its edge bar and the sentence the headline does not already carry.
    const line = form === 'strip' ? detailLine(n.body, `${word} ${subject ?? ''}`) : null
    inner = (
      <>
        <Headline
          shape={shape} word={word} subject={subject} live={live}
          tail={
            <>
              <TenantChip tenant={n.tenant} />
              <span className="ds-t-mono">{time}</span>
              {action}
            </>
          }
        />
        {line && <span className="dirb-mob-detail ds-t-meta dirb-clamp2">{line}</span>}
      </>
    )
  }

  return (
    <motion.div
      layout
      className={cx('dirb-mob-slot', slotClass)}
      data-card data-family={n.family} data-shape={shape}
      data-inset={!raised(n.severity)}
      initial={fresh ? { opacity: 0, y: -8 } : false}
      animate={going ? { opacity: 0, scale: 0.98 } : { opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, transition: fadeT }}
      transition={fresh ? { ...spring, delay: index * 0.03 } : spring}
      aria-hidden={going || undefined}
    >
      <div className="dirb-mob-reveal" aria-hidden>
        <Icon name="discard" size={16} />
        Dismiss
      </div>
      <div
        className="dirb-mob-card"
        data-form={form}
        data-density={density}
        data-raised={raised(n.severity)}
        data-unread={unread}
        style={swipe.style}
        onClick={() => onOpen(n)}
        onTouchStart={swipe.onTouchStart} onTouchMove={swipe.onTouchMove}
        onTouchEnd={swipe.onTouchEnd} onTouchCancel={swipe.onTouchCancel}
      >
        {form === 'strip' && <span className="dirb-mob-edge" aria-hidden />}
        {inner}
        <IconButton
          icon="close" label="Dismiss" size="sm" className="dirb-mob-x" data-tap
          onClick={e => { e.stopPropagation(); resolve(n.id) }}
        />
        <AnimatePresence>
          {resolved && (
            <motion.span
              className="dirb-mob-tick" aria-hidden
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, transition: fadeT }}
              transition={spring}
            >
              <Icon name="check" size={24} />
            </motion.span>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  )
}

/**
 * A stacked deck (moves 6 and 7): the top card of the family with peeked edges
 * behind it that make the count visible before it is opened, and the count and
 * kind as its state word. Tapping fans it open on the one spring, and the rows
 * fade in under the parent with the list stagger.
 */
export function GroupCard({ g, open, onToggle, onOpen, onDismissAll, onDismissOne, going = false, fresh = false, index = 0 }: {
  g: NotificationGroup
  open: boolean
  onToggle: () => void
  onOpen: (n: Notification) => void
  onDismissAll: () => void
  onDismissOne: (id: string) => void
  going?: boolean
  fresh?: boolean
  index?: number
}) {
  const [resolved, setResolved] = useState(false)
  const shape = severityShape(g.latest.severity)
  const unread = g.unread > 0
  const latest = rowLine(g.latest)
  const peeks = Math.min(2, Math.max(0, g.items.length - 1))
  return (
    <motion.div
      layout
      className="dirb-mob-slot dirb-mob-deck dirb-deck"
      data-group data-family={g.family} data-shape={shape}
      data-inset={!raised(g.latest.severity)}
      initial={fresh ? { opacity: 0, y: -8 } : false}
      animate={going ? { opacity: 0, scale: 0.98 } : { opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, transition: fadeT }}
      transition={fresh ? { ...spring, delay: index * 0.03 } : spring}
      aria-hidden={going || undefined}
    >
      <AnimatePresence initial={false}>
        {!open && Array.from({ length: peeks }, (_, i) => (
          <motion.span
            key={i} className="dirb-deck-peek" data-i={i + 1} aria-hidden
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: fadeT }}
            transition={fadeT}
          />
        ))}
      </AnimatePresence>
      <div
        className="dirb-mob-card"
        data-card data-family={g.family} data-shape={shape}
        data-form="deck"
        data-density="card"
        data-raised={raised(g.latest.severity)}
        data-unread={unread}
        onClick={onToggle}
      >
        <Headline shape={shape} word={groupStateWord(g.count, g.family)} subject={subjectFor(g.latest)} big />
        <AnimatePresence initial={false}>
          {!open && latest && (
            <motion.span
              key="latest" className="dirb-mob-detail ds-t-body dirb-clamp2"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: fadeT }}
              transition={fadeT}
            >{latest}</motion.span>
          )}
        </AnimatePresence>
        <div className="dirb-mob-foot">
          <TenantChip tenant={g.latest.tenant} />
          <span className="ds-t-mono">
            latest {new Date(g.lastSeenAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}
          </span>
          <span className="dirb-grow" />
          <span className="dirb-deck-count ds-t-mono">
            <Icon name="layers" size={16} />
            {g.items.length}
          </span>
          <Button
            variant="quiet" size="sm" data-tap aria-expanded={open}
            onClick={e => { e.stopPropagation(); onToggle() }}
          >{open ? 'Hide these' : 'Show each one'}</Button>
        </div>
        <IconButton
          icon="close" label="Dismiss all" size="sm" className="dirb-mob-x" data-tap
          onClick={e => { e.stopPropagation(); setResolved(true); onDismissAll() }}
        />
        <AnimatePresence>
          {resolved && (
            <motion.span
              className="dirb-mob-tick" aria-hidden
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, transition: fadeT }}
              transition={spring}
            >
              <Icon name="check" size={24} />
            </motion.span>
          )}
        </AnimatePresence>
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            className="dirb-mob-deck-rows"
            initial="hidden" animate="show" exit="hidden"
            variants={{ hidden: {}, show: { transition: { staggerChildren: 0.03 } } }}
          >
            {g.items.map(item => (
              <motion.div
                key={item.id}
                variants={{ hidden: { opacity: 0 }, show: { opacity: 1, transition: fadeT } }}
              >
                <NotificationCard n={item} onOpen={onOpen} onDismiss={onDismissOne} nested />
              </motion.div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
