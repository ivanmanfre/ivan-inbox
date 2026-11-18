// The Content Desk: one conversation with the content partner (OUT/CONTRACT.md).
// Painted from the saved copy in the first frame, kept current by realtime, and a
// send shows Ivan's bubble and a reserved answer bubble at once, so nothing jumps
// when the answer lands. Phone: a full-bleed layer over the frame; desktop: the page.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Markdown } from '../claude/Markdown'
import { warsawDm, warsawDow, warsawHm } from '../ui/time'
import { DeskComposer } from './Composer'
import { useDesk, type DeskHandle } from './useDesk'
import { useKeyboardInset } from './useKeyboardInset'
import { disarmed, failedOp, inFlight } from './actionGuards'
import {
  DEFAULT_HOLD_MS, T3_LABEL, T3_LIVE, holdLeft,
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
      <DeskComposer busy={desk.busy} onSend={desk.send} />
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
    return (
      <div className={`dk-me${m.local === 'failed' ? ' dk-failed' : ''}`} data-msg={m.id}>
        {m.meta.attachments?.filter(a => a.kind === 'photo').map(a => <img key={a.url} className="dk-photo" src={a.url} alt="Photo you sent" width={120} height={120} />)}
        {m.body && <div className="dk-me-t">{m.body}</div>}
        <small>{m.meta.voice ? 'Voice · ' : ''}{m.local === 'sending' ? 'Sending' : m.local === 'failed' ? 'Not sent' : m.local === 'unconfirmed' ? 'Not confirmed: the app could not check' : warsawHm(m.created_at)}</small>
        {m.local === 'unconfirmed' && <button type="button" className="dk-pill" onClick={desk.reload}>Check again</button>}
        {(m.local === 'failed' || m.local === 'unconfirmed') && <button type="button" className="dk-pill" onClick={() => desk.retry(m)}>Retry</button>}
      </div>
    )
  }
  if (m.answers) {
    // The reserved answer bubble: it exists at its minimum height before a token lands.
    if (m.status === 'error') return (
      <div className="dk-ans dk-ans-err" data-msg={m.id} role="alert">
        <p>{m.error}</p>
        {desk.canRetry(m) && <button type="button" className="dk-pill" onClick={() => desk.retry(m)}>Try again</button>}
      </div>
    )
    return (
      <div className="dk-ans dk-streaming" data-msg={m.id} data-streaming>
        {m.body ? <Markdown text={m.body} caret /> : <span className="dk-typing" aria-label="The desk is answering"><i /><i /><i /></span>}
      </div>
    )
  }
  if (m.status === 'error') return (
    // A stored failed answer keeps its retry, tied to the send it failed (meta.client_key).
    <div className="dk-ans dk-ans-err" data-msg={m.id} role="alert">
      <p>{m.body || 'The desk could not answer just now.'}</p>
      {desk.canRetry(m) && <button type="button" className="dk-pill" onClick={() => desk.retry(m)}>Try again</button>}
    </div>
  )
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
          {m.meta.chips.map(c => <button key={c.send} type="button" className="dk-pill" disabled={desk.busy} onClick={() => desk.send(c.send, { chip: true })}>{c.label}</button>)}
        </div>
      )}
    </div>
  )
}


const SETTLED_NOTE: Record<string, string> = {
  hold_expired: 'Too late to do it from here. Ask again if you still want it.',
}

function ActionRow({ a, desk }: { a: DeskAction; at: string; desk: DeskHandle }) {
  const [, rerender] = useState(0)
  const holdMs = a.hold_ms ?? DEFAULT_HOLD_MS
  // Only a hold this mounted desk received live (tab visible) counts down; anything restored, or a
  // hold whose desk was left or hidden, waits for a tap.
  const start = desk.liveHoldStart(a.id)
  const [now, setNow] = useState(() => Date.now())
  const busy = inFlight.get(a.id)
  const failed = failedOp.get(a.id)
  const live = a.state === 'held' && start !== null && !disarmed.has(a.id) && !busy && !failed
  useEffect(() => {
    if (!live) return
    const t = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(t)
  }, [live])
  const left = live ? holdLeft(start as number, holdMs, now) : 0
  const go = async (kind: 'undo' | 'commit' | 'cancel', auto = false) => {
    if (inFlight.has(a.id)) return
    if (auto && disarmed.has(a.id)) return
    // Synchronous, before any await: after any op (a tap, or the clock's one try) the clock can never
    // commit by itself again; a lost race is read back, never retried in a loop.
    disarmed.add(a.id)
    inFlight.set(a.id, kind); failedOp.delete(a.id); rerender(x => x + 1)
    const r = await desk.act(kind, a.id)
    inFlight.delete(a.id)
    if (!r.ok && r.error !== 'not_held' && r.error !== 'nothing_to_undo') {
      // A failed op is offered again; the hold stays disarmed (Sol desk-ui r2 #1).
      disarmed.add(a.id)
      failedOp.set(a.id, { op: kind, error: SETTLED_NOTE[r.error ?? ''] ?? r.error ?? 'That did not go through.' })
    }
    // A lost race ('not_held' / 'nothing_to_undo') is settled: the row is read back and shows the truth.
    rerender(x => x + 1)
  }
  // go is rebuilt each render; only the clock decides when the hold runs out.
  useEffect(() => {
    if (!live || left !== 0) return
    if (document.visibilityState !== 'visible') { disarmed.add(a.id); rerender(x => x + 1); return }
    void go('commit', true)
  // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [live, left])
  const held = a.state === 'held'
  const waiting = held && !live && !busy
  const expired = failed?.error === SETTLED_NOTE.hold_expired
  return (
    <div className={`dk-act dk-act-${a.state}`} data-action={a.id} data-state={a.state}>
      <span className="dk-act-t">
        {a.state === 'done' && <>Done: {a.label}</>}
        {held && live && <>{a.label} in <b className="dk-count">{left}s</b></>}
        {held && busy === 'commit' && <>Doing it: {a.label}</>}
        {held && busy === 'cancel' && <>Cancelling: {a.label}</>}
        {waiting && <>Not done: {a.label}.</>}
        {a.state === 'committing' && <>Doing it: {a.label}</>}
        {a.state === 'undoing' && <>Undoing: {a.label}</>}
        {a.state === 'undone' && <>Undone: {a.label}</>}
        {a.state === 'cancelled' && <>Cancelled: {a.label}</>}
        {a.state === 'failed' && <>Failed: {a.label}{a.detail ? `. ${a.detail}` : ''}</>}
        {a.target && <small>{a.target.handle} {a.target.first_line}</small>}
        {failed && <small className="dk-warn" role="alert">{failed.error}</small>}
      </span>
      {a.state === 'done' && a.undo && <button type="button" className="dk-pill" disabled={!!busy} onClick={() => go('undo')}>{failed?.op === 'undo' ? 'Try Undo again' : 'Undo'}</button>}
      {held && live && <button type="button" className="dk-pill" onClick={() => go('cancel')}>Undo</button>}
      {waiting && failed?.op === 'cancel' && <button type="button" className="dk-pill" onClick={() => go('cancel')}>Try Undo again</button>}
      {waiting && failed?.op !== 'cancel' && !expired && <button type="button" className="dk-pill" onClick={() => go('commit')}>Do it now</button>}
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
