import { useCallback, useEffect, useState } from 'react'
import { listThreads, readBotHealth, type BotHealth, type Thread } from '../../lib/turns'
import { Failed, Skeleton } from '../ui/states'
import { warsawDm, warsawDow, warsawHm } from '../ui/time'
import { useClaude } from './ClaudeProvider'
import { CIcon } from './icons'
import { botSilentLine, chatTail, chatsByDay, shortTitle } from './model'

// Chats: search, Claude's own thread pinned with the Pushes switch (the one
// write here, today's `setBotPushMuted`, db/065), then every chat by day with
// its turn count, a failed one marked. Read on open (today's ThreadMenu rule).

export function useChatList(): { threads: Thread[] | null; failed: boolean; reload: () => void } {
  const [threads, setThreads] = useState<Thread[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [n, setN] = useState(0)
  useEffect(() => {
    let live = true
    setFailed(false)
    listThreads(40).then(rows => { if (live) setThreads(rows) }, () => { if (live) { setThreads([]); setFailed(true) } })
    return () => { live = false }
  }, [n])
  const reload = useCallback(() => setN(x => x + 1), [])
  return { threads, failed, reload }
}

export function Chats({ onPicked, list }: { onPicked: () => void; list: ReturnType<typeof useChatList> }) {
  const { chat, online } = useClaude()
  const [q, setQ] = useState('')
  const { threads, failed, reload } = list
  const needle = q.trim().toLowerCase()
  const asks = (threads ?? []).filter(t => t.kind === 'ask').filter(t => !needle || (t.title ?? '').toLowerCase().includes(needle))
  const bot = chat.botThread
  const pick = (fn: () => void) => { fn(); onPicked() }
  const muted = chat.botPushMuted
  const [health, setHealth] = useState<{ h: BotHealth | null; at: number }>({ h: null, at: Date.now() })
  const botId = bot?.id
  useEffect(() => {
    if (!botId) return
    let live = true
    // A failed read shows nothing extra: the row keeps its plain date. Re-read
    // every 5 minutes and when the page comes back, so a silence that starts
    // while the page is open still shows (Sol r1).
    const read = () => readBotHealth(botId).then(h => { if (live) setHealth({ h, at: Date.now() }) }, () => { if (live) setHealth({ h: null, at: Date.now() }) })
    read()
    const timer = window.setInterval(read, 5 * 60_000)
    const onVis = () => { if (document.visibilityState === 'visible') read() }
    document.addEventListener('visibilitychange', onVis)
    return () => { live = false; window.clearInterval(timer); document.removeEventListener('visibilitychange', onVis) }
  }, [botId, bot?.last_turn_at])
  const silent = botSilentLine(health.h, health.h?.lastTurnAt ?? bot?.last_turn_at, health.at)

  return (
    <div className="dcl-chats" data-chats>
      <label className="dcl-search">
        <CIcon name="search" />
        <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Search chats" aria-label="Search chats" />
      </label>
      {bot && !needle && (
        <div className="dcl-bot">
          <button type="button" className="dcl-bot-m" onClick={() => pick(() => chat.openBot())}>
            <b>Claude's thread{chat.botUnread && <em className="dcl-new">new</em>}</b>
            <small>{bot.turn_count} turns{bot.last_turn_at ? ` · last ${warsawDow(bot.last_turn_at)} ${warsawDm(bot.last_turn_at)}` : ''}</small>
            {silent && <span className="dcl-bot-warn" role="status" data-bot-silent>{silent}</span>}
          </button>
          <span className="dcl-bot-l">Pushes {muted ? 'off' : 'on'}</span>
          <button
            type="button" role="switch" aria-checked={!muted} disabled={!online}
            className={`dcl-tg${muted ? '' : ' dcl-on'}`} data-verb={muted ? 'unmute' : 'mute'}
            aria-label={muted ? 'Pushes from Claude are off. Turn them on' : 'Turn off pushes from Claude'}
            onClick={() => chat.setBotPushMuted(!muted)}
          />
        </div>
      )}
      {threads === null && <Skeleton lines={5} label="Reading your chats" />}
      {failed && <Failed what="your chats" onRetry={reload} />}
      {threads !== null && !failed && asks.length === 0 && (
        <div className="dcl-dim dcl-pad">{needle ? 'No chat matches that.' : 'No other chats yet.'}</div>
      )}
      {chatsByDay(asks).map(d => (
        <div key={d.label}>
          <div className="dcl-dd">{d.label}</div>
          {d.items.map(t => {
            const tail = chatTail(t)
            const current = t.id === chat.threadId
            return (
              <button type="button" key={t.id} className={`dcl-chat${current ? ' dcl-cur' : ''}${tail.failed ? ' dcl-err' : ''}`}
                aria-current={current || undefined} onClick={() => pick(() => chat.openThread(t.id))}>
                <b>{t.title ? shortTitle(t.title, 90) : 'Untitled chat'}</b>
                <span>{current && chat.busy ? 'running' : tail.text}{t.last_turn_at ? ` · ${warsawHm(t.last_turn_at)}` : ''}</span>
              </button>
            )
          })}
        </div>
      ))}
    </div>
  )
}
