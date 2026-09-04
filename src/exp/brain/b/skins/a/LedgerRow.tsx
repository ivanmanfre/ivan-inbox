import { useRef, useState } from 'react'
import type { Notification, NotificationGroup } from '../../../../../lib/turns'
import { FAMILY_LANE, groupStateWord, severityShape } from '../../families'
import { JOB_LABEL } from '../../../../v2c/layout'
import { nestedForm, rowForm, type RowForm } from './rowForm'
import { Glyph } from './icons'

// ---------------------------------------------------------------------------
// One row of the ledger. No box, no border, no slab: a mark in a fixed left
// column, the state word at the one display size, one line of evidence in the
// form the family calls for, and a quiet meta line. The severity SHAPE is drawn
// first and the colour only repeats what the shape said.
//
// Every element the E5 seat is allowed to hide (`.bb-a-detail`, which carries
// the legacy `bb-card-body` name the evidence harness clicks) sits BELOW the
// state word and the figure, never around them.
// ---------------------------------------------------------------------------

const clock = (iso: string): string =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })

/** The producer, in one word, off the row's own columns. Never guessed from body text. */
function producerOf(n: Notification): string | null {
  const t = n.tenant
  if (t) return /rise/i.test(t) ? 'RISE' : /arch/i.test(t) ? 'ARCH' : /ivan/i.test(t) ? 'Mine' : t
  if (n.family === 'claude_turn') return 'Claude'
  if (n.family === 'system_infra_alarm' || n.family === 'system_watchdog_digest') return 'System'
  return null
}

function laneLabel(family: string): string | null {
  const lane = FAMILY_LANE[family as keyof typeof FAMILY_LANE]
  return lane ? `Open in ${JOB_LABEL[lane]}` : null
}

const SWIPE_OPEN = 96
const SWIPE_SETTLE = 88
const AXIS_LOCK = 8

/** A left drag that reveals the dismiss affordance, and releases into it. */
function useSwipe(onDismiss: () => void) {
  const start = useRef<{ x: number; y: number; axis: 'none' | 'x' | 'y' } | null>(null)
  const [dx, setDx] = useState(0)
  const [leaving, setLeaving] = useState(false)

  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length !== 1 || leaving) return
    start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, axis: 'none' }
  }
  const onTouchMove = (e: React.TouchEvent) => {
    const s = start.current
    if (!s) return
    const mx = e.touches[0].clientX - s.x
    const my = e.touches[0].clientY - s.y
    if (s.axis === 'none') {
      if (Math.abs(mx) < AXIS_LOCK && Math.abs(my) < AXIS_LOCK) return
      // A list being scrolled owns the gesture, and a RIGHT drag belongs to the
      // sheet behind this row, not to a dismiss that only goes one way.
      s.axis = Math.abs(mx) > Math.abs(my) && mx < 0 ? 'x' : 'y'
      if (s.axis === 'y') { start.current = null; setDx(0); return }
    }
    e.stopPropagation()
    setDx(Math.max(-140, Math.min(0, mx)))
  }
  const onTouchEnd = () => {
    const s = start.current
    start.current = null
    if (!s || s.axis !== 'x') { setDx(0); return }
    if (Math.abs(dx) >= SWIPE_SETTLE) { setDx(-SWIPE_OPEN); setLeaving(true) }
    else setDx(0)
  }
  return {
    dx, leaving, setLeaving,
    bind: { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel: onTouchEnd },
    fire: () => setLeaving(true),
    onAnimationEnd: (e: React.AnimationEvent) => {
      if (e.animationName === 'bb-a-exit') onDismiss()
    },
  }
}

function RowBody({ form, meta }: { form: RowForm; meta: React.ReactNode }) {
  return (
    <>
      <div className="bb-a-state">
        <span className="bb-card-word bb-a-word">{form.word}</span>
        {form.subject && <span className="bb-a-subject">{form.subject}</span>}
      </div>
      {form.figure && (
        <div className="bb-a-fig">
          <b>{form.figure.n}</b><span>{form.figure.noun}</span>
        </div>
      )}
      {form.detail && (
        <div className={`bb-a-detail bb-card-body bb-a-${form.kind}`} data-detail>{form.detail}</div>
      )}
      {meta}
    </>
  )
}

export function LedgerRow({ n, onOpen, onDismiss, nested = false }: {
  n: Notification
  onOpen: (n: Notification) => void
  onDismiss: (id: string, height: number) => void
  nested?: boolean
}) {
  const el = useRef<HTMLDivElement>(null)
  const form = nested ? nestedForm(n) : rowForm(n)
  const shape = severityShape(n.severity)
  const unread = !n.read_at
  const lane = form.kind === 'line' ? laneLabel(n.family) : null
  const producer = producerOf(n)
  const swipe = useSwipe(() => onDismiss(n.id, el.current?.getBoundingClientRect().height ?? 0))

  const meta = (
    <div className="bb-a-meta">
      {producer && <span className="bb-a-who">{producer}</span>}
      {producer && <span aria-hidden>·</span>}
      <span>{clock(n.last_seen_at || n.created_at)}</span>
      {lane && (
        <button
          type="button" className="bb-card-open bb-a-lane"
          onClick={e => { e.stopPropagation(); onOpen(n) }}
        >{lane}</button>
      )}
      {form.kind === 'answer' && (
        <button
          type="button" className="bb-a-resume"
          onClick={e => { e.stopPropagation(); onOpen(n) }}
        >Resume this thread ›</button>
      )}
    </div>
  )

  return (
    <div className="bb-a-swipe">
      <div className="bb-a-reveal" aria-hidden>Dismiss</div>
      <div
        ref={el}
        className={`bb-card bb-a-row${unread ? ' unread' : ''}${nested ? ' bb-nested bb-a-nested' : ''}${swipe.leaving ? ' bb-a-leaving' : ''}`}
        data-card data-family={n.family} data-shape={nested ? undefined : shape} data-state={form.word}
        style={swipe.dx ? { transform: `translateX(${swipe.dx}px)`, transition: 'none' } : undefined}
        onClick={() => onOpen(n)}
        onAnimationEnd={swipe.onAnimationEnd}
        {...swipe.bind}
      >
        {!nested && <span className="bb-mark bb-a-mark" data-shape={shape}><i /></span>}
        <RowBody form={form} meta={meta} />
        <button
          type="button" className="bb-card-dismiss bb-a-x" aria-label="Dismiss"
          onClick={e => { e.stopPropagation(); swipe.fire() }}
        ><Glyph name="x" size={14} /></button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// A repeat folds to ONE row: the count lives inside the state word, the latest
// quote is the evidence, and the fold is an inline control on the meta line
// rather than a button block. Open, the children indent under the mark column,
// drop the mark and the wash, and each leads with its own words.
// ---------------------------------------------------------------------------
export function LedgerGroup({ g, open, onToggle, onOpen, onDismissAll, onDismissOne }: {
  g: NotificationGroup
  open: boolean
  onToggle: () => void
  onOpen: (n: Notification) => void
  onDismissAll: () => void
  onDismissOne: (id: string, height: number) => void
}) {
  const el = useRef<HTMLDivElement>(null)
  const shape = severityShape(g.latest.severity)
  const unread = g.unread > 0
  const latest = rowForm(g.latest)
  const producer = producerOf(g.latest)
  const swipe = useSwipe(onDismissAll)

  return (
    <div className={`bb-group bb-a-group${open ? ' open' : ''}`} data-group data-family={g.family}>
      <div className="bb-a-swipe">
        <div className="bb-a-reveal" aria-hidden>Dismiss</div>
        <div
          ref={el}
          className={`bb-card bb-a-row${unread ? ' unread' : ''}${swipe.leaving ? ' bb-a-leaving' : ''}`}
          data-card data-family={g.family} data-shape={shape} data-state={groupStateWord(g.count, g.family)}
          style={swipe.dx ? { transform: `translateX(${swipe.dx}px)`, transition: 'none' } : undefined}
          onClick={onToggle}
          onAnimationEnd={swipe.onAnimationEnd}
          {...swipe.bind}
        >
          <span className="bb-mark bb-a-mark" data-shape={shape}><i /></span>
          <div className="bb-a-state">
            <span className="bb-card-word bb-a-word">{groupStateWord(g.count, g.family)}</span>
          </div>
          {!open && latest.detail && (
            <div className={`bb-a-detail bb-card-body bb-a-${latest.kind}`} data-detail>{latest.detail}</div>
          )}
          <div className="bb-a-meta">
            {producer && <span className="bb-a-who">{producer}</span>}
            {producer && <span aria-hidden>·</span>}
            <span>{clock(g.lastSeenAt)}</span>
            <button
              type="button" className="bb-group-toggle bb-a-fold" aria-expanded={open}
              onClick={e => { e.stopPropagation(); onToggle() }}
            >{open ? 'Hide these ⌃' : 'Show each one ⌄'}</button>
          </div>
          <button
            type="button" className="bb-card-dismiss bb-a-x" aria-label="Dismiss all"
            onClick={e => { e.stopPropagation(); swipe.fire() }}
          ><Glyph name="x" size={14} /></button>
        </div>
      </div>
      {open && g.items.map(item => (
        <LedgerRow key={item.id} n={item} onOpen={onOpen} onDismiss={onDismissOne} nested />
      ))}
    </div>
  )
}
