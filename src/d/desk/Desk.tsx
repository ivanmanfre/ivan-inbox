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
import { committed, disarmed } from './actionGuards'
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
        <small>{m.meta.voice ? 'Voice · ' : ''}{m.local === 'sending' ? 'Sending' : m.local === 'failed' ? 'Not sent' : warsawHm(m.created_at)}</small>
        {m.local === 'failed' && <button type="button" className="dk-pill" onClick={() => desk.retry(m)}>Retry</button>}
      </div>
    )
  }
  if (m.answers) {
    // The reserved answer bubble: it exists at its minimum height before a token lands.
    if (m.status === 'error') return (
      <div className="dk-ans dk-ans-err" data-msg={m.id} role="alert">
        <p>{m.error}</p>
        <button type="button" className="dk-pill" onClick={() => desk.retry(m)}>Try again</button>
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
      {m.meta.client_key && <button type="button" className="dk-pill" onClick={() => desk.retry(m)}>Try again</button>}
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
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const holdMs = a.hold_ms ?? DEFAULT_HOLD_MS
  // Only a hold this session's live turn delivered counts down; anything restored waits for a tap.
  const start = desk.liveHoldStart(a.id)
  const [hiddenAtExpiry, setHiddenAtExpiry] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const live = a.state === 'held' && start !== null && !disarmed.has(a.id) && !hiddenAtExpiry
  useEffect(() => {
    if (!live) return
    const t = window.setInterval(() => setNow(Date.now()), 250)
    // A hidden tab never commits by itself: if the page is hidden while the hold runs, it waits for a tap.
    const onVis = () => { if (document.visibilityState !== 'visible') setHiddenAtExpiry(true) }
    document.addEventListener('visibilitychange', onVis)
    return () => { window.clearInterval(t); document.removeEventListener('visibilitychange', onVis) }
  }, [live])
  const left = live ? holdLeft(start as number, holdMs, now) : 0
  const go = async (kind: 'undo' | 'commit' | 'cancel') => {
    if (kind === 'cancel') disarmed.add(a.id) // synchronous: the timer below can no longer commit
    if (kind === 'commit') { if (committed.has(a.id) || disarmed.has(a.id)) return; committed.add(a.id) }
    setBusy(true); setErr(null)
    const r = await desk.act(kind, a.id)
    setBusy(false)
    if (r.ok) return
    // A lost race is settled, not an error: the row is read back and shows what really happened.
    if (r.error === 'not_held' || r.error === 'nothing_to_undo') return
    setErr(SETTLED_NOTE[r.error ?? ''] ?? r.error ?? 'That did not go through.')
    if (kind === 'commit' && r.error !== 'hold_expired') committed.delete(a.id)
  }
  // go is rebuilt each render; only the clock decides when the hold runs out.
  useEffect(() => {
    if (!live || left !== 0) return
    if (document.visibilityState !== 'visible') { setHiddenAtExpiry(true); return }
    void go('commit')
  // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [live, left])
  const waiting = a.state === 'held' && !live && !committed.has(a.id) && !disarmed.has(a.id)
  const cls = `dk-act dk-act-${a.state}`
  return (
    <div className={cls} data-action={a.id} data-state={a.state}>
      <span className="dk-act-t">
        {a.state === 'done' && <>Done: {a.label}</>}
        {a.state === 'held' && live && <>{a.label} in <b className="dk-count">{left}s</b></>}
        {waiting && <>Not done: {a.label}.</>}
        {a.state === 'held' && !live && disarmed.has(a.id) && <>Cancelling: {a.label}</>}
        {a.state === 'held' && !live && committed.has(a.id) && !disarmed.has(a.id) && <>Doing it: {a.label}</>}
        {a.state === 'committing' && <>Doing it: {a.label}</>}
        {a.state === 'undoing' && <>Undoing: {a.label}</>}
        {a.state === 'undone' && <>Undone: {a.label}</>}
        {a.state === 'cancelled' && <>Cancelled: {a.label}</>}
        {a.state === 'failed' && <>Failed: {a.label}{a.detail ? `. ${a.detail}` : ''}</>}
        {a.target && <small>{a.target.handle} {a.target.first_line}</small>}
        {err && <small className="dk-warn" role="alert">{err}</small>}
      </span>
      {a.state === 'done' && a.undo && <button type="button" className="dk-pill" disabled={busy} onClick={() => go('undo')}>Undo</button>}
      {a.state === 'held' && live && <button type="button" className="dk-pill" disabled={busy} onClick={() => go('cancel')}>Undo</button>}
      {waiting && !err && <button type="button" className="dk-pill" disabled={busy} onClick={() => go('commit')}>Do it now</button>}
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
