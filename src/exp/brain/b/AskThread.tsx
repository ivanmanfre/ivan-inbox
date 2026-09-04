import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ToolStrip, TurnMeta } from '../../v2c/ChatMessage'
import { parseMarkdown, type InlineNode } from '../../v2c/chat/renderer'
import { turnOutcome, type Turn } from '../../v2c/chat/events'
import { abortTurn } from '../../../lib/turns'
import type { ChatHandle } from '../../v2c/useChat'
import type { Job } from '../../v2c/layout'
import { JOB_LABEL } from '../../v2c/layout'
import { extractRecallNouns, buildRecallCommand } from './recall'
import { LinkPreview } from './LinkPreview'
import { detectLinks } from '../../../lib/unfurl'
import { Composer } from './Composer'

// The one place a turn error's text is checked against D6's exact copy. The
// broker (inbox-claude v16) reports `thread_busy` as NOT retryable already
// (transport.ts's RETRYABLE set omits it), so `turn.error.retryable` is false
// there by construction — this constant exists only so the composer can also
// disable SENDING pre-emptively rather than let the operator draw the 409.
const THREAD_BUSY_RE = /still working on the last one/i

function basename(path: string): string {
  const parts = path.split('/')
  return parts[parts.length - 1] || path
}

/** Every plain-text run, further split on recall nouns and underlined. Code,
 * bold/italic spans and existing links pass through untouched — recall reads
 * off the narrative prose, not off something already marked up. */
function renderInline(nodes: InlineNode[], nouns: string[], onRecall: (noun: string) => void): ReactNode[] {
  const out: ReactNode[] = []
  let key = 0
  const sorted = [...nouns].sort((a, b) => b.length - a.length)
  const re = sorted.length
    ? new RegExp(`(${sorted.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`)
    : null
  for (const n of nodes) {
    if (n.t === 'code') { out.push(<code className="wb-ic" key={key++}>{n.v}</code>); continue }
    if (n.t === 'strong') { out.push(<b key={key++}>{n.v}</b>); continue }
    if (n.t === 'em') { out.push(<i key={key++}>{n.v}</i>); continue }
    if (n.t === 'link') { out.push(<a className="msg-link" href={n.href} target="_blank" rel="noreferrer" key={key++}>{n.v}</a>); continue }
    if (!re) { out.push(<span key={key++}>{n.v}</span>); continue }
    const parts = n.v.split(re)
    for (const part of parts) {
      if (nouns.includes(part)) {
        out.push(
          <span
            className="bb-recall" data-recall key={key++} role="button" tabIndex={0}
            onClick={() => onRecall(part)}
            onKeyDown={e => { if (e.key === 'Enter') onRecall(part) }}
          >{part}</span>,
        )
      } else if (part) {
        out.push(<span key={key++}>{part}</span>)
      }
    }
  }
  return out
}

function AnswerBody({ text, onRecall }: { text: string; onRecall: (noun: string) => void }) {
  const nouns = extractRecallNouns(text)
  const blocks = parseMarkdown(text)
  return (
    <>
      {blocks.map((b, i) => {
        if (b.t === 'code') {
          return (
            <pre className={`wb-code${b.open ? ' open' : ''}`} key={i}>
              {b.lang && <span className="wb-code-l">{b.lang}</span>}
              <code>{b.text}</code>
            </pre>
          )
        }
        if (b.t === 'h') return <div className={`wb-mh h${b.level}`} key={i}>{renderInline(b.nodes, nouns, onRecall)}</div>
        if (b.t === 'ul') {
          return (
            <ul className={`wb-ul${b.ordered ? ' ord' : ''}`} key={i}>
              {b.items.map((it, j) => (
                <li key={j}><span className="wb-li-m">{b.ordered ? `${j + 1}.` : '·'}</span><span>{renderInline(it, nouns, onRecall)}</span></li>
              ))}
            </ul>
          )
        }
        return <p className="wb-p" key={i}>{renderInline(b.nodes, nouns, onRecall)}</p>
      })}
    </>
  )
}

function SourcesChip({ turn }: { turn: Turn }) {
  const [open, setOpen] = useState(false)
  const sources = turn.sources ?? []
  if (sources.length === 0) return null
  const names = sources.map(s => basename(s.path))
  return (
    <div className="bb-brain">
      <button type="button" className="bb-chip tap" data-sources aria-expanded={open} onClick={() => setOpen(v => !v)}>
        read {sources.length} {sources.length === 1 ? 'memory file' : 'memory files'} {open ? '⌄' : '›'}
      </button>
      {open && <div className="bb-sources-list">{names.join(' · ')}</div>}
    </div>
  )
}

function AnswerCard({ turn, onRetry, onRecall, justLanded }: {
  turn: Turn; onRetry?: () => void; onRecall: (noun: string) => void; justLanded: boolean
}) {
  const outcome = turnOutcome(turn)
  const isBusy = THREAD_BUSY_RE.test(turn.error?.message ?? '')
  return (
    <div className={`bb-aturn${justLanded ? ' bb-settle' : ''}`} data-answer data-turn={turn.turnId ?? turn.id}>
      <TurnMeta turn={turn} outcome={outcome} />
      <ToolStrip calls={turn.tools} />
      {turn.text && <div className="wb-body"><AnswerBody text={turn.text} onRecall={onRecall} /></div>}
      {detectLinks(turn.text || '').slice(0, 1).map(l => <LinkPreview key={l.url} url={l.url} />)}
      {turn.aborted && <div className="wb-stopped">Stopped.</div>}
      {turn.error && (
        <div className="bb-turn-err">
          <span>{turn.error.message}</span>
          {/* thread_busy is not retryable at the transport level already; this
              extra text check is belt-and-braces for a message that reached
              here through any other path. */}
          {turn.error.retryable && !isBusy && onRetry && (
            <button className="bb-retry" onClick={onRetry}>Retry</button>
          )}
        </div>
      )}
      <SourcesChip turn={turn} />
    </div>
  )
}

function sessionLine(grounding: ChatHandle['grounding']): string {
  if (!grounding) return 'New conversation'
  const on = grounding.groundedOn ? ` · grounded on ${grounding.groundedOn}` : ''
  return grounding.session === 'resumed' ? `Continuing this thread${on}` : `Fresh session${on}`
}

const STARTERS = [
  'What is waiting on me right now?',
  'What broke today?',
  'What should I look at first?',
]

export function AskThread({ chat, job, about, mobile }: {
  chat: ChatHandle
  job: Job
  about: string | null
  mobile: boolean
}) {
  const [text, setText] = useState('')
  const scroller = useRef<HTMLDivElement>(null)
  const prevBusy = useRef(chat.busy)
  const [justLandedId, setJustLandedId] = useState<string | null>(null)

  useEffect(() => {
    if (prevBusy.current && !chat.busy) {
      const last = [...chat.turns].reverse().find(t => t.role === 'assistant')
      if (last) {
        setJustLandedId(last.id)
        const t = window.setTimeout(() => setJustLandedId(null), 260)
        return () => window.clearTimeout(t)
      }
    }
    prevBusy.current = chat.busy
  }, [chat.busy, chat.turns])

  useEffect(() => {
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }, [chat.turns.length, chat.streamText])

  const send = (t: string) => {
    if (!t.trim()) return
    setText('')
    void chat.send(t, about ?? undefined)
  }
  const onRecall = (noun: string) => send(buildRecallCommand(noun))

  const lastTurn = chat.turns[chat.turns.length - 1]
  const runningElsewhereActive = chat.runningElsewhere && lastTurn?.role === 'user'
  const empty = chat.turns.length === 0 && chat.status === 'idle' && !chat.runningElsewhere

  const stopRunningElsewhere = () => {
    if (lastTurn?.turnId) void abortTurn(lastTurn.turnId)
  }

  return (
    <div className="bb-ask">
      <div className="bb-thread" ref={scroller}>
        <div className="bb-session">
          <span>{sessionLine(chat.grounding)}</span>
          <span className="bb-head-sp" />
          <button type="button" className="bb-chip tap" data-new-thread onClick={() => chat.newThread()}>New thread</button>
        </div>

        {empty ? (
          <div className="bb-empty">
            <div className="bb-empty-t">
              {about ? <>Ask about {about}.</> : `Ask about the ${JOB_LABEL[job].toLowerCase()} you're looking at.`}
            </div>
            <div className="bb-empty-s">Every turn starts a fresh Claude session. The transcript is the continuity.</div>
            <div className="bb-starters">
              {STARTERS.map(s => <button key={s} className="bb-starter" onClick={() => send(s)}>{s}</button>)}
            </div>
          </div>
        ) : (
          chat.turns.map(t => t.role === 'user' ? (
            <div className="bb-uturn" key={t.id}>
              <div className="bb-ububble">{t.text}</div>
            </div>
          ) : (
            <AnswerCard key={t.id} turn={t} onRetry={chat.retry} onRecall={onRecall} justLanded={t.id === justLandedId} />
          ))
        )}

        {runningElsewhereActive && (
          <div className="bb-running-banner">
            <span className="bb-dot3"><span /><span /><span /></span>
            <span>Still working on this. Keeps working if you lock the phone — you'll get a notification.</span>
            <button type="button" className="bb-stop" data-stop onClick={stopRunningElsewhere}>Stop</button>
          </div>
        )}

        {chat.busy && (
          <div className="bb-aturn bb-running">
            {chat.streamTools.length > 0 && <ToolStrip calls={chat.streamTools} />}
            {chat.streamText && <div className="wb-body"><AnswerBody text={chat.streamText} onRecall={onRecall} /></div>}
            <div className="bb-running-banner">
              <span className="bb-dot3"><span /><span /><span /></span>
              <span>{chat.slow ? 'Still starting up — the container was cold' : "Keeps working if you lock the phone, you'll get a notification."}</span>
            </div>
          </div>
        )}
      </div>

      <Composer
        value={text}
        onChange={setText}
        onSend={send}
        busy={chat.busy}
        runningElsewhere={!!runningElsewhereActive}
        onStop={chat.busy ? chat.abort : stopRunningElsewhere}
        placeholder={about ? `Ask about ${about}…` : mobile ? 'Ask Claude…' : 'Ask Claude…'}
      />
    </div>
  )
}
