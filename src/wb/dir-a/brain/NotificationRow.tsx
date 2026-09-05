/* ==========================================================================
   src/wb/dir-a/brain/NotificationRow.tsx: S28.

   03-DIRECTION move 1: TWO DENSITIES IN ONE LEDGER. A system event is one
   quiet hairline row with a mono state word and a mono time. A human event .
   a reply, a comment, a booking, an answer to go back into. takes the fuller
   row, with its payload quoted inset and its one action inline on the row.

   Move 2: actor · verb · object as the headline. The state word and the
   subject stay exactly as the old card said them (`stateWord`, `subjectFor`),
   because a state word standing alone is not a notification.

   Moves 6 and 7: a cluster is a grouped ledger, not a physical deck. The
   collapsed header names the count AND the kind (`groupStateWord`), and the
   children reveal under it. The peeked edges are gone; the count is not.

   Move 8: the swipe path and the dismiss control both survive, and a row
   resolves in place before it leaves.
   ========================================================================== */
import { AnimatePresence, motion } from 'motion/react'
import { Button, Icon, IconButton, fadeT, list, rise, spring } from '../../../ds'
import { Row, Rows, Sep } from '../kit'
import type { Notification, NotificationGroup } from '../../../lib/turns'
import { groupStateWord, severityShape, stateWord } from '../../../exp/brain/b/families'
import {
  dayWord, detailLine, formFor, pageCard, quoteCard, raised, rowLine, subjectFor,
} from '../../../exp/brain/b/skins/b/forms'
import { Mark, TenantChip, clock, isRunningWord, laneLabel, useSwipe } from './parts'
import './brain.css'

/** The DOM hooks the run's evidence harness reads are kept as data attributes:
 * this direction changes the shape of a row, not the vocabulary the
 * instruments use to find one. */
function sevOf(shape: 'square' | 'bar' | 'dot'): 'attention' | 'urgent' | undefined {
  return shape === 'bar' ? 'urgent' : shape === 'square' ? 'attention' : undefined
}

export function NotificationRow({ n, onOpen, onDismiss, nested = false, going = false }: {
  n: Notification
  onOpen: (n: Notification) => void
  onDismiss: (id: string) => void
  nested?: boolean
  /** The row is on its way out: it resolves in place before it leaves. */
  going?: boolean
}) {
  const swipe = useSwipe(() => onDismiss(n.id))
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
          onClick={() => onOpen(n)}
          tail={<span className="a-mono">{time}</span>}
          actions={<IconButton icon="close" label="Dismiss" size="sm" onClick={e => { e.stopPropagation(); onDismiss(n.id) }} />}
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
    ? <Button variant="quiet" size="sm" iconEnd="next" onClick={e => { e.stopPropagation(); onOpen(n) }}>Pick this up</Button>
    : lane
      ? (
        <Button variant="quiet" size="sm" iconEnd="next" onClick={e => { e.stopPropagation(); onOpen(n) }}>
          {form === 'quote' ? 'Reply' : form === 'time' ? 'Open' : lane}
        </Button>
      )
      : null

  return (
    <div className="a-brain-slot" data-card data-family={n.family} data-shape={shape}>
      <div className="a-brain-reveal" aria-hidden>Dismiss</div>
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
          actions={<IconButton icon="close" label="Dismiss" size="sm" onClick={e => { e.stopPropagation(); onDismiss(n.id) }} />}
          sev={sevOf(shape)}
          unread={unread}
          onClick={() => onOpen(n)}
        >
          {payload}
        </Row>
      </motion.div>
    </div>
  )
}

/**
 * A cluster. The header names the count and the kind; tapping it reveals the
 * children under it with the list stagger. Every row inside keeps its own
 * dismiss, and the header keeps the one that clears the lot.
 */
export function GroupRow({ g, open, onToggle, onOpen, onDismissAll, onDismissOne }: {
  g: NotificationGroup
  open: boolean
  onToggle: () => void
  onOpen: (n: Notification) => void
  onDismissAll: () => void
  onDismissOne: (id: string) => void
}) {
  const shape = severityShape(g.latest.severity)
  const unread = g.unread > 0
  const latest = rowLine(g.latest)
  const time = clock(g.lastSeenAt)
  return (
    <div className="a-brain-deck" data-group data-family={g.family}>
      <Row
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
    </div>
  )
}
