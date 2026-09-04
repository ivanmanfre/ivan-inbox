import { useRef, useState } from 'react'
import type { Notification, NotificationGroup } from '../../../../../lib/turns'
import {
  FAMILY_LANE, familyLabel, groupStateWord, sanitizeBody, severityShape, stateWord,
} from '../../families'
import { JOB_LABEL } from '../../../../v2c/layout'
import { dayWord, formFor, pageCard, quoteCard, raised, tileCard, timeCard } from './forms'

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
 * The state line every form leads with: the mark, then the short word for what
 * changed. It sits OUTSIDE the card's quote / snippet / body element on
 * purpose — a card has to name its own state with its detail hidden.
 */
function StateLine({ shape, word, big = false }: { shape: 'square' | 'bar' | 'dot'; word: string; big?: boolean }) {
  return (
    <div className={`bbf-state${big ? ' bbf-state-big' : ''}`}>
      <Mark shape={shape} />
      <span className="bb-card-word">{word}</span>
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

export function NotificationCard({ n, onOpen, onDismiss, nested = false }: {
  n: Notification
  onOpen: (n: Notification) => void
  onDismiss: (id: string) => void
  nested?: boolean
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
    const line = n.body ? sanitizeBody(n.body).slice(0, 120) : stateWord(n)
    return (
      <div
        className={`bb-card bb-nested bbf-deck-row${unread ? ' unread' : ''}`}
        data-card data-family={n.family}
        onClick={() => onOpen(n)}
      >
        <span className="bbf-rowline">{line}</span>
        <span className="bbf-rowtime">{time}</span>
      </div>
    )
  }

  const foot = (extra?: React.ReactNode) => (
    <div className="bbf-foot">
      <TenantChip tenant={n.tenant} />
      <span className="bbf-time">{time}</span>
      {extra}
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

  let inner: React.ReactNode
  if (form === 'quote') {
    const { quote, subject } = quoteCard(n)
    inner = (
      <>
        <StateLine shape={shape} word={stateWord(n)} />
        {quote && <blockquote className="bbf-quote">{quote}</blockquote>}
        {subject && <span className="bbf-who">{subject}</span>}
        {foot()}
      </>
    )
  } else if (form === 'time') {
    const { who } = timeCard(n)
    inner = (
      <>
        <StateLine shape={shape} word={stateWord(n)} />
        <div className="bbf-time-block">
          <span className="bbf-time-l">
            <span className="bbf-day">{dayWord(n.last_seen_at || n.created_at)}</span>
            <span className="bbf-fig">{time}</span>
          </span>
          <span className="bbf-time-r">
            <span className="bbf-who">{who ?? familyLabel(n.family)}</span>
          </span>
        </div>
        {foot()}
      </>
    )
  } else if (form === 'strip') {
    inner = (
      <div className="bbf-strip-row">
        <span className="bb-card-word bbf-one">{stateWord(n)}</span>
        <span className="bbf-time">{time}</span>
        {lane && (
          <button
            type="button" className="bbf-act" data-tap
            onClick={e => { e.stopPropagation(); onOpen(n) }}
          >{lane}</button>
        )}
      </div>
    )
  } else if (form === 'page') {
    const { state, snippet, asked } = pageCard(n)
    inner = (
      <>
        <StateLine shape={shape} word={state} />
        {snippet && <div className="bbf-page"><p>{snippet}</p></div>}
        {asked && <span className="bbf-asked">You asked: {asked}</span>}
        {foot()}
      </>
    )
  } else {
    const { label, state } = tileCard(n)
    inner = (
      <>
        <div className="bbf-tile">
          <span className="bbf-state">
            <Mark shape={shape} />
            <span className="bbf-label">{label}</span>
          </span>
          <span className="bb-card-word bbf-tile-state">{state}</span>
        </div>
        {foot()}
      </>
    )
  }

  return (
    <div className={`bbf-row${swipe.open ? ' swiping' : ''}`}>
      <div className="bbf-reveal" aria-hidden>Dismiss</div>
      <div
        className={`bb-card bbf bbf-${form}${raised(n.severity) ? ' bbf-raised' : ' bbf-flat'}${unread ? ' unread' : ''}`}
        data-card data-family={n.family} data-shape={shape}
        style={swipe.style}
        onClick={() => onOpen(n)}
        onTouchStart={swipe.onTouchStart} onTouchMove={swipe.onTouchMove}
        onTouchEnd={swipe.onTouchEnd} onTouchCancel={swipe.onTouchCancel}
      >
        {form === 'strip' && <span className="bbf-bar" aria-hidden />}
        {inner}
        <button
          type="button" className="bbf-x" data-tap aria-label="Dismiss"
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
  const latest = g.latest.body ? sanitizeBody(g.latest.body).slice(0, 120) : null
  return (
    <div className={`bbf-deck${open ? ' open' : ''}`} data-group data-family={g.family}>
      <div className="bbf-deck-back" aria-hidden />
      <div
        className={`bb-card bbf bbf-deck-card${raised(g.latest.severity) ? ' bbf-raised' : ' bbf-flat'}${unread ? ' unread' : ''}`}
        data-card data-family={g.family} data-shape={shape}
        onClick={onToggle}
      >
        <StateLine shape={shape} word={groupStateWord(g.count, g.family)} big />
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
          type="button" className="bbf-x" data-tap aria-label="Dismiss all"
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
