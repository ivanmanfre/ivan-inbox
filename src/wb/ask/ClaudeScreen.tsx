/* ==========================================================================
   src/wb/ask/ClaudeScreen.tsx: the phone's Claude tab (2026-09-25 redesign,
   candidate A "Conversation-first", with B's attach tray and Clear-all undo
   and C's quick asks grafted in; DECISIONS D5 to D7).

   Ivan: "it doesn't feel as smooth as the Grok". The screen IS the thread:
   one top bar (Chats, the thread's name with its menu, the bell, New chat),
   the conversation, and one floating composer. Alerts are a full-height sheet
   one tap away (not a second surface behind a swipe), the thread list is its
   own page, and live voice is the voice module's own full screen (D7, loaded
   only if it exists).

   Mobile.tsx still owns the tab bar, the other tabs and every piece of shared
   state; this screen only draws the Claude place (D6).
   ========================================================================== */
import { Suspense, useEffect, useState } from 'react'
import { AnimatePresence } from 'motion/react'
import { Icon, Popover, PopoverItem, Sheet } from '../../ds'
import type { ChatHandle } from '../../exp/v2c/useChat'
import type { Job } from '../../exp/v2c/layout'
import type { FeedData } from '../../exp/brain/b/useFeedData'
import { AskThread } from './AskThread'
import { Feed } from './Feed'
import { ChatsPage } from './ChatsPage'
import { threadLabel } from './ThreadMenu'
import { usePalette } from './Palette'
import { LiveVoice, VOICE_HASH, hhmm, unreadRows, useOnline, useSavedAt } from './claudeState'
import './claude.css'

export function ClaudeScreen({
  chat, job, about, feed, health, alertsOpen, setAlertsOpen, goJobFromFeed, openThreadAt,
  focusTurn, onFocused, morphFrom, onMorphed, onSettings, onOps,
}: {
  chat: ChatHandle
  job: Job
  about: string | null
  feed: FeedData
  health: { n: number; note: string }
  alertsOpen: boolean
  setAlertsOpen: (open: boolean) => void
  goJobFromFeed: (j: Job) => void
  openThreadAt: (id: string, turn?: string, from?: DOMRect | null) => void
  focusTurn: string | null
  onFocused: () => void
  morphFrom: DOMRect | null
  onMorphed: () => void
  onSettings: () => void
  onOps: () => void
}) {
  const online = useOnline()
  const offline = !online
  const savedAt = useSavedAt(online, chat.turns.length, chat.busy)
  const [text, setText] = useState('')
  const palette = usePalette(chat, text, setText)
  const [chatsOpen, setChatsOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [voiceOpen, setVoiceOpen] = useState(() => !!LiveVoice && VOICE_HASH.test(location.hash))
  // A swipe from the left edge opens Chats, the way a native thread app does.
  const [edge, setEdge] = useState<{ x: number; y: number } | null>(null)

  // `#claude/voice` (the home-screen shortcut, P3) opens live voice here.
  useEffect(() => {
    const onHash = () => { if (LiveVoice && VOICE_HASH.test(location.hash)) setVoiceOpen(true) }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const onBot = !!chat.botThread && chat.threadId === chat.botThread.id
  const title = threadLabel({ title: chat.thread?.title, threadId: chat.threadId, isBot: onBot })
  const unread = unreadRows(feed.groups)
  const newChat = () => { setMenuOpen(false); chat.newThread() }
  const closeVoice = () => {
    setVoiceOpen(false)
    if (VOICE_HASH.test(location.hash)) history.replaceState(null, '', location.pathname + location.search)
  }
  const healthLine = `${health.n} automation alert${health.n > 1 ? 's' : ''}`

  return (
    <div
      className="cl-screen" data-claude-screen data-offline={offline ? '' : undefined}
      onTouchStart={e => {
        const t = e.touches[0]
        setEdge(t && t.clientX < 24 ? { x: t.clientX, y: t.clientY } : null)
      }}
      onTouchEnd={e => {
        const t = e.changedTouches[0]
        if (edge && t && t.clientX - edge.x > 64 && Math.abs(t.clientY - edge.y) < 48) setChatsOpen(true)
        setEdge(null)
      }}
    >
      <header className="cl-top">
        <button type="button" className="cl-iconbtn" aria-label="Chats" onClick={() => setChatsOpen(true)}>
          <Icon name="list" size={24} />
          {chat.botUnread && <span className="cl-dot cl-dot-on" data-bot-unread aria-label="Unread" />}
        </button>

        <span className="cl-titlewrap">
          <button
            type="button" className="cl-title" aria-expanded={menuOpen}
            aria-label={`${title}. Thread menu`} onClick={() => setMenuOpen(v => !v)}
          >
            <span className="cl-title-t">{title}</span>
            <Icon name="disclose" size={16} />
          </button>
          {offline
            ? <span className="cl-sub" data-offline-mark>Offline{savedAt ? ` · saved ${hhmm(savedAt)}` : ''}</span>
            : chat.busy && <span className="cl-sub" data-live-sub><span className="cl-live" aria-hidden="true" />Working</span>}
          <Popover open={menuOpen} label="Thread menu" className="cl-menu">
            <PopoverItem icon="edit" onClick={newChat}>New chat</PopoverItem>
            <PopoverItem icon="list" onClick={() => { setMenuOpen(false); setChatsOpen(true) }}>All chats</PopoverItem>
            {chat.botThread && !onBot && (
              <PopoverItem
                icon="ask" onClick={() => { setMenuOpen(false); chat.openBot() }}
                tail={chat.botUnread ? <span className="cl-dot cl-dot-on" aria-label="Unread" /> : undefined}
              >Claude&rsquo;s thread</PopoverItem>
            )}
            {onBot && (
              <PopoverItem
                icon={chat.botPushMuted ? 'bellOff' : 'bell'}
                onClick={() => { setMenuOpen(false); chat.setBotPushMuted(!chat.botPushMuted) }}
              >{chat.botPushMuted ? 'Unmute pushes from Claude' : 'Mute pushes from Claude'}</PopoverItem>
            )}
            {health.n > 0 && (
              <PopoverItem icon="alert" onClick={() => { setMenuOpen(false); onOps() }}>{healthLine}</PopoverItem>
            )}
            <PopoverItem icon="settings" onClick={() => { setMenuOpen(false); onSettings() }}>Settings</PopoverItem>
          </Popover>
        </span>

        <button
          type="button" className="cl-iconbtn" data-feed-open
          aria-label={offline ? 'Alerts, count unknown while offline' : `Alerts, ${unread} unread`}
          onClick={() => setAlertsOpen(true)}
        >
          <Icon name="bell" size={24} />
          {!offline && unread > 0 && <span className="cl-count">{unread > 99 ? '99+' : unread}</span>}
          {!offline && unread === 0 && health.n > 0 && <span className="cl-dot cl-dot-warn" aria-hidden="true" />}
        </button>
        <button type="button" className="cl-iconbtn" aria-label="New chat" onClick={newChat}>
          <Icon name="edit" size={24} />
        </button>
      </header>

      <div className="cl-body">
        <AskThread
          chat={chat} job={job} about={about} mobile
          focusTurn={focusTurn} onFocused={onFocused}
          morphFrom={morphFrom} onMorphed={onMorphed}
          onDragBack={() => { onFocused(); setAlertsOpen(true) }}
          composerExtras={palette}
          text={text} onText={setText}
          claude={{
            onVoice: LiveVoice ? () => setVoiceOpen(true) : undefined,
            onNewChat: newChat,
            offline,
          }}
        />
      </div>

      <AnimatePresence>
        {chatsOpen && <ChatsPage chat={chat} offline={offline} onClose={() => setChatsOpen(false)} />}
      </AnimatePresence>

      <Sheet
        open={alertsOpen}
        onClose={() => setAlertsOpen(false)}
        title="Alerts"
        sub={offline ? 'Offline, may be out of date' : unread > 0 ? `${unread} new` : 'All read'}
        className="cl-alerts"
      >
        {health.n > 0 && (
          <button type="button" className="cl-health" onClick={() => { setAlertsOpen(false); onOps() }}>
            <span className="cl-kind" data-tone="attention" aria-hidden="true"><Icon name="ops" size={20} /></span>
            <span className="cl-health-t">
              <b>{healthLine}</b>
              {health.note && <span>{health.note}</span>}
            </span>
            <Icon name="next" size={16} />
          </button>
        )}
        <Feed
          feed={feed}
          goJob={goJobFromFeed}
          openThread={openThreadAt}
          onNavigated={() => setAlertsOpen(false)}
        />
      </Sheet>

      {voiceOpen && LiveVoice && (
        <Suspense fallback={<div className="cl-voice-wait" role="status">Starting voice</div>}>
          <LiveVoice
            onClose={closeVoice}
            send={t => { void chat.send(t, about ?? undefined) }}
            turns={chat.turns}
          />
        </Suspense>
      )}
    </div>
  )
}
