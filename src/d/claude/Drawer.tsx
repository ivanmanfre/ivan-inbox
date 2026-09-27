import { useEffect, useState } from 'react'
import { buildSeeBlock } from '../../exp/v2c/chat/paneContext'
import type { Layout } from '../places'
import type { DRoute } from '../route'
import { useClaudeHandoff } from '../ui/claudeHandoff'
import { useClaude } from './ClaudeProvider'
import { Chats, useChatList } from './Chats'
import { Composer } from './Composer'
import { Context } from './Context'
import { Conversation } from './Conversation'
import { CIcon } from './icons'
import { secsSince, statusOf, subjectMeta } from './model'
import { RunnerJobs, RunnerMenu, useDRunner } from './Runner'
import './claude.css'

export type ClaudeDrawerProps = {
  layout: Layout
  route: DRoute
  onClose: () => void
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

export default function ClaudeDrawer({ layout, onClose }: ClaudeDrawerProps) {
  const { chat, text, setText, see } = useClaude()
  const handoff = useClaudeHandoff()
  const [view, setView] = useState<'chat' | 'chats'>('chat')
  const list = useChatList()
  const runner = useDRunner(chat.wanted ?? null)
  const subject = handoff?.subject ?? null
  const meta = subject ? subjectMeta(subject) : null
  const chatsN = list.threads ? list.threads.length : null
  const { reload } = list

  // A hand-off from DMs brings the conversation back to the front.
  const handoffAt = handoff?.at ?? null
  useEffect(() => { if (handoffAt) setView('chat') }, [handoffAt])
  // Re-read the chat list whenever it is shown.
  useEffect(() => { if (view === 'chats') reload() }, [view, reload])

  const send = (message: string) => {
    const seeBlock = subject ? buildSeeBlock([subject], see) : undefined
    setText('')
    void chat.send(message, meta?.name, seeBlock)
    setView('chat')
  }

  return (
    <div className={`dcl dcl-${layout}`} data-claude-drawer>
      {layout === 'phone' && <div className="dcl-grab" aria-hidden="true" />}
      <div className="dcl-head">
        <button type="button" className={`dcl-ib${view === 'chats' ? ' dcl-on' : ''}`} data-verb="chats" aria-pressed={view === 'chats'}
          aria-label={view === 'chats' ? 'Back to the chat' : 'Chats'} title="Chats" onClick={() => setView(v => (v === 'chats' ? 'chat' : 'chats'))}>
          <CIcon name="chats" />
        </button>
        <div className="dcl-title">
          <b>{view === 'chats' ? 'Chats' : 'Claude'}</b>
          {view === 'chats' ? <small>{chatsN == null ? 'reading…' : `${chatsN} chats`}</small> : <StatusPill />}
        </div>
        <button type="button" className="dcl-ib" data-verb="new-chat" aria-label="New chat" title="New chat" onClick={() => { chat.newThread(); setView('chat') }}>
          <CIcon name="plus" />
        </button>
        <button type="button" className="dcl-ib" aria-label="Close Claude (⌘J)" title="Close (⌘J)" onClick={onClose}>
          <CIcon name="x" />
        </button>
      </div>
      {view === 'chats'
        ? <Chats list={list} onPicked={() => setView('chat')} />
        : <Conversation first={meta?.first ?? null} />}
      <RunnerJobs runner={runner} />
      <div className="dcl-foot">
        <Context subject={subject} />
        <Composer
          placeholder={meta ? `Ask about ${meta.first}…` : 'Ask Claude…'}
          onSend={send}
          lead={<RunnerMenu runner={runner} text={text} onSent={() => setText('')} disabled={!!runner.busy} />}
        />
      </div>
    </div>
  )
}
