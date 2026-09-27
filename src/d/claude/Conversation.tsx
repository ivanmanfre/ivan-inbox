import { useEffect, useRef, useState } from 'react'
import type { Turn } from '../../exp/v2c/chat/events'
import { listGroupRows, notificationDeepLink, type Notification } from '../../lib/turns'
import { Skeleton } from '../ui/states'
import { warsawDay, warsawDm, warsawDow, warsawHm } from '../ui/time'
import { useClaude } from './ClaudeProvider'
import { Answer } from './Answer'
import { Markdown } from './Markdown'
import { Steps } from './Steps'
import { bundleLabel, QUICK_ASKS, sessionWords } from './model'

// The conversation: a day line where the day changes, his question as a
// bubble, a bot turn's bundle as one quiet chip, each answer, and the turn in
// flight streaming at the bottom with its live steps and a lime caret.

function dayLine(at: string): string {
  return `${warsawDow(at)} ${warsawDm(at)} ${warsawHm(at)}`
}

/** Today's BotTurn rule: an https row opens in a new tab, anything else is an in-app address. */
function openRow(n: Notification): void {
  const raw = (n.url ?? '').trim()
  if (/^https:/i.test(raw)) { window.open(raw, '_blank', 'noreferrer'); return }
  location.hash = notificationDeepLink(n)
}

function Bundle({ turnId, prompt }: { turnId: string; prompt: string }) {
  const [rows, setRows] = useState<Notification[] | null>(null)
  const [open, setOpen] = useState(false)
  const toggle = () => {
    setOpen(o => !o)
    if (rows) return
    void listGroupRows(`bot:${turnId}`).then(setRows, () => setRows([]))
  }
  return (
    <div className="dcl-bundle">
      <button type="button" aria-expanded={open} onClick={toggle}>{bundleLabel(prompt)}</button>
      {open && (
        <div className="dcl-bundle-rows">
          {!rows && <div className="dcl-dim">Reading the rows…</div>}
          {rows && rows.length === 0 && <div className="dcl-dim">Those rows are gone from the feed.</div>}
          {rows?.map(n => (
            <button type="button" key={n.id} onClick={() => openRow(n)}><span>{n.title}</span><time>{warsawHm(n.last_seen_at || n.created_at)}</time></button>
          ))}
        </div>
      )}
    </div>
  )
}

function Empty({ first, send, setText, offline }: { first: string | null; send: (t: string) => void; setText: (t: string) => void; offline: boolean }) {
  return (
    <div className="dcl-empty">
      <p>{first ? `Claude sees who ${first} is and where the thread stands. Switch the chip to whole conversation to hand it the messages.` : 'Ask about anything in the inbox, your memory or your day.'}</p>
      <p>Asking never sends anything to anyone.</p>
      <div className="dcl-quick">
        {QUICK_ASKS.map(q => (
          <button type="button" key={q.label} className="dcl-seg" data-verb={q.send ? 'starter' : 'quick-ask'} disabled={offline && !!q.send}
            onClick={() => (q.send ? send(q.send) : setText(q.insert ?? ''))}>{q.label}</button>
        ))}
      </div>
      <p className="dcl-dim">Your earlier chats are under Chats.</p>
    </div>
  )
}

export function Conversation({ first, send }: { first: string | null; send: (t: string) => void }) {
  const { chat, setText, focusTurn, clearFocus, since, stepAt, online } = useClaude()
  const box = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  const turns = chat.turns
  const live = chat.busy

  // Follow the bottom while he has not scrolled up.
  useEffect(() => {
    const el = box.current
    if (!el || focusTurn || !pinned.current) return
    el.scrollTop = el.scrollHeight
  }, [turns.length, chat.streamText, chat.streamTools.length, focusTurn])

  // A push link's turn: scroll to it once, then go back to following the bottom.
  useEffect(() => {
    if (!focusTurn || chat.turnsLoading) return
    const el = box.current?.querySelector(`[data-turn="${focusTurn}"]`)
    if (!el) return
    el.scrollIntoView({ block: 'start' })
    el.classList.add('dcl-focus')
    pinned.current = false
    clearFocus()
  }, [focusTurn, chat.turnsLoading, turns.length, clearFocus])

  const onScroll = () => {
    const el = box.current
    if (el) pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
  }

  const lastUser = [...turns].reverse().find(t => t.role === 'user')
  const lastAnswer = turns[turns.length - 1]?.role === 'assistant' ? turns[turns.length - 1] : null
  let prevDay = ''
  const rows = turns.map((t: Turn) => {
    const day = t.role === 'user' && t.at ? warsawDay(t.at) : null
    const sep = day && day !== prevDay ? dayLine(t.at!) : null
    if (day) prevDay = day
    if (t.role === 'user') {
      return (
        <div key={t.id} data-turn={t.origin === 'bot' ? undefined : t.turnId}>
          {sep && <div className="dcl-day">{sep}</div>}
          {t.origin === 'bot' && t.turnId
            ? <Bundle turnId={t.turnId} prompt={t.text} />
            : <div className="dcl-me">{t.text}<small>you</small></div>}
        </div>
      )
    }
    return <Answer key={t.id} turn={t} setText={setText} onRetry={chat.retry} last={t === lastAnswer} busy={chat.busy || chat.runningElsewhere} offline={!online} send={send} />
  })

  return (
    <div className="dcl-conv" ref={box} onScroll={onScroll} data-conv>
      {chat.turnsStale && <div className="dcl-note">Showing the saved copy of this chat. The last read failed.</div>}
      {turns.length === 0 && chat.turnsLoading && <Skeleton lines={4} label="Reading this chat" />}
      {turns.length > 0 && <div className="dcl-session">{sessionWords(chat.grounding)}</div>}
      {turns.length === 0 && !chat.turnsLoading && !live && <Empty first={first} send={send} setText={setText} offline={!online} />}
      {rows}
      {live && (
        <div className="dcl-ans dcl-live" data-live>
          <Steps calls={chat.streamTools} live t0={since} stepAt={stepAt} />
          {chat.streamText
            ? <Markdown text={chat.streamText} caret />
            : <div className="dcl-dim">{chat.slow ? 'Claude is starting up. The first answer after a quiet spell takes longer.' : "Keeps working if you close this. You'll get a notification."}<span className="dcl-caret" aria-hidden="true" /></div>}
        </div>
      )}
      {!live && chat.runningElsewhere && lastUser && (
        <div className="dcl-ans dcl-live"><div className="dcl-dim">Claude is still writing this answer. It lands here when it is done, even if you close the app.</div></div>
      )}
    </div>
  )
}
