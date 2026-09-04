import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ToolStrip, TurnMeta } from '../../../../v2c/ChatMessage'
import { parseMarkdown, type InlineNode } from '../../../../v2c/chat/renderer'
import { turnOutcome, type Turn } from '../../../../v2c/chat/events'
import { abortTurn } from '../../../../../lib/turns'
import type { ChatHandle } from '../../../../v2c/useChat'
import type { Job } from '../../../../v2c/layout'
import { extractRecallNouns, buildRecallCommand } from '../../recall'
import { groundedClause, sourceBasenames, sourcesChipLabel } from '../../brainMeta'
import { LinkPreview } from './LinkPreview'
import { detectLinks } from '../../../../../lib/unfurl'
import { Composer } from './Composer'

const THREAD_BUSY_RE = /still working on the last one/i

/**
 * Every plain-text run, split on recall nouns, with the FIRST unclaimed noun in
 * each block turned into a real control. One control per block, so the prose
 * never becomes a field of underlines and two hit zones never stack.
 */
function renderInline(
  nodes: InlineNode[],
  nouns: string[],
  onRecall: (noun: string) => void,
  claim: { used: boolean },
): ReactNode[] {
  const out: ReactNode[] = []
  let key = 0
  const sorted = [...nouns].sort((a, b) => b.length - a.length)
  const re = sorted.length
    ? new RegExp(`(${sorted.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`)
    : null
  for (const n of nodes) {
    if (n.t === 'code') { out.push(<code className="wb-ic" key={key++}>{n.v}</code>); continue }
    if (n.t === 'strong') { out.push(<b key={key++}>{n.v}</b>); continue }
    if (n.t === 'em') { out.push(<em className="bb-em" key={key++}>{n.v}</em>); continue }
    if (n.t === 'link') { out.push(<a className="msg-link" href={n.href} target="_blank" rel="noreferrer" key={key++}>{n.v}</a>); continue }
    if (!re) { out.push(<span key={key++}>{n.v}</span>); continue }
    const parts = n.v.split(re)
    for (const part of parts) {
      if (!claim.used && nouns.includes(part)) {
        claim.used = true
        out.push(
          <button
            type="button" className="bb-recall bb-a-recall" data-recall data-noun={part} key={key++}
            aria-label={`Recall what is remembered about ${part}`}
            onClick={() => onRecall(part)}
          >{part}</button>,
        )
      } else if (part) {
        out.push(<span key={key++}>{part}</span>)
      }
    }
  }
  return out
}

function AnswerBody({ text, onRecall, tail }: { text: string; onRecall: (noun: string) => void; tail?: ReactNode }) {
  const nouns = extractRecallNouns(text)
  const blocks = parseMarkdown(text)
  const last = blocks.length - 1
  return (
    <>
      {blocks.map((b, i) => {
        const claim = { used: false }
        const end = tail && i === last ? tail : null
        if (b.t === 'code') {
          return (
            <pre className={`wb-code${b.open ? ' open' : ''}`} key={i}>
              {b.lang && <span className="wb-code-l">{b.lang}</span>}
              <code>{b.text}</code>
            </pre>
          )
        }
        if (b.t === 'h') return <div className={`wb-mh h${b.level}`} key={i}>{renderInline(b.nodes, nouns, onRecall, claim)}{end}</div>
        if (b.t === 'ul') {
          return (
            <ul className={`wb-ul${b.ordered ? ' ord' : ''}`} key={i}>
              {b.items.map((it, j) => (
                <li key={j}>
                  <span className="wb-li-m">{b.ordered ? `${j + 1}.` : '·'}</span>
                  <span>{renderInline(it, nouns, onRecall, { used: claim.used || j > 0 })}{j === b.items.length - 1 ? end : null}</span>
                </li>
              ))}
            </ul>
          )
        }
        return <p className="wb-p" key={i}>{renderInline(b.nodes, nouns, onRecall, claim)}{end}</p>
      })}
    </>
  )
}

/**
 * What the brain read, and what it was grounded on: ONE footer line under the
 * answer rather than a chip on one row and a clause on another. The count is
 * the memory files alone; the summary is named in its own clause.
 */
function SourcesFooter({ turn }: { turn: Turn }) {
  const [open, setOpen] = useState(false)
  const label = sourcesChipLabel(turn.sources)
  if (!label) return null
  const names = sourceBasenames(turn.sources)
  const grounded = groundedClause(turn.sources)
  return (
    <div className="bb-brain bb-a-brain">
      {/* ONE line: what it read, and what it was grounded on, in the order a
          reader asks them. Rendered as a single run of text rather than four
          flex items, because four items in a shrinking box wrap into a column. */}
      <button
        type="button" className="bb-chip bb-a-foot tap" data-sources aria-expanded={open}
        onClick={() => setOpen(v => !v)}
      >{grounded ? `${label} · ${grounded}` : label} {open ? '⌃' : '›'}</button>
      {open && (
        <div className="bb-sources-list bb-a-foot-open">
          {names.map(n => <span key={n}>{n}</span>)}
        </div>
      )}
    </div>
  )
}

function AnswerCard({ turn, onRetry, onRecall, justLanded, focused }: {
  turn: Turn; onRetry?: () => void; onRecall: (noun: string) => void; justLanded: boolean; focused: boolean
}) {
  const outcome = turnOutcome(turn)
  const isBusy = THREAD_BUSY_RE.test(turn.error?.message ?? '')
  return (
    <div
      className={`bb-aturn bb-a-turn${justLanded ? ' bb-a-land' : ''}${focused ? ' bb-focus bb-a-focus' : ''}`}
      data-answer data-turn={turn.turnId ?? turn.id}
    >
      <TurnMeta turn={turn} outcome={outcome} />
      <ToolStrip calls={turn.tools} />
      {turn.text && <div className="wb-body bb-a-prose"><AnswerBody text={turn.text} onRecall={onRecall} /></div>}
      {detectLinks(turn.text || '').slice(0, 1).map(l => <LinkPreview key={l.url} url={l.url} />)}
      {turn.aborted && <div className="bb-stopped bb-a-note">You stopped this one. Nothing more is coming.</div>}
      {turn.error && (
        <div className="bb-turn-err bb-a-err">
          <span>{turn.error.message}</span>
          {turn.error.retryable && !isBusy && onRetry && (
            <button className="bb-retry bb-a-retry" onClick={onRetry}>Retry</button>
          )}
        </div>
      )}
      <SourcesFooter turn={turn} />
    </div>
  )
}

/**
 * The session state, and only that. The date this thread was grounded on used
 * to ride here AND under every answer; it belongs under the answer, where it is
 * a fact about that answer, so this line stops wrapping to two rows to say a
 * thing the footer says better.
 */
function sessionLine(grounding: ChatHandle['grounding']): string {
  if (!grounding) return 'New conversation'
  return grounding.session === 'resumed' ? 'Continuing this thread' : 'Fresh session'
}

const STARTERS = [
  'What is waiting on me right now?',
  'What broke today?',
  'What should I look at first?',
]

export function AskThread({ chat, about, focusTurn = null, onFocused }: {
  chat: ChatHandle
  job: Job
  about: string | null
  mobile: boolean
  focusTurn?: string | null
  onFocused?: () => void
}) {
  const [text, setText] = useState('')
  const scroller = useRef<HTMLDivElement>(null)
  const prevBusy = useRef(chat.busy)
  const [justLandedId, setJustLandedId] = useState<string | null>(null)
  const landedFocus = useRef<string | null>(null)

  useEffect(() => {
    if (prevBusy.current && !chat.busy) {
      const last = [...chat.turns].reverse().find(t => t.role === 'assistant')
      if (last) {
        setJustLandedId(last.id)
        const t = window.setTimeout(() => setJustLandedId(null), 280)
        return () => window.clearTimeout(t)
      }
    }
    prevBusy.current = chat.busy
  }, [chat.busy, chat.turns])

  useEffect(() => {
    const el = scroller.current
    if (!el) return
    if (focusTurn) {
      if (landedFocus.current === focusTurn) return
      const target = el.querySelector(`[data-answer][data-turn="${CSS.escape(focusTurn)}"]`)
        ?? el.querySelector(`[data-turn="${CSS.escape(focusTurn)}"]`)
      if (target) {
        landedFocus.current = focusTurn
        target.scrollIntoView({ block: 'center' })
      }
      return
    }
    el.scrollTop = el.scrollHeight
  }, [chat.turns.length, chat.streamText, focusTurn])

  const send = (t: string) => {
    if (!t.trim()) return
    setText('')
    onFocused?.()
    void chat.send(t, about ?? undefined)
  }
  const onRecall = (noun: string) => send(buildRecallCommand(noun))

  const lastTurn = chat.turns[chat.turns.length - 1]
  const runningElsewhereActive = chat.runningElsewhere && lastTurn?.role === 'user'
  const empty = chat.turns.length === 0 && chat.status === 'idle' && !chat.runningElsewhere

  const stopRunningElsewhere = () => {
    if (lastTurn?.turnId) void abortTurn(lastTurn.turnId)
  }

  // The one continuous thing in the app: a dot on the answer's own baseline,
  // where the next word is going to arrive.
  const dot = <span className="bb-a-dot" aria-hidden />

  return (
    <div className="bb-ask bb-a-ask">
      <div className="bb-thread bb-a-thread" ref={scroller}>
        <div className="bb-session bb-a-session">
          <span className="bb-session-t bb-a-session-t">{sessionLine(chat.grounding)}</span>
          <button type="button" className="bb-chip bb-a-newthread tap" data-new-thread onClick={() => chat.newThread()}>New thread</button>
        </div>

        {empty ? (
          <div className="bb-empty bb-a-empty-ask">
            <div className="bb-empty-t bb-a-empty-t">
              {about ? <>Ask about {about}.</> : 'Ask anything.'}
            </div>
            <div className="bb-empty-s bb-a-empty-s">
              Claude reads your memory, the calls and every lane before it answers, and keeps this thread between turns.
            </div>
            <div className="bb-starters bb-a-starters">
              {STARTERS.map(s => <button key={s} className="bb-starter bb-a-starter" onClick={() => send(s)}>{s}</button>)}
            </div>
          </div>
        ) : (
          chat.turns.map(t => t.role === 'user' ? (
            <div className="bb-uturn bb-a-you" key={t.id} data-turn={t.turnId ?? t.id}>
              <div className="bb-ububble bb-a-you-t">{t.text}</div>
            </div>
          ) : (
            <AnswerCard
              key={t.id} turn={t} onRetry={chat.retry} onRecall={onRecall}
              justLanded={t.id === justLandedId}
              focused={!!focusTurn && (t.turnId ?? t.id) === focusTurn}
            />
          ))
        )}

        {runningElsewhereActive && (
          <div className="bb-running-banner bb-a-running" data-running-elsewhere>
            {dot}
            <span>Still working on this. It started on another screen and it will land here on its own.</span>
          </div>
        )}

        {chat.busy && (
          <div className="bb-aturn bb-running bb-a-turn">
            {chat.streamTools.length > 0 && <ToolStrip calls={chat.streamTools} />}
            {chat.streamText && (
              <div className="wb-body bb-a-prose">
                <AnswerBody text={chat.streamText} onRecall={onRecall} tail={dot} />
              </div>
            )}
            <div className="bb-running-banner bb-a-running">
              {!chat.streamText && dot}
              <span>{chat.slow ? 'Still starting up. The first one is the slow one.' : "Keeps working if you lock the phone. You'll get a notification."}</span>
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
        placeholder={about ? `Ask about ${about}` : 'Ask Claude'}
      />
    </div>
  )
}
