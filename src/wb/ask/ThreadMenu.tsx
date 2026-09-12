/* ==========================================================================
   src/wb/ask/ThreadMenu.tsx — the head's subtitle IS the thread switcher.

   Ivan, 2026-09-12: "i feel like UI could be cleaner on claude chat.... and
   smoother looking...."

   What the drawer used to spend on this: a head subtitle that named the model,
   and a whole sticky shelf row under it carrying "Claude ·", the session line,
   and a "New thread" button — a band of chrome, two of whose three items
   truncated at 380px.

   One row does all of it now. The head says WHICH THREAD is open and opens a
   menu on it; the menu carries every thread the switcher used to have no home
   for (Claude's own thread pinned first, then the ask threads, newest first),
   plus "New thread" and, on Claude's own thread, its mute.

   The session line ("Continuing this thread" / "Fresh session") is NOT printed
   any more: it is the status dot's own label in the head tail, which is where
   a state mark belongs. Nothing about which thread is open, how one is opened,
   or what a new one does changed — only where the press is.
   ========================================================================== */
import { useEffect, useState } from 'react'
import { Button, Popover, PopoverItem } from '../../ds'
import { listThreads, type Thread } from '../../lib/turns'
import type { ChatHandle } from '../../exp/v2c/useChat'
import './ask.css'

/** How much of a thread's title fits the head before it is cut. A title is the
 * first 80 characters of a prompt, so this is always a cut of a sentence. */
export function shortTitle(title: string, max = 22): string {
  const t = title.replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  return `${t.slice(0, max - 1).replace(/[\s,.;:]+$/, '')}…`
}

/**
 * What the head's subtitle says. Pure, so the one string the eye lands on is
 * decided in a place a test can reach.
 *
 * Claude's own thread is named rather than titled: the tick writes it, so its
 * "title" is whatever the last bundle happened to start with, which is not a
 * name for the thread it belongs to.
 */
export function threadLabel(x: { title?: string | null; threadId?: string | null; isBot?: boolean }): string {
  if (x.isBot) return "Claude's thread"
  if (!x.threadId) return 'New thread'
  const t = (x.title ?? '').trim()
  return t ? shortTitle(t) : 'This thread'
}

export function ThreadMenu({ chat }: { chat: ChatHandle }) {
  const [open, setOpen] = useState(false)
  const [threads, setThreads] = useState<Thread[] | null>(null)
  const onBot = !!chat.botThread && chat.threadId === chat.botThread.id

  // Fetched when the menu opens and never on mount: a drawer that listed every
  // thread on every desktop boot would pay for a menu nobody opened. The read
  // is re-run on each open so a thread started in another tab is there.
  useEffect(() => {
    if (!open) return
    let live = true
    void (async () => {
      try {
        const rows = await listThreads(20)
        if (live) setThreads(rows)
      } catch {
        if (live) setThreads([])
      }
    })()
    return () => { live = false }
  }, [open])

  const label = threadLabel({ title: chat.thread?.title, threadId: chat.threadId, isBot: onBot })
  const asks = (threads ?? []).filter(t => t.kind === 'ask')

  return (
    <span className="a-brain-threadbtn">
      <Button
        variant="quiet" size="sm" iconEnd="disclose"
        aria-expanded={open}
        aria-label={`${label}. Switch thread`}
        onClick={() => setOpen(v => !v)}
      >{label}</Button>
      <Popover open={open} label="Threads" className="a-brain-threadmenu">
        <PopoverItem
          icon="add"
          onClick={() => { setOpen(false); chat.newThread() }}
        >New thread</PopoverItem>
        {chat.botThread && (
          <PopoverItem
            icon={onBot ? 'check' : 'ask'}
            onClick={() => { setOpen(false); chat.openBot() }}
            tail={chat.botUnread ? <span className="a-brain-bot-dot" data-bot-unread aria-label="Unread" /> : undefined}
          >Claude&rsquo;s thread</PopoverItem>
        )}
        {onBot && (
          <PopoverItem
            icon={chat.botPushMuted ? 'bellOff' : 'bell'}
            onClick={() => { setOpen(false); chat.setBotPushMuted(!chat.botPushMuted) }}
          >{chat.botPushMuted ? 'Unmute pushes from Claude' : 'Mute pushes from Claude'}</PopoverItem>
        )}
        {threads === null && <div className="a-brain-modelnote">Reading your threads…</div>}
        {threads !== null && asks.length === 0 && (
          <div className="a-brain-modelnote">No other threads yet.</div>
        )}
        {asks.map(t => (
          <PopoverItem
            key={t.id}
            icon={t.id === chat.threadId ? 'check' : undefined}
            onClick={() => { setOpen(false); chat.openThread(t.id) }}
            tail={t.last_turn_at ? <span className="a-dim a-mono">{t.last_turn_at.slice(5, 10)}</span> : undefined}
          >{t.title ? shortTitle(t.title, 34) : 'Untitled'}</PopoverItem>
        ))}
      </Popover>
    </span>
  )
}
