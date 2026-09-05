/* ==========================================================================
   src/wb/ask/NotificationRow.tsx: S28.

   03-DIRECTION move 1: TWO DENSITIES IN ONE LEDGER. A system event is one
   quiet hairline row with a mono state word and a mono time. A human event .
   a reply, a comment, a booking, an answer to go back into. takes the fuller
   row, with its payload quoted inset and its one action inline on the row.

   Move 2: actor · verb · object as the headline. The state word and the
   subject stay exactly as the old card said them (`stateWord`, `subjectFor`),
   because a state word standing alone is not a notification.

   Moves 6 and 7: a cluster is a PHYSICAL DECK. Behind the front card sit up to
   three peeked edges, each one a real row that is really under there, so the
   count is visible before it is read; the header still names the count AND the
   kind (`groupStateWord`); an overlapping run of severity marks says what kind
   of thing each one is; and the fan is a layout spring, the children arriving
   on the 30ms stagger.

   Move 8: the swipe path and the dismiss control both survive, a row resolves
   in place before it leaves, and the toast that follows carries a real Undo
   (`Feed.tsx` → `feed.restore` → `restoreNotifications`).
   ========================================================================== */
import { useRef } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Button, Icon, IconButton, fadeT, list, rise, spring } from '../../ds'
import { Row, Rows, Sep } from '../kit'
import type { Notification, NotificationGroup } from '../../lib/turns'
import { groupStateWord, severityShape, stateWord } from '../../exp/brain/b/families'
import {
  dayWord, detailLine, formFor, pageCard, quoteCard, raised, rowLine, subjectFor,
} from '../../exp/brain/b/skins/b/forms'
import { Mark, TenantChip, clock, isRunningWord, laneLabel, useSwipe } from './parts'
import './ask.css'

/** The DOM hooks the run's evidence harness reads are kept as data attributes:
 * this direction changes the shape of a row, not the vocabulary the
 * instruments use to find one. */
function sevOf(shape: 'square' | 'bar' | 'dot'): 'attention' | 'urgent' | undefined {
  return shape === 'bar' ? 'urgent' : shape === 'square' ? 'attention' : undefined
}

export function NotificationRow({ n, onOpen, onDismiss, nested = false, going = false }: {
  n: Notification
  /** The row's own element rides along: move 9 grows the answer out of the
   * rectangle of the card that was actually tapped, and only the card knows it. */
  onOpen: (n: Notification, el: HTMLElement | null) => void
  /** The row travels with its id so the undo can put THIS row back without a refetch. */
  onDismiss: (id: string, row: Notification) => void
  nested?: boolean
  /** The row is on its way out: it resolves in place before it leaves. */
  going?: boolean
}) {
  const swipe = useSwipe(() => onDismiss(n.id, n))
  const box = useRef<HTMLDivElement>(null)
  const shape = severityShape(n.severity)
  const form = formFor(n.family)
  const lane = laneLabel(n.family)
  const unread = !n.read_at
  const time = clock(n.last_seen_at || n.created_at)

  // A row inside an expanded cluster answers "which one of these", so it drops
  // the mark, the form and the state the header has already said, and leads
  // with its own sentence. It keeps its own dismiss and its own swipe: a
  // cluster exists so he can clear the one he has dealt with and leave the rest.
  if (nested) {
    return (
      <motion.div
        ref={box}
        className="a-brain-swipe"
        data-card data-family={n.family}
        style={swipe.style}
        onTouchStart={swipe.onTouchStart} onTouchMove={swipe.onTouchMove}
        onTouchEnd={swipe.onTouchEnd} onTouchCancel={swipe.onTouchCancel}
        variants={rise}
      >
        <Row
          title={rowLine(n)}
          titleWrap
          unread={unread}
          onClick={() => onOpen(n, box.current)}
          tail={<span className="a-mono">{time}</span>}
          actions={<IconButton icon="close" label="Dismiss" size="sm" onClick={e => { e.stopPropagation(); onDismiss(n.id, n) }} />}
        />
      </motion.div>
    )
  }

  const word = form === 'page' ? pageCard(n).state : stateWord(n)
  const subject = subjectFor(n)
  const running = isRunningWord(word)
  // Move 1's two densities. A human event carries someone's words or somebody's
  // time; those are the rows that get the payload inset. A card that needs him
  // (`raised`) is read the same way: it is not a quieter row.
  const full = form === 'quote' || form === 'time' || form === 'page' || raised(n.severity)

  let payload: React.ReactNode = null
  if (form === 'quote') {
    const { quote } = quoteCard(n)
    if (quote) payload = <blockquote className="a-quote">{quote}</blockquote>
  } else if (form === 'time') {
    const detail = detailLine(n.body, `${word} ${subject ?? ''}`, 90)
    payload = (
      <div className="a-brain-payload">
        <span className="a-brain-timeblock">
          <span className="a-brain-day-w">{dayWord(n.last_seen_at || n.created_at)}</span>
          <span className="a-figure-t">{time}</span>
        </span>
        {detail && <span className="a-body-t">{detail}</span>}
      </div>
    )
  } else if (form === 'strip') {
    const line = detailLine(n.body, `${word} ${subject ?? ''}`)
    if (line) payload = <span className="a-body-t a-clamp">{line}</span>
  } else if (form === 'page') {
    const { snippet, asked } = pageCard(n)
    payload = (
      <div className="a-brain-payload">
        {snippet && <blockquote className="a-quote a-clamp" data-lines="3">{snippet}</blockquote>}
        {asked && <span className="a-brain-asked a-nowrap">You asked: {asked}</span>}
      </div>
    )
  }

  const action = form === 'page'
    ? <Button variant="quiet" size="sm" iconEnd="next" onClick={e => { e.stopPropagation(); onOpen(n, box.current) }}>Pick this up</Button>
    : lane
      ? (
        <Button variant="quiet" size="sm" iconEnd="next" onClick={e => { e.stopPropagation(); onOpen(n, box.current) }}>
          {form === 'quote' ? 'Reply' : form === 'time' ? 'Open' : lane}
        </Button>
      )
      : null

  return (
    <div ref={box} className="a-brain-slot" data-contained data-card data-family={n.family} data-shape={shape}>
      {/* What the swipe reveals, and ONLY while a finger is on the row. The
          B-2 graft made the card's own layer transparent so the container's
          fill shows through it, which meant this word was legible under every
          card at rest: a second Dismiss on every row, in the severity colour,
          for a gesture nobody was making. */}
      {swipe.open && <div className="a-brain-reveal" aria-hidden>Dismiss</div>}
      <motion.div
        className="a-brain-swipe"
        style={swipe.style}
        onTouchStart={swipe.onTouchStart} onTouchMove={swipe.onTouchMove}
        onTouchEnd={swipe.onTouchEnd} onTouchCancel={swipe.onTouchCancel}
      >
        <Row
          lead={<Mark shape={shape} />}
          title={
            <>
              <span className={running ? 'a-brain-state a-working' : 'a-brain-state'} data-live={running ? '' : undefined}>{word}</span>
              {subject && <><Sep /><span className={full ? 'a-ink' : undefined}>{subject}</span></>}
            </>
          }
          titleWrap
          meta={
            <>
              <TenantChip tenant={n.tenant} />
              <span>{time}</span>
            </>
          }
          tail={going ? <span className="a-brain-going"><Icon name="check" size={16} />Dismiss</span> : action}
          actions={<IconButton icon="close" label="Dismiss" size="sm" onClick={e => { e.stopPropagation(); onDismiss(n.id, n) }} />}
          sev={sevOf(shape)}
          unread={unread}
          onClick={() => onOpen(n, box.current)}
        >
          {payload}
        </Row>
      </motion.div>
    </div>
  )
}

/**
 * Move 7's overlapping run. One mark per item in the cluster, capped at four,
 * each carrying THAT item's own severity shape, overlapped so the run reads as
 * a stack rather than a list. It says what kind of things are under the front
 * card without opening it, and it survives greyscale because the shape is the
 * signal (SYSTEM §1).
 */
function MarkStack({ items }: { items: Notification[] }) {
  const shown = items.slice(0, 4)
  return (
    <span className="a-brain-stack" aria-hidden="true">
      {shown.map(i => (
        <span className="a-brain-stack-i" key={i.id}><Mark shape={severityShape(i.severity)} /></span>
      ))}
    </span>
  )
}

/**
 * A cluster, as a physical deck (move 6).
 *
 * Collapsed, up to three peeked edges sit behind the front card, each stepped
 * down and in, so the depth of the pile is the count. Tapping fans it: the
 * peeks leave, the front card stays where it is (`layout` on the deck, one
 * spring), and the children arrive under it on the 30ms stagger.
 *
 * The number of peeks is `count - 1` capped at three, so a deck of two shows
 * one edge and a deck of nine shows three. It is a depth cue, not a count —
 * the count is printed in words on the headline, which is where a number
 * belongs.
 *
 * Every row inside keeps its own dismiss and its own swipe; the header keeps
 * the one that clears the lot.
 */
export function GroupRow({ g, open, onToggle, onOpen, onDismissAll, onDismissOne }: {
  g: NotificationGroup
  open: boolean
  onToggle: () => void
  onOpen: (n: Notification, el: HTMLElement | null) => void
  onDismissAll: () => void
  onDismissOne: (id: string, row: Notification) => void
}) {
  const shape = severityShape(g.latest.severity)
  const unread = g.unread > 0
  const latest = rowLine(g.latest)
  const time = clock(g.lastSeenAt)
  const peeks = Math.min(3, Math.max(0, g.count - 1))
  return (
    <motion.div
      className="a-brain-deck" data-contained data-group data-family={g.family}
      data-open={open ? '' : undefined}
      layout transition={spring}
    >
      <div className="a-brain-deck-front">
        <Row
          className="a-brain-deck-head"
          lead={<Mark shape={shape} />}
          title={
            <>
              <span className="a-brain-state">{groupStateWord(g.count, g.family)}</span>
              {subjectFor(g.latest) && <><Sep /><span className="a-ink">{subjectFor(g.latest)}</span></>}
            </>
          }
          titleWrap
          sub={!open && latest ? latest : undefined}
          subWrap
          meta={
            <>
              <TenantChip tenant={g.latest.tenant} />
              <MarkStack items={g.items} />
              <span>latest {time}</span>
            </>
          }
          tail={
            <Button
              variant="quiet" size="sm" iconEnd={open ? 'discloseUp' : 'disclose'}
              aria-expanded={open}
              onClick={e => { e.stopPropagation(); onToggle() }}
            >{open ? 'Hide these' : 'Show each one'}</Button>
          }
          actions={<IconButton icon="close" label="Dismiss all" size="sm" onClick={e => { e.stopPropagation(); onDismissAll() }} />}
          sev={sevOf(shape)}
          unread={unread}
          selected={open}
          onClick={onToggle}
        />
      </div>
      {/* The pile. Each layer is the EDGE of a card that is really under there,
          narrowed by a step and tucked behind the front one, so the depth of
          the stack is the count before a word is read.

          Edges rather than whole cards on purpose: a full-height copy has to
          be clipped to the front card's box, and the container that clips it
          is the same one that draws the card's own border — so the pile either
          disappeared inside it or escaped it. An edge needs no height to
          match. */}
      <AnimatePresence initial={false}>
        {!open && peeks > 0 && (
          <motion.span
            className="a-brain-peeks" aria-hidden="true"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: fadeT }}
            exit={{ opacity: 0, transition: fadeT }}
          >
            {Array.from({ length: peeks }, (_, i) => (
              <span
                className="a-brain-peek" key={i}
                style={{ width: `${100 - (i + 1) * 5}%`, opacity: 1 - i * 0.25 }}
              />
            ))}
          </motion.span>
        )}
      </AnimatePresence>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            className="a-brain-deck-rows"
            variants={list}
            initial="hidden"
            animate="show"
            exit={{ opacity: 0, transition: fadeT }}
            transition={spring}
          >
            <Rows>
              {g.items.map(item => (
                <NotificationRow key={item.id} n={item} onOpen={onOpen} onDismiss={onDismissOne} nested />
              ))}
            </Rows>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
