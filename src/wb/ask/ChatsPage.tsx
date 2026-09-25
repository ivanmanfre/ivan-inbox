/* ==========================================================================
   src/wb/ask/ChatsPage.tsx: the phone's Chats page (2026-09-25 redesign).

   What ThreadMenu's popover did, as a page: every thread, Claude's own thread
   pinned first with its unread dot, the mute for Claude's pushes, a filter,
   and New chat in the thumb zone. The reads are ThreadMenu's (`listThreads`,
   fetched on open, never on mount); the writes are the chat handle's own
   (`openThread`, `openBot`, `newThread`, `setBotPushMuted`).
   ========================================================================== */
import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { Icon, IconButton, Switch, fadeT } from '../../ds'
import { listThreads, type Thread } from '../../lib/turns'
import type { ChatHandle } from '../../exp/v2c/useChat'
import { shortTitle } from './ThreadMenu'
import { dayWord } from './forms'
import { clock } from './parts'
import './claude.css'

/** Threads grouped by the day of their last turn, in the order they came. */
export function groupByDay(threads: Thread[]): { label: string; items: Thread[] }[] {
  const out: { label: string; items: Thread[] }[] = []
  for (const t of threads) {
    const label = t.last_turn_at ? dayWord(t.last_turn_at) : 'Earlier'
    const band = out[out.length - 1]
    if (band && band.label === label) band.items.push(t)
    else out.push({ label, items: [t] })
  }
  return out
}

export function ChatsPage({ chat, onClose, offline }: {
  chat: ChatHandle
  onClose: () => void
  offline: boolean
}) {
  const [threads, setThreads] = useState<Thread[] | null>(null)
  const [q, setQ] = useState('')
  const onBot = !!chat.botThread && chat.threadId === chat.botThread.id

  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const rows = await listThreads(40)
        if (live) setThreads(rows)
      } catch {
        if (live) setThreads([])
      }
    })()
    return () => { live = false }
  }, [])

  const needle = q.trim().toLowerCase()
  const asks = (threads ?? [])
    .filter(t => t.kind === 'ask')
    .filter(t => !needle || (t.title ?? '').toLowerCase().includes(needle))
  const days = groupByDay(asks)
  const pick = (fn: () => void) => { fn(); onClose() }

  return (
    <motion.div
      className="cl-chats" data-chats role="dialog" aria-label="Chats"
      initial={{ x: '-100%' }} animate={{ x: 0 }} exit={{ x: '-100%' }}
      transition={fadeT}
    >
      <div className="cl-chats-top">
        <span className="cl-chats-t">Chats</span>
        <IconButton icon="close" label="Close chats" onClick={onClose} />
      </div>

      <div className="cl-chats-list">
        {chat.botThread && !needle && (
          <button
            type="button" className="wb-cl cl-chat" data-current={onBot ? '' : undefined}
            onClick={() => pick(() => chat.openBot())}
          >
            <span className="cl-chat-i"><Icon name="ask" size={20} /></span>
            <span className="cl-chat-t">Claude&rsquo;s thread</span>
            {chat.botUnread && <span className="cl-dot" data-bot-unread aria-label="Unread" />}
          </button>
        )}

        {threads === null && <div className="cl-chats-note">Reading your chats</div>}
        {threads !== null && asks.length === 0 && (
          <div className="cl-chats-note">{needle ? 'No chat matches that.' : 'No other chats yet.'}</div>
        )}

        {days.map(d => (
          <div key={d.label} className="cl-chats-day">
            <div className="cl-chats-h">{d.label}</div>
            {d.items.map(t => {
              const current = t.id === chat.threadId
              const running = current ? chat.busy : t.last_status === 'running' || t.last_status === 'queued'
              return (
                <button
                  type="button" key={t.id} className="wb-cl cl-chat" data-current={current ? '' : undefined}
                  onClick={() => pick(() => chat.openThread(t.id))}
                >
                  <span className="cl-chat-t">{t.title ? shortTitle(t.title, 60) : 'Untitled'}</span>
                  {running
                    ? <span className="cl-chat-run"><span className="cl-live" aria-hidden="true" />Running</span>
                    : t.last_turn_at && <span className="cl-chat-m">{clock(t.last_turn_at)}</span>}
                </button>
              )
            })}
          </div>
        ))}
      </div>

      <div className="cl-chats-dock">
        {chat.botThread && (
          <div className="cl-chats-mute" data-bot-mute data-muted={chat.botPushMuted ? '' : undefined}>
            <span>Claude pushes</span>
            <Switch
              checked={!chat.botPushMuted}
              label={chat.botPushMuted ? 'Pushes from Claude are muted. Unmute' : 'Mute pushes from Claude'}
              disabled={offline}
              onChange={on => chat.setBotPushMuted(!on)}
            />
          </div>
        )}
        <div className="cl-chats-row">
          <label className="cl-search">
            <Icon name="search" size={16} />
            <input
              type="search" value={q} onChange={e => setQ(e.target.value)}
              placeholder="Search chats" aria-label="Search chats"
            />
          </label>
          <button type="button" className="wb-cl cl-new" data-new-thread onClick={() => pick(() => chat.newThread())}>
            <Icon name="edit" size={20} /><span>New</span>
          </button>
        </div>
      </div>
    </motion.div>
  )
}
