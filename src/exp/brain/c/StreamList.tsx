import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { ChatHandle } from '../../v2c/useChat'
import type { Job } from '../../v2c/layout'
import { parseWbHash } from '../../v2c/route'
import { abortTurn, notificationDeepLink, type NotificationGroup } from '../../../lib/turns'
import { Failed, relAge } from '../../v2c/Surface'
import { FILTERS, mergeStream, type FilterKey } from './stream'
import { useAugmentedTurns, usePersistedBool, usePersistedEnum, type useNotifications } from './useStreamData'
import { NotificationCard, QuietRow } from './NotificationCard'
import { TurnCard } from './TurnCard'
import { Composer } from './Composer'
import { groundedOnLabel, sessionStateLabel } from './brainVisibility'
import { ChatStreaming } from '../../v2c/ChatMessage'

export type BootTarget = { thread?: string; turn?: string; feed?: boolean }

/**
 * The stream itself: filter chips, the quiet toggle, the interleaved column,
 * and the composer docked underneath it. Shared verbatim between the phone
 * entry and the desktop Ask pane — the thesis's "same column, either place".
 */
export function StreamList({ chat, about, boot, onNavigateJob, onBootConsumed, notif }: {
  chat: ChatHandle
  about?: string | null
  boot?: BootTarget
  onNavigateJob?: (job: Job) => void
  onBootConsumed?: () => void
  /** Lifted to the caller (Mobile/AskPane) so a tab badge can read unread count too. */
  notif: ReturnType<typeof useNotifications>
}) {
  const turns = useAugmentedTurns(chat)
  const [filter, setFilter] = usePersistedEnum<FilterKey>(
    'brain-c-filter', ['all', 'asks', 'needs', 'rise', 'arch'], 'all',
  )
  const [quiet, setQuiet] = usePersistedBool('brain-c-quiet', false)

  const entries = useMemo(
    () => mergeStream(turns, notif.rows, { filter, quiet }),
    [turns, notif.rows, filter, quiet],
  )

  const scrollerRef = useRef<HTMLDivElement>(null)
  const bootAppliedRef = useRef(false)

  // Newest at the bottom, like a chat. Autoscroll on new content, unless a boot
  // target is about to take over the scroll position on first paint.
  useEffect(() => {
    if (boot?.thread || boot?.turn || boot?.feed) return
    const el = scrollerRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [entries.length, chat.streamText, boot])

  // Deep link: a finished turn's push notification names `thread`+`turn`; the
  // feed link names none of that and just wants the newest notification.
  useEffect(() => {
    if (bootAppliedRef.current) return
    if (!boot?.thread && !boot?.turn && !boot?.feed) return
    const el = scrollerRef.current
    if (!el) return
    if (boot.thread && boot.thread !== chat.threadId) {
      chat.openThread(boot.thread)
      return // re-run once the thread's turns have hydrated
    }
    const raf = requestAnimationFrame(() => {
      if (boot.turn) {
        const target = el.querySelector(`[data-turn="${boot.turn}"]`)
        target?.scrollIntoView({ block: 'center' })
      } else if (boot.feed) {
        const cards = el.querySelectorAll('[data-card],[data-quiet-row]')
        cards[cards.length - 1]?.scrollIntoView({ block: 'center' })
      }
      bootAppliedRef.current = true
      onBootConsumed?.()
    })
    return () => cancelAnimationFrame(raf)
  }, [boot, chat, onBootConsumed])

  // Mark-read ON VIEW: a card that scrolls past the middle of the column for
  // half a second is read the same way scrolling past it in a paper inbox
  // would be. Chosen over mark-on-tap because the whole point of one stream is
  // that reading IS the morning pass — a policy that only marked read on tap
  // would leave every card he merely scrolled past forever unread.
  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    const pending = new Map<Element, ReturnType<typeof setTimeout>>()
    const groupsByKey = new Map(entries
      .filter((e): e is Extract<typeof e, { kind: 'notification' }> => e.kind === 'notification')
      .map(e => [e.key, e.group]))
    const io = new IntersectionObserver(observed => {
      for (const rec of observed) {
        const key = (rec.target as HTMLElement).dataset.streamKey ?? ''
        const existing = pending.get(rec.target)
        if (!rec.isIntersecting) {
          if (existing) { clearTimeout(existing); pending.delete(rec.target) }
          continue
        }
        if (existing) continue
        const group = groupsByKey.get(key)
        if (!group) continue
        const timer = setTimeout(() => {
          const unreadIds = group.items.filter(i => !i.read_at).map(i => i.id)
          if (unreadIds.length) void notif.markRead(unreadIds)
          pending.delete(rec.target)
        }, 500)
        pending.set(rec.target, timer)
      }
    }, { root: el, threshold: 0.6 })
    for (const card of el.querySelectorAll('[data-card]')) io.observe(card)
    return () => { io.disconnect(); for (const t of pending.values()) clearTimeout(t) }
  }, [entries, notif])

  const openNotification = useCallback((group: NotificationGroup) => {
    const route = parseWbHash(notificationDeepLink(group.latest))
    if (route.thread) {
      if (route.thread !== chat.threadId) chat.openThread(route.thread)
      return
    }
    if (onNavigateJob) onNavigateJob(route.job)
  }, [chat, onNavigateJob])

  const stopActive = useCallback(() => {
    const last = turns[turns.length - 1]
    if (chat.busy && !chat.runningElsewhere) { chat.abort(); return }
    if (last?.turnId && (last.status === 'running' || last.status === 'queued')) void abortTurn(last.turnId)
  }, [chat, turns])

  // Which turn is genuinely open right now. `Turn.status` on the client-
  // optimistic entry is set to 'running' the moment send() fires and is never
  // corrected back afterward on the sending tab (only a fresh hydrate rebuilds
  // it from the row) — so "open" is derived from the array shape and the live
  // flags, never trusted off the stale per-turn status alone.
  const rawLast = turns[turns.length - 1]
  const openTurnId = rawLast && rawLast.role === 'user' && (chat.busy || chat.runningElsewhere)
    ? rawLast.id
    : null
  const lastAssistantId = [...turns].reverse().find(t => t.role === 'assistant')?.id ?? null

  const emptyAt = entries.length === 0 ? notif.loadedAt : null
  const sessionLine = sessionStateLabel(chat.grounding)
  const groundedLine = groundedOnLabel(chat.grounding)

  return (
    <div className="brc-stream" data-place="ask">
      <div className="brc-filters">
        {FILTERS.map(f => (
          <button
            key={f.key} type="button" data-filter={f.key}
            className={`brc-chip brc-filter${filter === f.key ? ' on' : ''}`}
            onClick={() => setFilter(f.key)}
          >{f.label}</button>
        ))}
        <button
          type="button" className={`brc-chip brc-quiet-toggle${quiet ? ' on' : ''}`}
          onClick={() => setQuiet(!quiet)}
          aria-pressed={quiet}
        >Quiet</button>
        <button
          type="button" className="brc-newthread" data-new-thread
          onClick={() => chat.newThread()}
          title="Start a new thread"
        >New</button>
      </div>

      <div className="brc-scroller" data-feed ref={scrollerRef}>
        {(sessionLine || groundedLine) && chat.turns.length > 0 && (
          <div className="brc-threadmeta">
            {sessionLine && <span>{sessionLine}</span>}
            {groundedLine && <span>{groundedLine}</span>}
          </div>
        )}
        {notif.error && (
          <Failed what="The feed" message={notif.error} onRetry={notif.refresh} loadedAt={notif.loadedAt} />
        )}
        {entries.length === 0 ? (
          <div className="brc-empty">
            {emptyAt
              ? `Nothing new since ${new Date(emptyAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`
              : 'Nothing here yet.'}
          </div>
        ) : (
          entries.map(e => {
            if (e.kind === 'turn') {
              return (
                <TurnCard
                  key={e.key} turn={e.turn} chat={chat}
                  openTurnId={openTurnId} isLastAssistant={e.turn.id === lastAssistantId}
                />
              )
            }
            if (e.kind === 'quiet') {
              return <QuietRow key={e.key} count={e.count} onExpand={() => setQuiet(false)} />
            }
            return (
              <NotificationCard
                key={e.key} group={e.group}
                onOpen={() => openNotification(e.group)}
                onDismiss={() => void notif.dismissMany(e.group.items.map(it => it.id), e.group.groupKey)}
              />
            )
          })
        )}
        {chat.busy && (
          <ChatStreaming text={chat.streamText} tools={chat.streamTools} slow={chat.slow} />
        )}
        {notif.loadedAt && (
          <div className="brc-freshness">Feed as of {relAge(notif.loadedAt)}</div>
        )}
      </div>

      <Composer chat={chat} about={about} busy={chat.busy} onStop={stopActive} />
    </div>
  )
}
