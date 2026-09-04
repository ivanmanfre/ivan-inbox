import { useRef, useState } from 'react'
import type { Notification, NotificationGroup } from '../../../../../lib/turns'
import {
  FAMILY_LANE, groupStateWord, severityShape, stateWord,
} from '../../families'
import { JOB_LABEL } from '../../../../v2c/layout'
import { dayWord, detailLine, formFor, pageCard, quoteCard, raised, rowLine, subjectFor } from './forms'

// A card whose SHAPE says what it is before a word is read. See forms.ts for
// which family takes which form and why, and skin.css for how each one is
// drawn. The DOM hooks the run's evidence harness reads (`data-card`,
// `data-family`, `data-shape`, `.bb-card`, `.bb-card-word`, `.bb-mark`,
// `.bb-nested`, `.bb-group-toggle`) are kept byte-identical to plain B: this
// skin changes the shape of the card, not the vocabulary the instruments use
// to find it.

const clock = (iso: string): string =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })

function TenantChip({ tenant }: { tenant: string | null }) {
  if (!tenant) return null
  const label = /rise/i.test(tenant) ? 'RISE' : /arch/i.test(tenant) ? 'ARCH' : /ivan/i.test(tenant) ? 'Mine' : tenant
  return <span className="bb-tenant">{label}</span>
}

function laneLabel(family: string): string | null {
  const lane = FAMILY_LANE[family as keyof typeof FAMILY_LANE]
  return lane ? JOB_LABEL[lane] : null
}

/** The severity mark: a filled square (needs you), a solid bar (an error), a
 * hollow ring (information). Shape carries it; colour only agrees. */
function Mark({ shape }: { shape: 'square' | 'bar' | 'dot' }) {
  return <span className="bb-mark bbf-mark" data-shape={shape}><i /></span>
}

/**
 * The headline every form leads with: the mark, the short word for what
 * changed, and WHO OR WHAT it happened to, in the card's own largest type.
 *
 * Cycle 1. Three seats named the same defect on the same cards: an error strip
 * that printed "Send failed" and nothing else, a tile that printed "Progress".
 * A bare verb is not a notification. The subject joins the state word here
 * rather than sitting on a line of its own, so the card still answers "what
 * changed, to whom" in one glance and with its detail element hidden.
 */
function Headline({ shape, word, subject, big = false }: {
  shape: 'square' | 'bar' | 'dot'; word: string; subject?: string | null; big?: boolean
}) {
  return (
    <div className={`bbf-state bb-card-body${big ? ' bbf-state-big' : ''}`}>
      <Mark shape={shape} />
      <span className="bb-card-word">{word}</span>
      {subject && <><span className="bbf-dot" aria-hidden>·</span><span className="bbf-subj">{subject}</span></>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Swipe to dismiss. The card follows the finger with its transition suppressed
// and only the release settles; past a third of the card's width it leaves.
// LEFT only: a right drag inside an open feed belongs to the sheet, which is
// the surface behind this one, and two gestures on one axis is one gesture too
// many. The ✕ stays for anyone who would rather press a button.
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
    // own handler locked x, clamped its travel to zero and dropped the
    // `bb-inert` guard off the place underneath for the length of the swipe.
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

export function NotificationCard({ n, onOpen, onDismiss, nested = false, slotClass = '' }: {
  n: Notification
  onOpen: (n: Notification) => void
  onDismiss: (id: string) => void
  nested?: boolean
  /** The feed's own enter/leave classes, applied to the row this component
   * owns rather than to a wrapper around it: the evidence harness reaches a
   * card through `.bb-feed-body > [data-card]`, a direct child. */
  slotClass?: string
}) {
  const swipe = useSwipe(() => onDismiss(n.id))
  const shape = severityShape(n.severity)
  const form = formFor(n.family)
  const lane = laneLabel(n.family)
  const unread = !n.read_at
  const time = clock(n.last_seen_at || n.created_at)

  // A row inside an expanded deck answers "which one of these", so it drops the
  // mark, the form and the state the parent card has already said, and leads
  // with its own sentence.
  if (nested) {
    // A deck exists so he can clear the one he has dealt with and leave the
    // rest. The row keeps its own dismiss and its own swipe; it drops only the
    // mark and the state the parent card has already said.
    return (
      <div
        className={`bb-card bb-nested bbf-deck-row${unread ? ' unread' : ''}`}
        data-card data-family={n.family}
        style={swipe.style}
        onClick={() => onOpen(n)}
        onTouchStart={swipe.onTouchStart} onTouchMove={swipe.onTouchMove}
        onTouchEnd={swipe.onTouchEnd} onTouchCancel={swipe.onTouchCancel}
      >
        <span className="bb-card-body bbf-rowline">{rowLine(n)}</span>
        <span className="bbf-rowtime">{time}</span>
        <button
          type="button" className="bb-card-dismiss bbf-x bbf-x-row" data-tap aria-label="Dismiss"
          onClick={e => { e.stopPropagation(); onDismiss(n.id) }}
        >✕</button>
      </div>
    )
  }

  const foot = (opts?: { clock?: boolean }) => (
    <div className="bbf-foot">
      <TenantChip tenant={n.tenant} />
      {/* The time block already prints this clock as its figure; a second copy
          three lines under it was one of the panel's craft findings. */}
      {opts?.clock !== false && <span className="bbf-time">{time}</span>}
      <span className="bbf-sp" />
      {lane && (
        <button
          type="button" className="bbf-act" data-tap
          onClick={e => { e.stopPropagation(); onOpen(n) }}
        >{form === 'quote' ? 'Reply' : form === 'time' ? 'Open' : lane}</button>
      )}
      {form === 'page' && (
        <button
          type="button" className="bbf-act" data-tap
          onClick={e => { e.stopPropagation(); onOpen(n) }}
        >Pick this up</button>
      )}
    </div>
  )

  const subject = subjectFor(n)

  let inner: React.ReactNode
  if (form === 'quote') {
    const { quote } = quoteCard(n)
    inner = (
      <>
        <Headline shape={shape} word={stateWord(n)} subject={subject} />
        {quote && <blockquote className="bbf-quote">{quote}</blockquote>}
        {foot()}
      </>
    )
  } else if (form === 'time') {
    const detail = detailLine(n.body, `${stateWord(n)} ${subject ?? ''}`, 90)
    inner = (
      <>
        <Headline shape={shape} word={stateWord(n)} subject={subject} />
        <div className="bbf-time-block">
          <span className="bbf-time-l">
            <span className="bbf-day">{dayWord(n.last_seen_at || n.created_at)}</span>
            <span className="bbf-fig">{time}</span>
          </span>
          {detail && <span className="bbf-time-r">{detail}</span>}
        </div>
        {foot({ clock: false })}
      </>
    )
  } else if (form === 'strip') {
    const line = detailLine(n.body, `${stateWord(n)} ${subject ?? ''}`)
    inner = (
      <>
        <Headline shape={shape} word={stateWord(n)} subject={subject} />
        {line && <span className="bbf-stripline">{line}</span>}
        {foot()}
      </>
    )
  } else if (form === 'page') {
    const { state, snippet, asked } = pageCard(n)
    inner = (
      <>
        <Headline shape={shape} word={state} subject={subject} />
        {snippet && <div className="bbf-page"><p>{snippet}</p></div>}
        {asked && <span className="bbf-asked">You asked: {asked}</span>}
        {foot()}
      </>
    )
  } else {
    inner = (
      <>
        <Headline shape={shape} word={stateWord(n)} subject={subject} />
        {foot()}
      </>
    )
  }

  return (
    <div
      className={`bbf-slot bbf-row${slotClass ? ` ${slotClass}` : ''}${swipe.open ? ' swiping' : ''}`}
      data-card data-family={n.family} data-shape={shape}
    >
      <div className="bbf-reveal" aria-hidden>Dismiss</div>
      <div
        className={`bb-card bbf bbf-${form}${raised(n.severity) ? ' bbf-raised' : ' bbf-flat'}${unread ? ' unread' : ''}`}
        style={swipe.style}
        onClick={() => onOpen(n)}
        onTouchStart={swipe.onTouchStart} onTouchMove={swipe.onTouchMove}
        onTouchEnd={swipe.onTouchEnd} onTouchCancel={swipe.onTouchCancel}
      >
        {form === 'strip' && <span className="bbf-edge" aria-hidden />}
        {inner}
        <button
          type="button" className="bb-card-dismiss bbf-x" data-tap aria-label="Dismiss"
          onClick={e => { e.stopPropagation(); onDismiss(n.id) }}
        >✕</button>
      </div>
    </div>
  )
}

/**
 * A stacked deck: the top card of the family with a visible second edge behind
 * it and the count as its state word. Tapping fans it open, the edge becomes
 * the first row, and the rows stack under the parent at full width.
 */
export function GroupCard({ g, open, onToggle, onOpen, onDismissAll, onDismissOne }: {
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
  return (
    <div className={`bbf-deck${open ? ' open' : ''}`} data-group data-family={g.family}>
      <div className="bbf-deck-back" aria-hidden />
      <div
        className={`bb-card bbf bbf-deck-card${raised(g.latest.severity) ? ' bbf-raised' : ' bbf-flat'}${unread ? ' unread' : ''}`}
        data-card data-family={g.family} data-shape={shape}
        onClick={onToggle}
      >
        <Headline shape={shape} word={groupStateWord(g.count, g.family)} subject={subjectFor(g.latest)} big />
        {!open && latest && <span className="bbf-body">{latest}</span>}
        <div className="bbf-foot">
          <TenantChip tenant={g.latest.tenant} />
          <span className="bbf-time">latest {new Date(g.lastSeenAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}</span>
          <span className="bbf-sp" />
          <button
            type="button" className="bb-group-toggle bbf-act" data-tap aria-expanded={open}
            onClick={e => { e.stopPropagation(); onToggle() }}
          >{open ? 'Hide these' : 'Show each one'}</button>
        </div>
        <button
          type="button" className="bb-card-dismiss bbf-x" data-tap aria-label="Dismiss all"
          onClick={e => { e.stopPropagation(); onDismissAll() }}
        >✕</button>
      </div>
      {open && (
        <div className="bbf-deck-rows">
          {g.items.map(item => (
            <NotificationCard key={item.id} n={item} onOpen={onOpen} onDismiss={onDismissOne} nested />
          ))}
        </div>
      )}
    </div>
  )
}
