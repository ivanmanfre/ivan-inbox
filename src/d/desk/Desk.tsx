// The Content Desk: one conversation with the content partner (OUT/CONTRACT.md).
// Painted from the saved copy in the first frame, kept current by realtime, and a
// send shows Ivan's bubble and a reserved answer bubble at once, so nothing jumps
// when the answer lands. Phone: a full-bleed layer over the frame; desktop: the page.
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Markdown } from '../claude/Markdown'
import { warsawDm, warsawDow, warsawHm } from '../ui/time'
import { DeskComposer } from './Composer'
import { useDesk, type DeskHandle } from './useDesk'
import { useKeyboardInset } from './useKeyboardInset'
import { actionStore } from './actionGuards'
import { heldSeenStore, reportHeldSeen } from './heldSeen'
import {
  T3_LABEL, T3_LIVE,
  type DeskAction, type DeskMessage, type T3Job,
} from './model'
import '../claude/claude.css'
import './desk.css'

const ORIGIN_NOTE: Partial<Record<DeskMessage['origin'], string>> = { proactive: 'The desk wrote first', t3: 'From T3' }

export function Desk({ layout, onBack }: { layout: 'phone' | 'desktop'; onBack?: () => void }) {
  const desk = useDesk()
  const root = useRef<HTMLElement>(null)
  useKeyboardInset(root)
  return (
    <section ref={root} className={`dk dk-${layout}`} data-desk aria-label="Content desk">
      <header className="dk-head">
        {onBack && <button type="button" className="dk-back" aria-label="Back" onClick={onBack}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
        </button>}
        <div className="dk-title"><b>Content desk</b><small>{desk.readFailed ? 'Offline, showing the saved copy' : desk.fromCache ? 'Saved copy, checking for new' : 'Knows your week, drafts and calls'}</small></div>
      </header>
      <DeskList desk={desk} />
      <DeskComposer busy={desk.busy} onSend={desk.send} prefill={desk.prefill} />
    </section>
  )
}

function DeskList({ desk }: { desk: DeskHandle }) {
  const list = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  const { messages } = desk
  const last = messages[messages.length - 1]
  // Stay at the bottom while Ivan is at the bottom; never yank him down while he reads back.
  useLayoutEffect(() => {
    const el = list.current
    if (el && pinned.current) el.scrollTop = el.scrollHeight
  }, [messages.length, last?.body, last?.status, last?.meta])
  // The keyboard opening or the composer growing shrinks the list without a new message: keep the
  // newest line in view when Ivan was at the bottom (Sol desk-ui r1 #8).
  useEffect(() => {
    const el = list.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => { if (pinned.current) el.scrollTop = el.scrollHeight })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const onScroll = () => {
    const el = list.current
    if (el) pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }
  let day = ''
  return (
    <div ref={list} className="dk-list" data-desk-list onScroll={onScroll} role="log" aria-live="polite">
      {messages.length === 0 && (desk.loaded
        ? <div className="dk-empty">Ask about this week, paste a link, or say a half-thought. Try: what's going out this week</div>
        : <div className="dk-empty" aria-busy="true">Reading the desk</div>)}
      {messages.map(m => {
        const d = `${warsawDow(m.created_at)} ${warsawDm(m.created_at)}`
        const head = d !== day ? <div className="dk-day" key={`d-${d}`}>{d}</div> : null
        day = d
        return [head, <Row key={m.answers ? `a-${m.answers}` : m.id} m={m} desk={desk} />]
      })}
    </div>
  )
}

function Row({ m, desk }: { m: DeskMessage; desk: DeskHandle }) {
  if (m.role === 'user') {
    // Stored, but its answer has not arrived: Check again and a same-key Retry stay until it does.
    const waiting = desk.awaitingAnswer(m)
    return (
      <div className={`dk-me${m.local === 'failed' ? ' dk-failed' : ''}`} data-msg={m.id}>
        {m.meta.attachments?.filter(a => a.kind === 'photo').map(a => <img key={a.url} className="dk-photo" src={a.url} alt="Photo you sent" width={120} height={120} />)}
        {m.body && <div className="dk-me-t">{m.body}</div>}
        <small>{m.meta.voice ? 'Voice · ' : ''}{m.local === 'sending' ? 'Sending' : m.local === 'failed' ? (m.error ?? 'Not sent') : m.local === 'unconfirmed' ? (m.error ?? 'Not confirmed: the app could not check.') : waiting ? 'No answer yet.' : warsawHm(m.created_at)}</small>
        {(m.local === 'unconfirmed' || waiting || m.mismatch) && <button type="button" className="dk-pill" onClick={desk.reload}>Check again</button>}
        {/* Retry always resends under the ORIGINAL client_key: the server answers a known key idempotently
            (its stored answer, still working, or key_mismatch), so a send can never run twice (Sol desk-ui
            r3 #4, r4 #2, r6 #2). A refused key (key_mismatch) is never resent: Edit and send only. */}
        {(m.local === 'failed' || m.local === 'unconfirmed' || waiting) && !m.mismatch && <button type="button" className="dk-pill" onClick={() => desk.retry(m)}>Retry</button>}
        {m.mismatch && <button type="button" className="dk-pill" onClick={() => desk.editAndSend(m)}>Edit and send</button>}
      </div>
    )
  }
  if (m.answers) {
    // The reserved answer bubble: it exists at its minimum height before a token lands.
    if (m.status === 'error') return <FailedAnswer m={m} text={m.error ?? 'The desk did not answer.'} desk={desk} />
    return (
      <div className="dk-ans dk-streaming" data-msg={m.id} data-streaming>
        {m.body ? <Markdown text={m.body} caret /> : <span className="dk-typing" aria-label="The desk is answering"><i /><i /><i /></span>}
      </div>
    )
  }
  if (m.status === 'error') return <FailedAnswer m={m} text={m.body || 'The desk could not answer just now.'} desk={desk} />
  const note = ORIGIN_NOTE[m.origin]
  return (
    <div className={`dk-ans${m.origin === 'proactive' ? ' dk-pro' : ''}`} data-msg={m.id}>
      {note && <div className="dk-note">{note} · {warsawHm(m.created_at)}</div>}
      {m.body && <Markdown text={m.body} />}
      {m.meta.drafts?.map(d => (
        <div key={d.handle} className="dk-card" data-draft={d.handle}>
          <span className="dk-h">{d.handle}</span>
          <b>{d.first_line}</b>
          <small>{d.status}{d.scheduled_at ? ` · ${warsawDow(d.scheduled_at)} ${warsawDm(d.scheduled_at)} ${warsawHm(d.scheduled_at)}` : ''}</small>
        </div>
      ))}
      {m.meta.actions?.map(a => <ActionRow key={a.id} a={a} at={m.created_at} desk={desk} />)}
      {m.meta.t3_job && <T3Card job={desk.jobs[m.meta.t3_job.id]} fallback={m.meta.t3_job} />}
      {!!m.meta.chips?.length && (
        <div className="dk-chips">
          {m.meta.chips.map(c => <button key={c.send} type="button" className="dk-pill" disabled={desk.busy} onClick={() => desk.send(c.send, { chip: true })}>{c.send}</button>)}
        </div>
      )}
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
      <p>{text}</p>
      <small>{m.meta.side_effects === 'none' ? 'Nothing was changed.' : 'Check Review before repeating.'}</small>
      <button type="button" className="dk-pill" onClick={desk.reload}>Check again</button>
      {desk.canRetry(m) && <button type="button" className="dk-pill" onClick={() => desk.editAndSend(m)}>Edit and send</button>}
    </div>
  )
}

/** Nothing covers or clips the button: its centre and its four extremes (left, right, top, bottom, on
 *  the centre lines) all hit it (or a child of it). */
function undoUncovered(b: HTMLElement): boolean {
  const r = b.getBoundingClientRect()
  if (r.width <= 0 || r.height <= 0) return false
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2
  // Half a pixel in from each edge, on the centre lines: inside any pill or rounded box, and on the
  // button's outermost pixel rows and columns, so a one-pixel clip counts as not visible.
  const pts: [number, number][] = [[cx, cy], [r.left + 0.5, cy], [r.right - 0.5, cy], [cx, r.top + 0.5], [cx, r.bottom - 0.5]]
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
    return () => { io.disconnect(); document.removeEventListener('visibilitychange', onVis) }
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
  return (
    <div className={`dk-act dk-act-${a.state}`} data-action={a.id} data-state={a.state} data-seen={seen?.state}>
      <span className="dk-act-t">
        {a.state === 'done' && <>Done: {a.label}</>}
        {counting && <>{a.label} in <b className="dk-count">{left}s</b></>}
        {finishing && <>Doing it: {a.label}</>}
        {held && busy === 'commit' && <>Doing it: {a.label}</>}
        {held && busy === 'cancel' && <>Cancelling: {a.label}</>}
        {waiting && <>Not done yet: {a.label}.</>}
        {a.state === 'committing' && <>Doing it: {a.label}</>}
        {a.state === 'undoing' && <>Undoing: {a.label}</>}
        {a.state === 'undone' && <>Undone: {a.label}</>}
        {a.state === 'cancelled' && <>Cancelled: {a.label}</>}
        {a.state === 'failed' && <>Failed: {a.label}{a.detail ? `. ${a.detail}` : ''}</>}
        {a.target && <small>{a.target.handle} {a.target.first_line}</small>}
        {failed && <small className="dk-warn" role="alert">{failed.error}</small>}
      </span>
      {a.state === 'done' && a.undo && <button type="button" className="dk-pill" disabled={!!busy} onClick={() => go('undo')}>{failed?.op === 'undo' ? 'Try Undo again' : 'Undo'}</button>}
      {/* Undo on EVERY idle held row: during the countdown, while the server commits, and on a held row
          seen later (a reopened desk). The server's compare-and-set decides who wins (Sol desk-ui r4 #1). */}
      {held && !busy && <button ref={setUndoEl} type="button" className="dk-pill" onClick={() => go('cancel')}>{failed?.op === 'cancel' || tapped ? 'Try Undo again' : 'Undo'}</button>}
      {held && !busy && !expired && <button type="button" className="dk-pill" onClick={() => go('commit')}>Do it now</button>}
    </div>
  )
}

function T3Card({ job, fallback }: { job?: T3Job; fallback: { id: string; status: T3Job['status']; title: string; link?: string | null } }) {
  const status = job?.status ?? fallback.status
  const link = job?.t3_link ?? fallback.link ?? null
  const liveNow = T3_LIVE.has(status)
  return (
    <div className={`dk-t3${liveNow ? ' dk-live' : ''}${status === 'failed' || status === 'stalled' ? ' dk-t3-bad' : ''}`} data-t3={fallback.id} data-status={status}>
      <span className="dk-t3-s">{liveNow && <i aria-hidden="true" />}{T3_LABEL[status]}</span>
      <b>{job?.title ?? fallback.title}</b>
      {job?.result_summary && status === 'done' && <small>{job.result_summary}</small>}
      {link && <a className="dk-pill" href={link} target="_blank" rel="noreferrer">Open in T3</a>}
    </div>
  )
}
