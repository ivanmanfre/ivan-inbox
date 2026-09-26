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
import { AskThread, sessionLine } from './AskThread'
import { Feed } from './Feed'
import { ChatsPage } from './ChatsPage'
import { threadLabel } from './ThreadMenu'
import { usePalette } from './Palette'
import { See } from './See'
import { EMPTY_SEE, attached, buildSeeBlock, type SeeState, type Subject } from '../../exp/v2c/chat/paneContext'
import { LiveVoice, VOICE_HASH, hhmm, unreadRows, useOnline, useSavedAt } from './claudeState'
import './claude.css'

export function ClaudeScreen({
  chat, job, about: aboutIn, subjects = [], feed, health, alertsOpen, setAlertsOpen, goJobFromFeed, openThreadAt,
  focusTurn, onFocused, morphFrom, onMorphed, onSettings,
}: {
  chat: ChatHandle
  job: Job
  about: string | null
  /** A person asked about from a DM thread or a held row (askAbout.ts). Shown
   *  as the same removable, names-only-by-default chip the desktop pane has. */
  subjects?: Subject[]
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
}) {
  const online = useOnline()
  const offline = !online
  const savedAt = useSavedAt(online, chat.turns.length, chat.busy)
  const [text, setText] = useState('')
  // Which chips are off / opened to full text. Reset when the subject changes:
  // an off-list keyed on the last person must not detach the next one.
  const [see, setSee] = useState<SeeState>(EMPTY_SEE)
  const subjectKey = subjects.map(x => x.key).join('|')
  useEffect(() => { setSee(EMPTY_SEE) }, [subjectKey])
  const seeBlock = buildSeeBlock(subjects, see)
  // The person's name leads the placeholder only while the chip is attached.
  const about = attached(subjects, see)[0]?.label ?? aboutIn
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

  // Escape closes the top layer (menu, then Chats, then Alerts): the ds Sheet
  // has no key handling of its own, and a hardware keyboard must get out.
  useEffect(() => {
    if (!menuOpen && !chatsOpen && !alertsOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (menuOpen) setMenuOpen(false)
      else if (chatsOpen) setChatsOpen(false)
      else setAlertsOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [menuOpen, chatsOpen, alertsOpen, setAlertsOpen])

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
        <button type="button" className="wb-cl cl-iconbtn" aria-label="Chats" onClick={() => setChatsOpen(true)}>
          <Icon name="list" size={24} />
          {chat.botUnread && <span className="cl-count" data-bot-unread aria-label="1 unread from Claude">1</span>}
        </button>

        <span className="cl-titlewrap">
          <button
            type="button" className="wb-cl cl-title" aria-expanded={menuOpen}
            aria-label={`${title}. Thread menu`} onClick={() => setMenuOpen(v => !v)}
          >
            <span className="cl-title-t">{title}</span>
            <Icon name="disclose" size={16} />
          </button>
          {offline
            ? <span className="cl-sub" data-offline-mark>Offline{savedAt ? ` · saved ${hhmm(savedAt)}` : ''}</span>
            : chat.busy
              ? <span className="cl-sub" data-live-sub>Working</span>
              // Which session this is, on the phone too (it was a desktop tooltip).
              : chat.turns.length > 0 && <span className="cl-sub" data-session>{sessionLine(chat.grounding)}</span>}
          <Popover open={menuOpen} label="Thread menu" className="cl-menu">
            <PopoverItem icon="edit" onClick={newChat}>New chat</PopoverItem>
            <PopoverItem icon="list" onClick={() => { setMenuOpen(false); setChatsOpen(true) }}>All chats</PopoverItem>
            {chat.botThread && !onBot && (
              <PopoverItem
                icon="ask" onClick={() => { setMenuOpen(false); chat.openBot() }}
                tail={chat.botUnread ? <span className="cl-new">New</span> : undefined}
              >Claude&rsquo;s thread</PopoverItem>
            )}
            {onBot && (
              <PopoverItem
                icon={chat.botPushMuted ? 'bellOff' : 'bell'}
                onClick={() => { setMenuOpen(false); chat.setBotPushMuted(!chat.botPushMuted) }}
              >{chat.botPushMuted ? 'Unmute pushes from Claude' : 'Mute pushes from Claude'}</PopoverItem>
            )}
            {health.n > 0 && (
              <PopoverItem icon="alert" onClick={() => { setMenuOpen(false); setAlertsOpen(true) }}>{healthLine}</PopoverItem>
            )}
            <PopoverItem icon="settings" onClick={() => { setMenuOpen(false); onSettings() }}>Settings</PopoverItem>
          </Popover>
        </span>

        <button
          type="button" className="wb-cl cl-iconbtn" data-feed-open
          aria-label={offline ? 'Alerts, count unknown while offline' : `Alerts, ${unread} unread`}
          onClick={() => setAlertsOpen(true)}
        >
          <Icon name="bell" size={24} />
          {!offline && unread > 0 && <span className="cl-count">{unread > 99 ? '99+' : unread}</span>}
          {!offline && unread === 0 && health.n > 0 && <span className="cl-count" data-tone="warn" aria-hidden="true">!</span>}
        </button>
        <button type="button" className="wb-cl cl-iconbtn" aria-label="New chat" onClick={newChat}>
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
          see={seeBlock}
          context={subjects.length ? <See subjects={subjects} see={see} setSee={setSee} /> : undefined}
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
          // Read only. It used to route to Ops, which has had no workflow list
          // since 31 Aug; the workflow pill now lands here instead.
          <div className="wb-cl cl-health" role="status">
            <span className="cl-kind" data-tone="attention" aria-hidden="true"><Icon name="ops" size={20} /></span>
            <span className="cl-health-t">
              <b>{healthLine}</b>
              {health.note && <span>{health.note}</span>}
            </span>
          </div>
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
            send={t => { void chat.send(t, about ?? undefined, seeBlock) }}
            turns={chat.turns}
          />
        </Suspense>
      )}
    </div>
  )
}
