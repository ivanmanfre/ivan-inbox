// The Content Desk: one conversation with the content partner (OUT/CONTRACT.md).
// Painted from the saved copy in the first frame, kept current by realtime, and a
// send shows Ivan's bubble and a reserved answer bubble at once, so nothing jumps
// when the answer lands. Phone: a full-bleed layer over the frame; desktop: the page.
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Markdown } from '../claude/Markdown'
import { dHash } from '../route'
import { warsawDayWord, warsawDm, warsawDow, warsawHm } from '../ui/time'
import { DeskComposer } from './Composer'
import { useDesk, type DeskHandle } from './useDesk'
import { useKeyboardInset } from './useKeyboardInset'
import { actionStore } from './actionGuards'
import { heldSeenStore, reportHeldSeen } from './heldSeen'
import {
  T3_LABEL, T3_LIVE, cleanLabel,
  type DeskAction, type DeskDraftCard, type DeskMessage, type T3Job,
} from './model'
import '../claude/claude.css'
import './desk.css'

/** Questions, never commands: a starter only asks, so it can never write anything. */
const STARTERS = [
  "What's going out this week?",
  'What should I post next?',
  'Any post ideas from my recent calls?',
  'How did my last post do?',
]
// The starter row shows above the composer on a young desk, and again once it has been quiet this long.
const QUIET_MS = 2 * 60 * 60 * 1000

const ORIGIN_NOTE: Partial<Record<DeskMessage['origin'], string>> = { proactive: 'wrote first', t3: 'from T3' }

function Mark() {
  return <span className="dk-mark" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="M8 1.8l1.55 4.65L14.2 8l-4.65 1.55L8 14.2l-1.55-4.65L1.8 8l4.65-1.55z" /></svg></span>
}

const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

export function Desk({ layout, onBack }: { layout: 'phone' | 'desktop'; onBack?: () => void }) {
  const desk = useDesk()
  const root = useRef<HTMLElement>(null)
  const title = useRef<HTMLHeadingElement>(null)
  useKeyboardInset(root)
  // Desktop: the desk fills the page from under the tab row to the frame's bottom edge, measured, so the
  // conversation scrolls and the composer (with Send) is always inside the window, however short it is.
  useLayoutEffect(() => {
    const el = root.current
    if (layout !== 'desktop' || !el) return
    const fit = () => { el.style.height = `${Math.max(200, window.innerHeight - el.getBoundingClientRect().top - 12)}px` }
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [layout])
  // Phone: the layer covers the app, so the app behind it is inert while it is open, the focus starts on its
  // title, and it goes back to what opened the desk on the way out.
  useEffect(() => {
    if (layout !== 'phone') return
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const app = document.getElementById('root')
    const host = root.current
    const covers = !!app && !!host && !app.contains(host)
    if (covers) app.setAttribute('inert', '')
    title.current?.focus({ preventScroll: true })
    return () => { if (covers) app.removeAttribute('inert'); if (opener?.isConnected) opener.focus({ preventScroll: true }) }
  }, [layout])
  // One turn at a time: a photo still uploading counts as a turn, so a chip, a starter or a retry waits for it.
  const [uploading, setUploading] = useState(false)
  const locked = desk.busy || uploading
  const last = desk.messages[desk.messages.length - 1]
  const quiet = !!last && !locked && !last.meta.chips?.length && !last.meta.actions?.some(a => a.state === 'held')
    && (desk.messages.length < 6 || Date.now() - Date.parse(last.created_at) > QUIET_MS)
  const status = desk.readFailed ? 'Offline, showing the saved copy' : desk.fromCache ? 'Saved copy, checking for new' : desk.busy ? 'Answering' : 'Knows your week, drafts and calls'
  return (
    <section ref={root} className={`dk dk-${layout}`} data-desk aria-labelledby="dk-title">
      <header className="dk-head">
        {onBack && <button type="button" className="dk-back" aria-label="Back" onClick={onBack}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
        </button>}
        <Mark />
        <div className="dk-title">
          <h1 id="dk-title" ref={title} tabIndex={-1}>Content desk</h1>
          <small className={desk.readFailed ? 'dk-off' : desk.busy ? 'dk-on' : undefined}><i aria-hidden="true" />{status}</small>
        </div>
        <a className="dk-headkey" href={dHash('content', 'calendar')} aria-label="Open the calendar">
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5.5" width="16" height="14" rx="3" /><path d="M4 10h16M9 3.5v4M15 3.5v4" /></svg>
        </a>
      </header>
      {/* Desktop has no head (the page names it), so a stale or offline read says so above the conversation. */}
      {layout === 'desktop' && (desk.readFailed || desk.fromCache) && <div className={`dk-status${desk.readFailed ? ' dk-status-off' : ''}`} role="status">{status}</div>}
      <DeskList desk={desk} locked={locked} layout={layout} />
      <DeskComposer busy={locked} onSend={desk.send} prefill={desk.prefill} suggest={quiet ? STARTERS : undefined}
        autoFocus={layout === 'desktop'} onUploading={setUploading} />
    </section>
  )
}

function DeskList({ desk, locked, layout }: { desk: DeskHandle; locked: boolean; layout: 'phone' | 'desktop' }) {
  const list = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  const [away, setAway] = useState(false)
  const { messages } = desk
  const last = messages[messages.length - 1]
  // Ivan's own send brings him down to it once, wherever he was reading; after that, the stream follows him
  // only while he stays at the bottom (a chunk never yanks him out of the history).
  const sentKey = [...messages].reverse().find(m => m.role === 'user' && m.local === 'sending')?.client_key
  const followed = useRef<string | undefined>(undefined)
  useLayoutEffect(() => {
    const el = list.current
    if (sentKey && followed.current !== sentKey) { followed.current = sentKey; pinned.current = true; setAway(false) }
    if (el && pinned.current) el.scrollTop = el.scrollHeight
  }, [messages.length, last?.body, last?.status, last?.meta, sentKey])
  // Anything that changes the height (the keyboard, the composer growing, a T3 card finishing, a photo loading)
  // keeps the newest line in view while Ivan is at the bottom (Sol desk-ui r1 #8; polish review: content too).
  useEffect(() => {
    const el = list.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => { if (pinned.current) el.scrollTop = el.scrollHeight })
    ro.observe(el)
    if (content.current) ro.observe(content.current)
    return () => ro.disconnect()
  }, [])
  const onScroll = () => {
    const el = list.current
    if (!el) return
    pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    const far = el.scrollHeight - el.scrollTop - el.clientHeight > 400
    if (far !== away) setAway(far)
  }
  const toLatest = () => {
    const el = list.current
    if (!el) return
    pinned.current = true
    setAway(false)
    el.scrollTo({ top: el.scrollHeight, behavior: reducedMotion() ? 'auto' : 'smooth' })
  }
  // A stored answer is announced once (the log itself stays quiet while it streams, so no partial chunk is read).
  const answered = [...messages].reverse().find(m => m.role === 'assistant' && !m.answers && m.status === 'done')
  // "Try again" for the newest read-only answer: the question it answered, sent again as a new turn.
  const againFor = (i: number): string | null => {
    const m = messages[i]
    if (i !== messages.length - 1 || m.role !== 'assistant' || m.answers || m.status !== 'done' || m.origin !== 'desk') return null
    if (m.meta.actions?.length || m.meta.t3_job || m.meta.chips?.length) return null
    const q = messages[i - 1]
    return q && q.role === 'user' && !q.local && q.body.trim() && !q.meta.attachments?.length ? q.body : null
  }
  const lastUser = (() => { for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === 'user') return i; return -1 })()
  let day = ''
  let prevRole: DeskMessage['role'] | null = null
  return (
    <div className="dk-body">
      <div ref={list} className="dk-list" data-desk-list onScroll={onScroll} role="log" aria-live="off" aria-label="Conversation with the desk">
        <div ref={content} className="dk-flow">
          {messages.length === 0 && (desk.loaded
            ? desk.readFailed
              // A failed first read with nothing saved is never shown as a fresh, empty desk.
              ? <div className="dk-empty dk-empty-off" role="alert"><p>Could not read the desk. Your messages are safe on the server.</p><button type="button" className="dk-pill" onClick={desk.reload}>Try again</button></div>
              : <Hero busy={locked} onPick={t => desk.send(t)} />
            : <div className="dk-empty" aria-busy="true"><span className="dk-typing"><i /><i /><i /></span>Reading the desk</div>)}
          {messages.map((m, i) => {
            const d = warsawDayWord(m.created_at)
            const head = d !== day ? <div className="dk-day" key={`d-${d}`}><span>{d}</span></div> : null
            const fresh = !!head || prevRole !== m.role
            day = d
            prevRole = m.role
            return [head, <Row key={m.answers ? `a-${m.answers}` : m.id} m={m} desk={desk} fresh={fresh} locked={locked}
              recent={i >= messages.length - 4} again={againFor(i)} editable={i === lastUser && layout === 'desktop'} />]
          })}
        </div>
      </div>
      <div className="dk-sr" role="status" aria-live="polite">{answered ? `The desk answered at ${warsawHm(answered.created_at)}.` : ''}</div>
      {/* In its own lane under the conversation, never over it: nothing it covers can be a held change's Undo. */}
      {away && <div className="dk-jumpbar"><button type="button" className="dk-jump" onClick={toLatest}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M6 13l6 6 6-6" /></svg>Latest
      </button></div>}
    </div>
  )
}

function Hero({ busy, onPick }: { busy: boolean; onPick: (t: string) => void }) {
  return (
    <div className="dk-hero" data-desk-hero>
      <Mark />
      <h2>What are we posting?</h2>
      <p>I know your week, your drafts and your calls. Ask anything. A change to a post waits for your tap.</p>
      <div className="dk-starters">
        {STARTERS.map(t => <button key={t} type="button" disabled={busy} onClick={() => onPick(t)}>{t}</button>)}
      </div>
    </div>
  )
}

/** Long answers outside the last few messages fold to a few lines. The fold is a real disclosure: the hidden part
 *  is inert (nothing in it takes focus), the key says Show all / Show less, and an opened answer stays open. */
const FOLD_AT = 720
const opened = new Set<string>()
function Body({ id, text, recent }: { id: string; text: string; recent: boolean }) {
  const [open, setOpen] = useState(() => opened.has(id))
  const long = !recent && text.length > FOLD_AT
  const fold = long && !open
  const toggle = () => { const next = !open; if (next) opened.add(id); else opened.delete(id); setOpen(next) }
  return (
    <div className="dk-text-w">
      <div className={`dk-text${fold ? ' dk-fold' : ''}`} id={`dk-t-${id}`} inert={fold}>
        <Markdown text={text} />
      </div>
      {long && <button type="button" className="dk-more" aria-expanded={open} aria-controls={`dk-t-${id}`} onClick={toggle}>{open ? 'Show less' : 'Show all'}</button>}
    </div>
  )
}

/** Copy the answer's text (the markdown as written), and Try again for a read-only answer. */
function AnswerKeys({ text, again, onAgain, locked }: { text: string; again: boolean; onAgain: () => void; locked: boolean }) {
  const [done, setDone] = useState<'ok' | 'no' | null>(null)
  useEffect(() => {
    if (!done) return
    const t = window.setTimeout(() => setDone(null), 1600)
    return () => window.clearTimeout(t)
  }, [done])
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setDone('ok') } catch { setDone('no') }
  }
  return (
    <div className={`dk-ans-keys${again ? ' dk-ans-keys-last' : ''}`}>
      <button type="button" className="dk-copy" onClick={() => void copy()} aria-label={done === 'ok' ? 'Copied' : 'Copy the answer'}>
        {done === 'ok'
          ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
          : <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8.5" y="8.5" width="11" height="11" rx="2.5" /><path d="M15.5 5.5h-8a2 2 0 0 0-2 2v8" /></svg>}
        <span>{done === 'ok' ? 'Copied' : done === 'no' ? 'Could not copy' : 'Copy'}</span>
      </button>
      {again && <button type="button" className="dk-copy" disabled={locked} onClick={onAgain} aria-label="Ask that again">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12a7 7 0 1 1-2.05-4.95M19 4.5V9h-4.5" /></svg><span>Try again</span>
      </button>}
    </div>
  )
}

function Byline({ m, live }: { m: DeskMessage; live?: boolean }) {
  const note = ORIGIN_NOTE[m.origin]
  return (
    <div className={`dk-by${live ? ' dk-by-live' : ''}`}>
      <Mark /><b>Desk</b>{note && <span>{note}</span>}{!live && <time>{warsawHm(m.created_at)}</time>}
    </div>
  )
}

/** The answer only restates the change its card shows (the server's "Proposed (ref …): move "…" … It runs only when
 *  you tap Do it now.", or the card's own sentence): the card says it once, with the post and the keys. */
function repeatsCard(m: DeskMessage): boolean {
  const acts = m.meta.actions
  if (!acts?.length) return false
  const body = m.body.replace(/\s+/g, ' ').trim()
  if (/^Proposed \(ref [0-9a-f]{6,}\)/i.test(body)) return true
  return acts.some(a => { const l = a.label.replace(/\s+/g, ' ').trim(); return l.length > 12 && body.startsWith(l.slice(0, Math.min(40, l.length))) })
}

function DraftCard({ d }: { d: DeskDraftCard }) {
  const when = d.scheduled_at
  const status = /sched|queue/i.test(d.status) ? 'Scheduled' : /post|publish/i.test(d.status) ? 'Posted' : /review/i.test(d.status) ? 'In review' : d.status
  return (
    <div className="dk-card" data-draft={d.handle}>
      <div className={`dk-date${when ? '' : ' dk-date-none'}`} aria-hidden="true">
        {when ? <><small>{warsawDow(when)}</small><b>{warsawDm(when).split(' ')[0]}</b></> : <small>No date</small>}
      </div>
      <div className="dk-card-t">
        <b>{d.first_line}</b>
        <small><span className={`dk-st dk-st-${status.toLowerCase().replace(/\s+/g, '-')}`}>{status}</span>{when ? ` ${warsawDm(when)}, ${warsawHm(when)}` : ''}<span className="dk-h">{d.handle}</span></small>
      </div>
    </div>
  )
}

/** A sent photo: tap opens it whole in a new tab; a photo that does not load says so. */
function SentPhoto({ url }: { url: string }) {
  const [bad, setBad] = useState(false)
  if (bad) return <span className="dk-photo dk-photo-bad">Photo did not load</span>
  return (
    <a className="dk-photo-a" href={url} target="_blank" rel="noreferrer" aria-label="Open the photo you sent">
      <img className="dk-photo" src={url} alt="" width={160} height={160} onError={() => setBad(true)} />
    </a>
  )
}

// A long list of choices shows this many first, then "Show N more".
const CHIPS_SHOWN = 6
function Chips({ chips, locked, onPick }: { chips: { send: string }[]; locked: boolean; onPick: (t: string) => void }) {
  const [all, setAll] = useState(false)
  const shown = all ? chips : chips.slice(0, CHIPS_SHOWN)
  return (
    <div className="dk-chips">
      {shown.map(c => <button key={c.send} type="button" className="dk-pill dk-chip" disabled={locked} onClick={() => onPick(c.send)}>{c.send}</button>)}
      {chips.length > CHIPS_SHOWN && !all && <button type="button" className="dk-pill dk-quiet" onClick={() => setAll(true)}>Show {chips.length - CHIPS_SHOWN} more</button>}
    </div>
  )
}

function Row({ m, desk, fresh, locked, recent, again, editable }: {
  m: DeskMessage; desk: DeskHandle; fresh: boolean; locked: boolean; recent: boolean; again: string | null; editable: boolean
}) {
  if (m.role === 'user') {
    // Stored, but its answer has not arrived: Check again and a same-key Retry stay until it does.
    const waiting = desk.awaitingAnswer(m)
    const trouble = m.local === 'failed' || m.local === 'unconfirmed' || waiting || m.mismatch
    return (
      <div className={`dk-me${m.local === 'failed' ? ' dk-failed' : ''}${fresh ? ' dk-fresh' : ''}`} data-msg={m.id}>
        {m.meta.attachments?.filter(a => a.kind === 'photo').map(a => <SentPhoto key={a.url} url={a.url} />)}
        {m.body && <div className="dk-me-t">{m.body}</div>}
        <small className={trouble ? 'dk-warn' : undefined}>
          {m.meta.voice ? 'Voice · ' : ''}{m.local === 'sending' ? 'Sending' : m.local === 'failed' ? (m.error ?? 'Not sent') : m.local === 'unconfirmed' ? (m.error ?? 'Not confirmed: the app could not check.') : waiting ? 'No answer yet.' : warsawHm(m.created_at)}
          {/* Edit the last ask (desktop): its text goes back into the composer; only Ivan's Send makes a new turn. */}
          {editable && !trouble && !m.local && m.body && <button type="button" className="dk-edit" disabled={locked} onClick={() => desk.editAndSend(m)}>Edit</button>}
        </small>
        {trouble && <div className="dk-me-keys">
          {(m.local === 'unconfirmed' || waiting || m.mismatch) && <button type="button" className="dk-pill" onClick={desk.reload}>Check again</button>}
          {/* Retry always resends under the ORIGINAL client_key: the server answers a known key idempotently
              (its stored answer, still working, or key_mismatch), so a send can never run twice (Sol desk-ui
              r3 #4, r4 #2, r6 #2). A refused key (key_mismatch) is never resent: Edit and send only. */}
          {(m.local === 'failed' || m.local === 'unconfirmed' || waiting) && !m.mismatch && <button type="button" className="dk-pill" disabled={locked && !m.local} onClick={() => desk.retry(m)}>Retry</button>}
          {m.mismatch && <button type="button" className="dk-pill" onClick={() => desk.editAndSend(m)}>Edit and send</button>}
        </div>}
      </div>
    )
  }
  if (m.answers) {
    // The reserved answer bubble: it exists at its minimum height before a token lands.
    if (m.status === 'error') return <FailedAnswer m={m} text={m.error ?? 'The desk did not answer.'} desk={desk} />
    return (
      <div className="dk-ans dk-streaming" data-msg={m.id} data-streaming aria-busy="true">
        <Byline m={m} live />
        {m.body
          ? <div className="dk-text"><Markdown text={m.body} caret /></div>
          : <span className="dk-typing" aria-label="The desk is answering"><i /><i /><i /><em>Reading your week</em></span>}
      </div>
    )
  }
  if (m.status === 'error') return <FailedAnswer m={m} text={m.body || 'The desk could not answer just now.'} desk={desk} />
  const byline = fresh || m.origin !== 'desk'
  const showBody = !!m.body && !repeatsCard(m)
  return (
    <div className={`dk-ans${m.origin === 'proactive' ? ' dk-pro' : ''}${byline ? '' : ' dk-cont'}`} data-msg={m.id}>
      {byline && <Byline m={m} />}
      {showBody && <Body id={m.id} text={m.body} recent={recent} />}
      {/* Copy is for answers worth copying: not a one-line note that sits on a change card. */}
      {showBody && (m.body.length >= 60 || !!again) && !m.meta.actions?.length && <AnswerKeys text={m.body} again={!!again} locked={locked} onAgain={() => again && desk.send(again)} />}
      {!!m.meta.drafts?.length && <div className="dk-cards">{m.meta.drafts.map(d => <DraftCard key={d.handle} d={d} />)}</div>}
      {m.meta.actions?.map(a => <ActionRow key={a.id} a={a} at={m.created_at} desk={desk} />)}
      {m.meta.t3_job && <T3Card job={desk.jobs[m.meta.t3_job.id]} fallback={m.meta.t3_job} />}
      {!!m.meta.chips?.length && <Chips chips={m.meta.chips} locked={locked} onPick={t => desk.send(t, { chip: true })} />}
    </div>
  )
}


const SETTLED_NOTE: Record<string, string> = {
  hold_expired: 'Too late to do it from here. Ask again if you still want it.',
}
// After the countdown the server commits within about half a second; the row says so for this long
// before it offers "Do it now" (the server's answer normally lands by realtime first).
const FINISH_GRACE_MS = 4000

/**
 * A failed answer, stored or live, whatever its side_effects: the note says what the server recorded,
 * and the only actions are Check again (a re-read) and Edit and send (the question's text goes into
 * the composer; only Ivan's own Send makes a new message with a new key). Nothing here ever sends
 * (Sol desk-ui r6 #2/#3).
 */
function FailedAnswer({ m, text, desk }: { m: DeskMessage; text: string; desk: DeskHandle }) {
  return (
    <div className="dk-ans dk-ans-err" data-msg={m.id} role="alert">
      <div className="dk-err-t"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7.5v5.5M12 16.2v.3" /></svg><p>{text}</p></div>
      <small>{m.meta.side_effects === 'none' ? 'Nothing was changed.' : 'Check Review before repeating.'}</small>
      <div className="dk-me-keys">
        <button type="button" className="dk-pill" onClick={desk.reload}>Check again</button>
        {desk.canRetry(m) && <button type="button" className="dk-pill" onClick={() => desk.editAndSend(m)}>Edit and send</button>}
      </div>
    </div>
  )
}

/** Nothing covers or clips the button: nine points (the centre, the four edge midpoints and the four corners,
 *  one pixel in) all hit it (or a child of it), so a cover over any corner counts as not visible. */
function undoUncovered(b: HTMLElement): boolean {
  const r = b.getBoundingClientRect()
  if (r.width <= 2 || r.height <= 2) return false
  const xs = [r.left + 1, r.left + r.width / 2, r.right - 1], ys = [r.top + 1, r.top + r.height / 2, r.bottom - 1]
  // Pills are round: the corner points sit inside the rounded box, a third of the radius in.
  const rad = Math.min(r.height / 2, parseFloat(getComputedStyle(b).borderTopLeftRadius) || 0) * 0.3
  const pts: [number, number][] = []
  for (const x of xs) for (const y of ys) {
    const corner = x !== xs[1] && y !== ys[1]
    pts.push(corner ? [x + (x < xs[1] ? rad : -rad), y + (y < ys[1] ? rad : -rad)] : [x, y])
  }
  return pts.every(([x, y]) => { const hit = document.elementFromPoint(x, y); return !!hit && (hit === b || b.contains(hit)) })
}

function ActionRow({ a, desk }: { a: DeskAction; at: string; desk: DeskHandle }) {
  useSyncExternalStore(actionStore.subscribe, actionStore.version, actionStore.version)
  useSyncExternalStore(heldSeenStore.subscribe, heldSeenStore.version, heldSeenStore.version)
  const isHeld = a.state === 'held'
  // held_seen (Sol desk-ui r5 U1): the hold is reported seen only when its Undo button ITSELF is fully
  // visible (IntersectionObserver threshold 1.0), not covered (every corner and the centre hit the
  // button), enabled, and the tab is visible. The server arms the commit timer from that moment.
  // Without the means to verify it (no IntersectionObserver or elementFromPoint), held_seen is never
  // sent: the hold stays manual, with Undo and "Do it now" and no countdown.
  const [undoEl, setUndoEl] = useState<HTMLButtonElement | null>(null)
  const tapped = actionStore.undoTapped(a.id)
  useEffect(() => {
    const known = heldSeenStore.get(a.id)
    if (!isHeld || !undoEl || tapped || (known && known.state !== 'failed')) return
    if (typeof IntersectionObserver === 'undefined' || typeof document.elementFromPoint !== 'function') return
    let full = false
    const tryReport = () => {
      if (full && document.visibilityState === 'visible' && !actionStore.undoTapped(a.id) && undoEl.isConnected && !undoEl.disabled && undoUncovered(undoEl)) reportHeldSeen(a.id)
    }
    const io = new IntersectionObserver(entries => {
      const e = entries[entries.length - 1]
      full = !!e && e.isIntersecting && e.intersectionRatio >= 1
      tryReport()
    }, { threshold: 1 })
    io.observe(undoEl)
    // A tab return never trusts the last observation (layout may have moved while hidden): it drops it,
    // discards any entry still queued for the callback (takeRecords), and re-observes, so only a FRESH
    // entry with ratio 1 can report (Sol desk-ui r6 #4, r7 P2).
    const onVis = () => {
      full = false
      if (document.visibilityState !== 'visible') return
      io.takeRecords()
      io.unobserve(undoEl)
      io.observe(undoEl)
    }
    document.addEventListener('visibilitychange', onVis)
    // A cover that goes away (a sheet closing, the keyboard dropping) changes no intersection, so while the
    // button is fully in view the check runs again every 600 ms until the sighting is reported.
    const again = window.setInterval(() => { if (full) tryReport() }, 600)
    return () => { io.disconnect(); window.clearInterval(again); document.removeEventListener('visibilitychange', onVis) }
  }, [isHeld, a.id, undoEl, tapped])
  const seen = heldSeenStore.get(a.id)
  // The countdown is display only and runs to the server's hold_until: the SERVER commits then, unless
  // Undo wins first. Without a deadline from the server there is no countdown, only the buttons.
  const until = seen?.state === 'armed' ? seen.until : null
  const settledOnServer = seen?.state === 'settled'
  // Read the row back once when the server says it is no longer held (refresh is a stable callback).
  const refresh = desk.refresh
  useEffect(() => { if (settledOnServer && isHeld) void refresh() }, [settledOnServer, isHeld, refresh])
  const [now, setNow] = useState(() => Date.now())
  // The clock restarts when the server's deadline arrives, so the first frame never shows a stale count.
  useEffect(() => { if (until !== null) setNow(Date.now()) }, [until])
  const busy = actionStore.inFlight(a.id)
  // A failed op's note shows only while the row is still in the state that op applies to: once the
  // read-back shows the server settled it, the stored state speaks for itself.
  const lastFail = actionStore.failed(a.id)
  const failed = lastFail && (lastFail.op === 'undo' ? a.state === 'done' : a.state === 'held') ? lastFail : undefined
  const held = a.state === 'held'
  const counting = held && until !== null && !busy && !failed && !tapped && now < until
  const finishing = held && until !== null && !busy && !failed && !tapped && !counting && now < until + FINISH_GRACE_MS
  useEffect(() => {
    if (!(counting || finishing)) return
    const t = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(t)
  }, [counting, finishing])
  const left = counting ? Math.max(1, Math.ceil(((until ?? now) - now) / 1000)) : 0
  const go = async (kind: 'undo' | 'commit' | 'cancel') => {
    if (actionStore.inFlight(a.id)) return
    // Undo on a held action: recorded BEFORE the request, so no held_seen can follow it (r6 #1).
    if (kind === 'cancel') actionStore.markUndoTapped(a.id)
    if (!actionStore.start(a.id, kind)) return
    // A rejected call counts as a failed one: the in-flight state is always cleared (Sol desk-ui r4 #3).
    const r = await desk.act(kind, a.id).catch((): { ok: false; error: string } => ({ ok: false, error: 'No connection.' }))
    // A lost race ('not_held' / 'nothing_to_undo') means the server already settled it: the row is read
    // back and shows that state, never an error. Any other failure (or a 15 s timeout) clears the
    // in-flight state and offers the action again AT ONCE ("Try Undo again"), while the row is read back
    // in the background: a repeat cancel is safe, the server's compare-and-set decides (Sol desk-ui r5 U2).
    const settled = r.ok || r.error === 'not_held' || r.error === 'nothing_to_undo'
    if (settled) { actionStore.finish(a.id); return }
    const error = r.error === 'timeout' ? 'No answer from the desk.' : SETTLED_NOTE[r.error ?? ''] ?? r.error ?? 'That did not go through.'
    actionStore.finish(a.id, { op: kind, error })
    void desk.refresh()
  }
  const waiting = held && !counting && !finishing && !busy
  const expired = failed?.error === SETTLED_NOTE.hold_expired
  // The server's sentence, cleaned; the eyebrow already names the state, so a stated label gets no prefix.
  const clean = cleanLabel(a.label, a.target)
  const shown = clean.text
  const say = (word: string) => (clean.stated ? clean.text : `${word}: ${clean.text}`)
  const stateWord = a.state === 'done' ? 'Done' : held ? (counting ? 'Doing it soon' : finishing || busy === 'commit' ? 'Doing it' : busy === 'cancel' ? 'Cancelling' : 'Waiting for your tap')
    : a.state === 'committing' ? 'Doing it' : a.state === 'undoing' ? 'Undoing' : a.state === 'undone' ? 'Undone' : a.state === 'cancelled' ? 'Cancelled'
    : a.state === 'failed' ? 'Failed' : 'Not confirmed'
  return (
    <div className={`dk-act dk-act-${a.state}${counting ? ' dk-act-counting' : ''}`} data-action={a.id} data-state={a.state} data-seen={seen?.state}>
      <div className="dk-act-eye"><i aria-hidden="true" />{counting ? <>Doing it in <b className="dk-count">{left}s</b></> : stateWord}</div>
      <span className="dk-act-t">
        <span className="dk-act-l">
          {held && busy === 'commit' && <>Doing it: {shown}</>}
          {held && busy === 'cancel' && <>Cancelling: {shown}</>}
          {(counting || waiting) && <>{shown}</>}
          {finishing && <>Doing it: {shown}</>}
          {a.state === 'committing' && <>Doing it: {shown}</>}
          {a.state === 'undoing' && <>Undoing: {shown}</>}
          {a.state === 'done' && <>{say('Done')}</>}
          {a.state === 'undone' && <>{say('Undone')}</>}
          {a.state === 'cancelled' && <>{say('Cancelled')}</>}
          {a.state === 'failed' && <>{say('Failed')}{a.detail ? `. ${a.detail}` : ''}</>}
          {a.state === 'unconfirmed' && <>{say('Not confirmed')}. The writer may be running, check Review in a few minutes.</>}
        </span>
        {a.target && <small className="dk-act-post"><span className="dk-h">{a.target.handle}</span> {a.target.first_line}</small>}
        {failed && <small className="dk-warn" role="alert">{failed.error}</small>}
      </span>
      {(a.state === 'done' && a.undo) || (held && !busy) ? <div className="dk-act-keys">
        {/* "Do it now" first and filled: it is the one tap that makes a held change happen. */}
        {held && !busy && !expired && <button type="button" className="dk-pill dk-go" onClick={() => go('commit')}>Do it now</button>}
        {/* Undo on EVERY idle held row: during the countdown, while the server commits, and on a held row
            seen later (a reopened desk). The server's compare-and-set decides who wins (Sol desk-ui r4 #1). */}
        {held && !busy && <button ref={setUndoEl} type="button" className="dk-pill" onClick={() => go('cancel')}>{failed?.op === 'cancel' || tapped ? 'Try Undo again' : 'Undo'}</button>}
        {a.state === 'done' && a.undo && <button type="button" className="dk-pill dk-quiet" disabled={!!busy} onClick={() => go('undo')}>{failed?.op === 'undo' ? 'Try Undo again' : 'Undo'}</button>}
      </div> : null}
    </div>
  )
}

function T3Card({ job, fallback }: { job?: T3Job; fallback: { id: string; status: T3Job['status']; title: string; link?: string | null } }) {
  const status = job?.status ?? fallback.status
  const link = job?.t3_link ?? fallback.link ?? null
  const liveNow = T3_LIVE.has(status)
  return (
    <div className={`dk-t3${liveNow ? ' dk-live' : ''}${status === 'failed' || status === 'stalled' ? ' dk-t3-bad' : ''}`} data-t3={fallback.id} data-status={status}>
      <div className="dk-t3-top">
        <span className="dk-t3-s">{liveNow && <i aria-hidden="true" />}{T3_LABEL[status]}</span>
        <span className="dk-t3-k">T3 cloud</span>
      </div>
      <b>{job?.title ?? fallback.title}</b>
      {job?.result_summary && status === 'done' && <small>{job.result_summary}</small>}
      {link && <a className="dk-pill" href={link} target="_blank" rel="noreferrer">Open in T3</a>}
    </div>
  )
}
