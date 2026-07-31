import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Avatar } from '../components/Avatar'
import { PullIndicator } from '../components/PullIndicator'
import { usePullToRefresh } from '../hooks/usePullToRefresh'
import { filterThreads, searchThreads, threadKind, type Filter, type Thread, eventTime } from '../lib/inbox'

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

// ---- windowed list (opt-in) ----
//
// fetchMessages pages up to 20,000 rows and groupThreads renders every one of
// them: the live inbox is ~1,354 rows, 83,453px of DOM and 49,558 words at
// 390px, and the word count does not change between 390px and 1440px because it
// tracks the DOM, not the screen. Nine rows are ever visible.
//
// The build contract forbids a virtualization dependency unless it is ~40 lines
// implemented here and justified. This is those lines. Rows are a fixed 72px
// (12px padding + a 48px avatar), so a scroll offset maps straight to an index;
// the unrendered remainder is held open by two spacer divs so the scrollbar and
// every scroll position stay honest. Opt-in via `windowed` — the live app passes
// nothing and behaves exactly as before.
const ROW_H = 73
const OVERSCAN = 6

function useRowWindow(ref: React.RefObject<HTMLDivElement | null>, count: number, on: boolean) {
  const [top, setTop] = useState(0)
  const [view, setView] = useState(900)
  useEffect(() => {
    const el = ref.current
    if (!el || !on) return
    const onScroll = () => setTop(el.scrollTop)
    const onSize = () => setView(el.clientHeight || 900)
    onSize()
    el.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onSize)
    return () => { el.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onSize) }
  }, [ref, on])
  if (!on) return { start: 0, end: count, padTop: 0, padBottom: 0 }
  const start = Math.max(0, Math.floor(top / ROW_H) - OVERSCAN)
  const end = Math.min(count, Math.ceil((top + view) / ROW_H) + OVERSCAN)
  return { start, end, padTop: start * ROW_H, padBottom: (count - end) * ROW_H }
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

export function InboxScreen({ threads, filter, setFilter, refresh, onOpenThread, onOpenDrafts, activeThread = null, windowed = false, head }: {
  threads: Thread[]
  filter: Filter
  setFilter: (f: Filter) => void
  refresh: () => void
  onOpenThread: (id: string) => void
  onOpenDrafts: () => void
  activeThread?: string | null
  // Render only the rows near the viewport. Off by default so the live app is
  // untouched; the workbench turns it on because it mounts this list beside two
  // other live regions.
  windowed?: boolean
  // Optional slot under the filter chips. The live app passes nothing.
  head?: ReactNode
}) {
  const rowsRef = useRef<HTMLDivElement>(null)
  const ptr = usePullToRefresh(rowsRef, () => refresh())
  const [query, setQuery] = useState('')
  const shown = searchThreads(filterThreads(threads, filter), query)
  const win = useRowWindow(rowsRef, shown.length, windowed)
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

      {head}

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
          <>
          {win.padTop > 0 && <div style={{ height: win.padTop }} aria-hidden />}
          {shown.slice(win.start, win.end).map(t => {
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
                  <span className="time">{timeAgo(eventTime(t.last))}</span>
                  {t.unread > 0 && <span className="udot" />}
                  {t.draft != null && <span className="dpill">DRAFT</span>}
                </div>
              </div>
            )
          })}
          {win.padBottom > 0 && <div style={{ height: win.padBottom }} aria-hidden />}
          </>
        )}
      </div>
    </>
  )
}
