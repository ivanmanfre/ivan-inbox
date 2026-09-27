import { useRef, useState, type ReactNode, type TouchEvent } from 'react'
import { FAMILY_LANE, groupStateWord, stateWord } from '../../exp/brain/b/families'
import type { Notification, NotificationGroup } from '../../lib/turns'
import { lookOf } from '../../wb/ask/alertLook'
import { detailLine, formFor, pageCard, quoteCard, subjectFor } from '../../wb/ask/forms'
import { PLACES } from '../places'
import { parseDHash, toDHash } from '../route'
import { DIcon, type DIconName } from '../ui/icons'
import { warsawDayWord, warsawHm } from '../ui/time'
import { cleanLine } from './feedShape'

// ---------------------------------------------------------------------------
// A BELL ROW, as today's feed card (wb/ask/NotificationRow) carried it, drawn
// in D: the state word + subject headline, the kind tile and label, the tenant,
// the "in chat" mark on a row Claude already wrote about, the payload (the
// person's words as a quote, a booking's time block, a page's "You asked"),
// the one action (Pick this up on a row that needs him or broke, Reply on a
// quote, Open on a time, else the place's name), × and, on the phone, swipe.
// A group opens to its members ("Show each one"), each with its own ×.
// ---------------------------------------------------------------------------

const KIND_ICON: Record<string, DIconName> = {
  needs_you: 'person', failed: 'alert', reply: 'dms', booking: 'time', reminder: 'time', done: 'check', seen: 'eye', digest: 'sum',
}
const KIND_TONE: Record<string, string> = { needs_you: 'd-k-hl', failed: 'd-k-bad', booking: 'd-k-hl' }
const TENANT: Record<string, string> = { arch: 'Arch', rise: 'Rise', risedtc: 'Rise', ivan: 'Ivan' }

/** A row Claude folded into a turn: `bot:<turn id>` (today's inChatTurnId). */
export function inChatTurnId(n: { group_key: string | null }): string | null {
  const k = n.group_key ?? ''
  return k.startsWith('bot:') ? k.slice(4) : null
}

/** The D place a family's lane lives in, by name (today's laneLabel, D's words). */
function placeLabel(family: string): string | null {
  const job = FAMILY_LANE[family as keyof typeof FAMILY_LANE]
  if (!job) return null
  const d = toDHash(`#exp/v2/${job}`)
  return d ? PLACES[parseDHash(d).place].label : null
}

/** The row's one action word, as today: needs him / broke / a page -> Pick this up. */
export function actionWord(n: Notification): string | null {
  const form = formFor(n.family)
  const kind = lookOf(n.family, n.severity).kind
  if (kind === 'needs_you' || kind === 'failed' || form === 'page') return 'Pick this up'
  const lane = placeLabel(n.family)
  if (!lane) return null
  return form === 'quote' ? 'Reply' : form === 'time' ? 'Open' : lane
}

function Payload({ n, word, subject }: { n: Notification; word: string; subject: string | null }) {
  const form = formFor(n.family)
  if (form === 'quote') {
    const quote = cleanLine(quoteCard(n).quote)
    return quote ? <blockquote className="d-fn-q">{quote}</blockquote> : null
  }
  if (form === 'time') {
    const detail = detailLine(n.body, `${word} ${subject ?? ''}`, 90)
    const at = n.last_seen_at || n.created_at
    return <span className="d-fn-tb"><b>{warsawDayWord(at)} {warsawHm(at)}</b>{detail && <small>{cleanLine(detail)}</small>}</span>
  }
  if (form === 'page') {
    const { snippet, asked } = pageCard(n)
    const snip = cleanLine(snippet)
    return <>{snip && <blockquote className="d-fn-q">{snip}</blockquote>}{asked && <small className="d-fn-asked">You asked: {asked}</small>}</>
  }
  const line = detailLine(n.body, `${word} ${subject ?? ''}`)
  return line ? <small>{cleanLine(line)}</small> : null
}

/** Swipe left past a third of the row to dismiss (phone), as today's feed. */
function useSwipe(onGone: () => void) {
  const start = useRef<{ x: number; y: number } | null>(null)
  const [dx, setDx] = useState(0)
  const width = useRef(320)
  return {
    style: dx ? { transform: `translateX(${dx}px)`, transition: 'none' } : undefined,
    open: dx < -8,
    onTouchStart: (e: TouchEvent) => { const t = e.touches[0]; start.current = { x: t.clientX, y: t.clientY }; width.current = (e.currentTarget as HTMLElement).offsetWidth || 320 },
    onTouchMove: (e: TouchEvent) => {
      const s = start.current; if (!s) return
      const t = e.touches[0]; const x = t.clientX - s.x
      if (Math.abs(t.clientY - s.y) > Math.abs(x)) { start.current = null; setDx(0); return }
      setDx(Math.min(0, x))
    },
    onTouchEnd: () => { const gone = dx < -width.current / 3; start.current = null; setDx(0); if (gone) onGone() },
  }
}

export function FeedRow({ n, onOpen, onDismiss, nested = false, primary = false, tail, headline }: {
  n: Notification; onOpen: (n: Notification) => void; onDismiss: (n: Notification) => void
  nested?: boolean; primary?: boolean; tail?: ReactNode
  /** A group's head: today's counted word ("3 replies") instead of the row's state word, and no action of its own. */
  headline?: string
}) {
  const swipe = useSwipe(() => onDismiss(n))
  const look = lookOf(n.family, n.severity)
  const word = formFor(n.family) === 'page' ? pageCard(n).state : stateWord(n)
  const subject = subjectFor(n)
  const tenant = TENANT[(n.tenant ?? '').toLowerCase()] ?? ''
  const act = nested || headline ? null : actionWord(n)
  const head = nested ? cleanLine(n.title) || look.label : <>{headline ?? word}{subject && <> · <span className="d-fn-s">{cleanLine(subject)}</span></>}</>
  return (
    <div className={`d-fn-wrap${swipe.open ? ' d-swiping' : ''}`}>
      {swipe.open && <div className="d-fn-reveal" aria-hidden="true">Dismiss</div>}
      <div className={`d-fn${!n.read_at ? ' d-fn-u' : ''}${nested ? ' d-fn-n' : ''}`} data-feed-row style={swipe.style}
        onTouchStart={swipe.onTouchStart} onTouchMove={swipe.onTouchMove} onTouchEnd={swipe.onTouchEnd}>
        <button type="button" className="d-fn-open" onClick={() => onOpen(n)}>
          {!nested && <span className={`d-fn-k ${KIND_TONE[look.kind] ?? ''}`}><DIcon name={KIND_ICON[look.kind] ?? 'sum'} /></span>}
          <span className="d-fn-m">
            {!nested && <u>{look.label}{tenant ? ` · ${tenant}` : ''}{inChatTurnId(n) && <em className="d-fn-chat" data-in-chat> · in chat</em>}</u>}
            <b>{head}</b>
            <Payload n={n} word={word} subject={subject} />
          </span>
          <span className="d-fn-r">
            <time>{warsawHm(n.last_seen_at || n.created_at)}</time>
            {n.count > 1 && <span className="d-fn-ct" aria-label={`${n.count} times`}>{n.count}×</span>}
          </span>
        </button>
        <button type="button" className="d-fn-x" data-verb="dismiss" aria-label={`Dismiss ${cleanLine(n.title)}`} onClick={() => onDismiss(n)}>
          <DIcon name="x" />
        </button>
      </div>
      {(act || tail) && (
        <div className="d-fn-acts">
          {act && <button type="button" className={`d-btn${primary && act === 'Pick this up' ? ' d-btn-p' : ''}`} data-verb="pick-up" onClick={() => onOpen(n)}>{act}</button>}
          {tail}
        </div>
      )}
    </div>
  )
}

export function FeedGroup({ g, onOpen, onDismissOne, onDismissAll, primary = false }: {
  g: NotificationGroup; onOpen: (n: Notification) => void
  onDismissOne: (n: Notification, g: NotificationGroup) => void; onDismissAll: (g: NotificationGroup) => void; primary?: boolean
}) {
  const [open, setOpen] = useState(false)
  if (g.items.length <= 1) return <FeedRow n={g.latest} onOpen={onOpen} onDismiss={() => onDismissAll(g)} primary={primary} />
  const toggle = <button type="button" className="d-btn" aria-expanded={open} data-verb="expand" onClick={() => setOpen(o => !o)}>{open ? 'Hide these' : `Show each one (${g.items.length})`}</button>
  return (
    <div className={`d-fg${open ? ' d-open' : ''}`} data-feed-group>
      <FeedRow n={{ ...g.latest, count: 1, read_at: g.unread > 0 ? null : g.latest.read_at }} headline={groupStateWord(g.count, g.family)}
        onOpen={() => setOpen(o => !o)} onDismiss={() => onDismissAll(g)} tail={toggle} />
      {open && (
        <div className="d-fg-items">
          {g.items.map(i => <FeedRow key={i.id} n={i} nested onOpen={onOpen} onDismiss={n => onDismissOne(n, g)} />)}
        </div>
      )}
    </div>
  )
}
