import { useEffect, useRef, type ReactNode } from 'react'
import type { Turn } from '../../exp/v2c/chat/events'
import { Skeleton } from '../ui/states'
import { warsawDay, warsawDm, warsawDow } from '../ui/time'
import { useClaude } from './ClaudeProvider'
import { Answer } from './Answer'
import { Markdown } from './Markdown'
import { Steps } from './Steps'
import { QUICK_ASKS } from './model'

// The conversation: a day line where the day changes, his question as a
// bubble, a bot turn's bundle as one quiet chip, each answer, and the turn in
// flight streaming at the bottom with its live steps and a lime caret.

function dayLine(at: string): string {
  if (warsawDay(at) === warsawDay(new Date().toISOString())) return 'Today'
  return `${warsawDow(at)} ${warsawDm(at)}`
}

function Empty({ first, send, offline }: { first: string | null; send: (t: string) => void; offline: boolean }) {
  return (
    <div className="dcl-empty dcl-welcome">
      <h2>{first ? `What’s next with ${first}?` : 'What’s on your mind, Ivan?'}</h2>
      <div className="dcl-quick">
        {QUICK_ASKS.map(q => (
          <button type="button" key={q.label} className="dcl-seg" data-verb="starter" disabled={offline}
            onClick={() => send(q.send)}>{q.label}</button>
        ))}
      </div>
    </div>
  )
}

export function Conversation({ first, send }: { first: string | null; send: (t: string, scanAlertTurnId?: string) => void }) {
  const { chat, setText, focusTurn, clearFocus, since, stepAt, online } = useClaude()
  const box = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  const scrollAnchor = useRef<{ node: Element; top: number } | null>(null)
  const turns = chat.turns
  const live = chat.busy

  // Follow the bottom while he has not scrolled up.
  useEffect(() => {
    const el = box.current
    const anchor = scrollAnchor.current
    if (el && anchor && el.contains(anchor.node)) {
      el.scrollTop += anchor.node.getBoundingClientRect().top - anchor.top
      scrollAnchor.current = null
      return
    }
    if (!el || focusTurn || !pinned.current) return
    el.scrollTop = el.scrollHeight
  }, [turns.length, chat.streamText, chat.streamTools.length, focusTurn])

  // A push link's turn: scroll to it once, then go back to following the bottom.
  useEffect(() => {
    if (!focusTurn || chat.turnsLoading) return
    const el = box.current?.querySelector(`[data-turn="${focusTurn}"]`)
    if (!el) return
    const group = el.closest<HTMLDetailsElement>('details.dcl-older-updates')
    if (group) group.open = true
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
  let request = ''
  const rows: ReactNode[] = []
  let routine: { turn: Turn; answer: ReactNode }[] = []

  function date(t: Turn) {
    if (!t.at) return
    const day = warsawDay(t.at)
    if (day !== prevDay) rows.push(<div key={'day-' + t.id} className="dcl-day">{dayLine(t.at)}</div>)
    prevDay = day
  }

  function flushUpdates() {
    if (!routine.length) return
    rows.push(<details key={'updates-' + routine[0].turn.id} className="dcl-older-updates">
      <summary>{routine.length === 1 ? 'Previous update' : `${routine.length} previous updates`}</summary>
      {routine.map(item => item.answer)}
    </details>)
    routine = []
  }

  turns.forEach((t: Turn) => {
    if (t.role === 'user') {
      request = t.text
      if (t.origin !== 'bot') {
        flushUpdates()
        date(t)
        rows.push(<div key={t.id} data-turn={t.turnId}><div className="dcl-me">{t.text}</div></div>)
      }
      return
    }
    const answer = <Answer key={t.id} request={request} turn={t} setText={setText} onRetry={chat.retry} last={t === lastAnswer} busy={chat.busy || chat.runningElsewhere} offline={!online} send={send} />
    if (t.origin === 'bot' && request && t !== lastAnswer) routine.push({ turn: t, answer })
    else {
      flushUpdates()
      if (t.origin === 'bot') date(t)
      rows.push(answer)
    }
  })
  flushUpdates()

  return (
    <div className="dcl-conv" ref={box} onScroll={onScroll} data-conv>
      {chat.hasEarlier && <button type="button" className="dcl-history-more" disabled={chat.earlierState === 'loading' || chat.turnsLoading}
        onClick={() => {
          pinned.current = false
          const node = box.current?.querySelector('[data-turn]')
          if (node) scrollAnchor.current = { node, top: node.getBoundingClientRect().top }
          void chat.loadEarlier()
        }}>{chat.earlierState === 'loading' ? 'Loading…' : chat.earlierState === 'error' ? 'Retry earlier messages' : 'Earlier messages'}</button>}
      {chat.turnsStale && <div className="dcl-note">Showing the saved copy of this chat. The last read failed.</div>}
      {turns.length === 0 && chat.turnsLoading && <Skeleton lines={4} label="Reading this chat" />}
      {turns.length === 0 && !chat.turnsLoading && !live && <Empty first={first} send={send} offline={!online} />}
      {rows}
      {live && (
        <div className="dcl-ans dcl-live" data-live>
          {chat.streamTools.length > 0 && <details className="dcl-live-work"><summary>Working</summary><Steps calls={chat.streamTools} live t0={since} stepAt={stepAt} /></details>}
          {chat.streamText
            ? <Markdown text={chat.streamText} caret />
            : <div className="dcl-dim">{chat.slow ? 'Still working…' : 'Thinking…'}<span className="dcl-caret" aria-hidden="true" /></div>}
        </div>
      )}
      {!live && chat.runningElsewhere && lastUser && (
        <div className="dcl-ans dcl-live"><div className="dcl-dim">Working on your reply…</div></div>
      )}
    </div>
  )
}
