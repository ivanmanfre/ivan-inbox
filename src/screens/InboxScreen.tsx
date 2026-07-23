import { useRef, useState } from 'react'
import { Avatar } from '../components/Avatar'
import { PullIndicator } from '../components/PullIndicator'
import { usePullToRefresh } from '../hooks/usePullToRefresh'
import { filterThreads, searchThreads, threadKind, type Filter, type Thread } from '../lib/inbox'

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime()
  const s = Math.max(0, Math.floor((Date.now() - then) / 1000))
  const m = Math.floor(s / 60)
  if (m < 1) return 'now'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  if (d === 1) return 'yday'
  return `${d}d`
}

const CHIPS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'ivan', label: 'Ivan' },
  { key: 'risedtc', label: 'Rise' },
  { key: 'email', label: 'Email' },
]

const EMPTY: Record<Filter, string> = {
  all: 'No threads yet',
  ivan: 'No Ivan threads yet',
  risedtc: 'No Rise threads yet',
  email: 'No email threads yet',
}

function clientLabel(id: string): string {
  if (id === 'risedtc') return 'RISE'
  if (id === 'ivan') return 'IVAN'
  return id.toUpperCase()
}

export function InboxScreen({ threads, filter, setFilter, refresh, onOpenThread, onOpenDrafts, activeThread = null }: {
  threads: Thread[]
  filter: Filter
  setFilter: (f: Filter) => void
  refresh: () => void
  onOpenThread: (id: string) => void
  onOpenDrafts: () => void
  activeThread?: string | null
}) {
  const rowsRef = useRef<HTMLDivElement>(null)
  const ptr = usePullToRefresh(rowsRef, () => refresh())
  const [query, setQuery] = useState('')
  const shown = searchThreads(filterThreads(threads, filter), query)
  const draftTotal = threads.filter(t => t.draft).length
  const unreadTotal = threads.filter(t => t.unread > 0).length

  return (
    <>
      <div className="nav">
        <div className="row-top">
          <h2>Inbox</h2>
          <div className="avatar-me">IM</div>
        </div>
        <div className="search">
          <span>🔍</span>
          <input
            className="search-in"
            placeholder="Search people or messages"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
          {query && <span className="search-x" onClick={() => setQuery('')}>✕</span>}
        </div>
        <div className="chips">
          {CHIPS.map(c => (
            <span
              key={c.key}
              className={`chip ${filter === c.key ? 'on' : ''}`}
              onClick={() => setFilter(c.key)}
            >
              {c.label}
              {c.key === 'all' && unreadTotal > 0 && <span className="ct"> ·{unreadTotal}</span>}
            </span>
          ))}
        </div>
      </div>

      {draftTotal > 0 && (
        <div className="draftbanner" onClick={onOpenDrafts}>
          <div className="ic">✦</div>
          <div>
            <div className="t">{draftTotal} draft{draftTotal === 1 ? '' : 's'} waiting for you</div>
            <div className="s">Clear them in one pass</div>
          </div>
          <div className="go">›</div>
        </div>
      )}

      <div className="rows" ref={rowsRef}>
        <PullIndicator pull={ptr.pull} refreshing={ptr.refreshing} trigger={ptr.trigger} />
        {shown.length === 0 ? (
          <div className="empty">{query ? `No matches for “${query}”` : EMPTY[filter]}</div>
        ) : (
          shown.map(t => {
            const isDraftLast = t.draft != null && t.last.id === t.draft.id
            let snip = t.last.message_text
            if (isDraftLast) snip = `✦ Draft: ${t.last.message_text}`
            else if (t.last.direction === 'outbound' && t.last.sent_at) snip = `You: ${t.last.message_text}`
            return (
              <div
                key={t.prospect_id}
                className={`r ${t.unread > 0 ? 'unread' : ''} ${activeThread === t.prospect_id ? 'active' : ''}`}
                onClick={() => onOpenThread(t.prospect_id)}
              >
                <Avatar name={t.prospect_name} client_id={t.client_id} channel={t.channel} />
                <div className="mid">
                  <div className="top">
                    <span className="name">{t.prospect_name}</span>
                    <span className={`client ${t.client_id === 'risedtc' ? 'rise' : ''}`}>{clientLabel(t.client_id)}</span>
                    {threadKind(t) === 'inmail' && <span className="client kind-inmail">INMAIL</span>}
                    {threadKind(t) === 'email' && <span className="client kind-email">EMAIL</span>}
                  </div>
                  <div className="snip">{snip}</div>
                </div>
                <div className="right">
                  <span className="time">{timeAgo(t.last.created_at)}</span>
                  {t.unread > 0 && <span className="udot" />}
                  {t.draft != null && <span className="dpill">DRAFT</span>}
                </div>
              </div>
            )
          })
        )}
      </div>
    </>
  )
}
