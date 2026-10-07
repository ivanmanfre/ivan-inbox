import { useEffect, useRef, useState } from 'react'
import { buildSeeBlock, isOff } from '../../exp/v2c/chat/paneContext'
import type { Layout } from '../places'
import type { DRoute } from '../route'
import { useClaudeHandoff } from '../ui/claudeHandoff'
import { useClaude } from './ClaudeProvider'
import { Chats, useChatList } from './Chats'
import { Composer } from './Composer'
import { Context } from './Context'
import { Conversation } from './Conversation'
import { CIcon } from './icons'
import { secsSince, shortTitle, statusOf, subjectMeta } from './model'
import { More } from './More'
import { RunnerJobs, useDRunner } from './Runner'
import { useSubjects } from './useSubjects'
import { hasLiveVoice } from './VoiceLayer'
import { runnerCount } from './Runner'
import { useSkin } from '../../ds/useSkin'
import './claude.css'
import './v4/claude-v4.css'

export type ClaudeDrawerProps = {
  layout: Layout
  route: DRoute
  onClose: () => void
  /** Brief 4 (`claude` section): 'page' = the conversation column of the Claude workspace, where the
   *  chats list is the page's rail, so the drawer's chats toggle and close key are not drawn. */
  variant?: 'drawer' | 'page'
}

// The ⌘J drawer (desktop: docked right under the answer row, beside the page;
// phone: the full sheet from the lime dock key). The chat itself lives in
// ClaudeProvider, so closing this never stops a turn.
//
// Hooks rule: every hook below runs on every render, before any branch.

function useTick(on: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!on) return
    setNow(Date.now())
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [on])
  return now
}

export function StatusPill() {
  const { chat, since } = useClaude()
  const last = chat.turns[chat.turns.length - 1]
  const st = statusOf({ busy: chat.busy, runningElsewhere: chat.runningElsewhere, lastFailed: !!(last?.role === 'assistant' && last.error) })
  const now = useTick(st === 'working' || st === 'elsewhere')
  if (st === 'idle') return null
  const secs = since != null ? `${secsSince(since, now)}s` : ''
  return (
    <span className={`dcl-pill dcl-pill-${st}`} role="status" data-status={st}>
      {st !== 'failed' && <i aria-hidden="true" />}
      {st === 'working' ? 'Working' : st === 'elsewhere' ? 'Working elsewhere' : 'Last answer failed'}
      {st !== 'failed' && secs && <span>{secs}</span>}
    </span>
  )
}

export default function ClaudeDrawer({ layout, route, onClose, variant = 'drawer' }: ClaudeDrawerProps) {
  const { chat, text, setText, see, setVoiceOpen, online } = useClaude()
  const handoff = useClaudeHandoff()
  const [view, setView] = useState<'chat' | 'chats'>('chat')
  // Brief 4 (`claude` section), read as a plain value; the runner moves into a header pill's popover.
  const v4 = useSkin('claude')
  const [runOpen, setRunOpen] = useState(false)
  const list = useChatList()
  const runner = useDRunner(chat.wanted ?? null)
  const subjects = useSubjects(route)
  const person = handoff && !isOff(see, handoff.subject.key) ? subjectMeta(handoff.subject) : null
  const chatsN = list.threads ? list.threads.length : null
  const { reload } = list
  const last = chat.turns[chat.turns.length - 1]
  // Today's honest-degrade: a picked model the container refused keeps the pick and says so.
  const modelRefused = !!(last?.role === 'assistant' && last.error && /model/i.test(last.error.message) && chat.wanted !== null)
  const title = chat.thread?.kind === 'bot' ? "Claude's thread" : chat.thread?.title ? shortTitle(chat.thread.title, 48) : chat.turns.length ? null : 'New chat'

  // A hand-off from DMs brings the conversation back to the front.
  const handoffAt = handoff?.at ?? null
  useEffect(() => { if (handoffAt) setView('chat') }, [handoffAt])
  // Re-read the chat list whenever it is shown.
  useEffect(() => { if (view === 'chats') reload() }, [view, reload])
  // A job deep link (?job=) opens the runner popover, as it opened the inline list before.
  const runFocus = runner.focus
  useEffect(() => { if (runFocus) setRunOpen(true) }, [runFocus])

  const send = (message: string) => {
    setText('')
    void chat.send(message, person?.name, buildSeeBlock(subjects, see))
    setView('chat')
  }

  const page = v4 && variant === 'page'
  const edge = useRef<{ x: number; y: number } | null>(null)
  const touch = layout === 'phone' ? {
    onTouchStart: (e: React.TouchEvent) => { const t = e.touches[0]; edge.current = t.clientX < 24 ? { x: t.clientX, y: t.clientY } : null },
    onTouchEnd: (e: React.TouchEvent) => {
      const s = edge.current, t = e.changedTouches[0]
      edge.current = null
      if (s && t.clientX - s.x > 60 && Math.abs(t.clientY - s.y) < 50) setView('chats')
    },
  } : {}

  return (
    <div className={`dcl dcl-${layout}${v4 ? ' dcl-v4' : ''}${page ? ' dcl-ws' : ''}`} data-claude-drawer {...touch}>
      {layout === 'phone' && <div className="dcl-grab" aria-hidden="true" />}
      <div className="dcl-head">
        {!page && <button type="button" className={`dcl-ib${view === 'chats' ? ' dcl-on' : ''}`} data-verb="chats" aria-pressed={view === 'chats'}
          aria-label={view === 'chats' ? 'Back to the chat' : chat.botUnread ? "Chats, Claude's thread has something new" : 'Chats'} title="Chats" onClick={() => setView(v => (v === 'chats' ? 'chat' : 'chats'))}>
          <CIcon name="chats" />{chat.botUnread && <i className="dcl-dot" aria-hidden="true" />}
        </button>}
        <div className="dcl-title">
          <b>{view === 'chats' ? 'Chats' : 'Claude'}</b>
          {view === 'chats' ? <small>{chatsN == null ? 'reading…' : `${chatsN} chats`}</small> : <StatusPill />}
          {view === 'chat' && title && <small className="dcl-tname" title={chat.thread?.title ?? undefined}>{title}</small>}
        </div>
        {hasLiveVoice && (
          <button type="button" className="dcl-ib" data-verb="talk" aria-label="Talk to Claude live" title="Talk live" disabled={!online} onClick={() => setVoiceOpen(true)}>
            <CIcon name="voice" />
          </button>
        )}
        {v4 && runner.jobs.length > 0 && (
          <button type="button" className={`dcl-runpill${runOpen ? ' dcl-on' : ''}`} data-verb="runner" aria-expanded={runOpen} aria-label={`Runner jobs: ${runnerCount(runner.jobs)}`}
            title="Runner jobs" onClick={() => setRunOpen(o => !o)}><i aria-hidden="true" />Runner · {runnerCount(runner.jobs)}</button>
        )}
        {!page && <button type="button" className="dcl-ib" data-verb="new-chat" aria-label="New chat" title="New chat" onClick={() => { chat.newThread(); setView('chat') }}>
          <CIcon name="plus" />
        </button>}
        {!page && <button type="button" className="dcl-ib" aria-label="Close Claude (⌘J)" title="Close (⌘J)" onClick={onClose}>
          <CIcon name="x" />
        </button>}
      </div>
      {v4 && runOpen && (runner.jobs.length > 0 || runner.note) && (
        <div className="dcl-runpop" role="dialog" aria-label="Runner jobs"><RunnerJobs runner={runner} /></div>
      )}
      {modelRefused && (
        <div className="dcl-fail dcl-banner" role="alert">
          <span>{last.error?.message}</span>
          <button type="button" className="dcl-link" data-verb="model-default" onClick={() => chat.setWanted(null)}>Use the Claude default</button>
        </div>
      )}
      {view === 'chats' && !page
        ? <Chats list={list} onPicked={() => setView('chat')} />
        : <Conversation first={person?.first ?? null} send={send} />}
      {!v4 && <RunnerJobs runner={runner} />}
      <div className="dcl-foot">
        {v4 && runner.note && <div className="dcl-fail" role="alert"><span>{runner.note}</span><button type="button" className="dcl-link" onClick={runner.clearNote}>Dismiss</button></div>}
        {!v4 && <Context subjects={subjects} />}
        <Composer
          placeholder={person ? `Ask about ${person.first}…` : 'Ask Claude…'}
          onSend={send}
          top={v4 ? <Context subjects={subjects} /> : undefined}
          more={a => <More chat={chat} runner={runner} text={text} onSent={() => setText('')} onCommands={a.onCommands} onPaste={a.onPaste} phone={layout === 'phone'} />}
        />
      </div>
    </div>
  )
}
