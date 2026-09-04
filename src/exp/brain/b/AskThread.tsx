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
import { groundedClause, sourceBasenames, sourcesChipLabel } from './brainMeta'
import { LinkPreview } from './LinkPreview'
import { detectLinks } from '../../../lib/unfurl'
import { Composer } from './Composer'

// The one place a turn error's text is checked against D6's exact copy. The
// broker reports `thread_busy` as NOT retryable already (transport.ts's
// RETRYABLE set omits it), so `turn.error.retryable` is false there by
// construction — this constant exists only so the composer can also disable
// SENDING pre-emptively rather than let the operator draw the refusal.
const THREAD_BUSY_RE = /still working on the last one/i

/**
 * Every plain-text run, split on recall nouns, with the FIRST unclaimed noun in
 * each block turned into a real control. Code, bold spans and existing links
 * pass through untouched: recall reads off narrative prose, not off something
 * already marked up.
 *
 * One control per block is a deliberate cap. It keeps the prose from becoming a
 * field of underlines, and it keeps two 44px hit zones from stacking on
 * consecutive lines, where the lower one would swallow the upper one's bottom
 * edge (`elementFromPoint` returns whichever positioned overlay painted last).
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
    // Emphasis without italics: the house canon retired italic body outright,
    // so the model's `*emphasis*` lands as a weight step instead of a slant.
    if (n.t === 'em') { out.push(<em className="bb-em" key={key++}>{n.v}</em>); continue }
    if (n.t === 'link') { out.push(<a className="msg-link" href={n.href} target="_blank" rel="noreferrer" key={key++}>{n.v}</a>); continue }
    if (!re) { out.push(<span key={key++}>{n.v}</span>); continue }
    const parts = n.v.split(re)
    for (const part of parts) {
      if (!claim.used && nouns.includes(part)) {
        claim.used = true
        out.push(
          <button
            type="button" className="bb-recall" data-recall data-noun={part} key={key++}
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

function AnswerBody({ text, onRecall }: { text: string; onRecall: (noun: string) => void }) {
  const nouns = extractRecallNouns(text)
  const blocks = parseMarkdown(text)
  return (
    <>
      {blocks.map((b, i) => {
        const claim = { used: false }
        if (b.t === 'code') {
          return (
            <pre className={`wb-code${b.open ? ' open' : ''}`} key={i}>
              {b.lang && <span className="wb-code-l">{b.lang}</span>}
              <code>{b.text}</code>
            </pre>
          )
        }
        if (b.t === 'h') return <div className={`wb-mh h${b.level}`} key={i}>{renderInline(b.nodes, nouns, onRecall, claim)}</div>
        if (b.t === 'ul') {
          return (
            <ul className={`wb-ul${b.ordered ? ' ord' : ''}`} key={i}>
              {b.items.map((it, j) => (
                <li key={j}>
                  <span className="wb-li-m">{b.ordered ? `${j + 1}.` : '·'}</span>
                  <span>{renderInline(it, nouns, onRecall, { used: claim.used || j > 0 })}</span>
                </li>
              ))}
            </ul>
          )
        }
        return <p className="wb-p" key={i}>{renderInline(b.nodes, nouns, onRecall, claim)}</p>
      })}
    </>
  )
}

/**
 * What the brain read, counted honestly. The count and the list are the memory
 * files ALONE (brainMeta.ts): the summary is named in its own clause under the
 * expansion, and the envelope's internal block ids are not a thing a reader has
 * ever heard of, so they never reach the DOM at all.
 */
function SourcesChip({ turn }: { turn: Turn }) {
  const [open, setOpen] = useState(false)
  const label = sourcesChipLabel(turn.sources)
  if (!label) return null
  const names = sourceBasenames(turn.sources)
  const grounded = groundedClause(turn.sources)
  return (
    <div className="bb-brain">
      <button type="button" className="bb-chip tap" data-sources aria-expanded={open} onClick={() => setOpen(v => !v)}>
        {label} {open ? '⌄' : '›'}
      </button>
      {open && (
        <div className="bb-sources-list">
          <span>{names.join(' · ')}</span>
          {grounded && <span className="bb-sources-on">{grounded}</span>}
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
      className={`bb-aturn${justLanded ? ' bb-settle' : ''}${focused ? ' bb-focus' : ''}`}
      data-answer data-turn={turn.turnId ?? turn.id}
    >
      <TurnMeta turn={turn} outcome={outcome} />
      <ToolStrip calls={turn.tools} />
      {turn.text && <div className="wb-body"><AnswerBody text={turn.text} onRecall={onRecall} /></div>}
      {detectLinks(turn.text || '').slice(0, 1).map(l => <LinkPreview key={l.url} url={l.url} />)}
      {turn.aborted && <div className="bb-stopped">You stopped this one. Nothing more is coming.</div>}
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

export function AskThread({ chat, job, about, mobile, focusTurn = null, onFocused }: {
  chat: ChatHandle
  job: Job
  about: string | null
  mobile: boolean
  /** The turn a push notification named (`boot.turn`, or a feed card's own
   * `&turn=` link). Scrolled to once, then marked so the thread goes back to
   * following the bottom. */
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
        const t = window.setTimeout(() => setJustLandedId(null), 260)
        return () => window.clearTimeout(t)
      }
    }
    prevBusy.current = chat.busy
  }, [chat.busy, chat.turns])

  // The deep-linked turn wins over the usual follow-the-bottom scroll, once,
  // as soon as the thread it lives in has hydrated.
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    // While a deep link is being honoured the thread does NOT chase its own
    // bottom: he arrived here to read one specific answer, and a scroll to the
    // newest turn would take it off the screen a frame later. The mark and the
    // position hold until he sends something, which is when this thread goes
    // back to being a conversation.
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

  return (
    <div className="bb-ask">
      <div className="bb-thread" ref={scroller}>
        <div className="bb-session">
          <span className="bb-session-t">{sessionLine(chat.grounding)}</span>
          <button type="button" className="bb-chip tap" data-new-thread onClick={() => chat.newThread()}>New thread</button>
        </div>

        {empty ? (
          <div className="bb-empty">
            <div className="bb-empty-t">
              {about ? <>Ask about {about}.</> : `Ask about the ${JOB_LABEL[job].toLowerCase()} you're looking at.`}
            </div>
            <div className="bb-empty-s">Claude keeps this thread between turns. The transcript is the continuity.</div>
            <div className="bb-starters">
              {STARTERS.map(s => <button key={s} className="bb-starter" onClick={() => send(s)}>{s}</button>)}
            </div>
          </div>
        ) : (
          chat.turns.map(t => t.role === 'user' ? (
            <div className="bb-uturn" key={t.id} data-turn={t.turnId ?? t.id}>
              <div className="bb-ububble">{t.text}</div>
            </div>
          ) : (
            <AnswerCard
              key={t.id} turn={t} onRetry={chat.retry} onRecall={onRecall}
              justLanded={t.id === justLandedId}
              focused={!!focusTurn && (t.turnId ?? t.id) === focusTurn}
            />
          ))
        )}

        {/* ONE stop control per state, and it is always the same control in the
            same place: the composer's trailing button, which is Send when
            nothing is open and Stop when something is. A second Stop inside
            this banner was two controls for one state. */}
        {runningElsewhereActive && (
          <div className="bb-running-banner" data-running-elsewhere>
            <span className="bb-dot3"><span /><span /><span /></span>
            <span>Still working on this. It started on another screen and it will land here on its own.</span>
          </div>
        )}

        {chat.busy && (
          <div className="bb-aturn bb-running">
            {chat.streamTools.length > 0 && <ToolStrip calls={chat.streamTools} />}
            {chat.streamText && <div className="wb-body"><AnswerBody text={chat.streamText} onRecall={onRecall} /></div>}
            <div className="bb-running-banner">
              <span className="bb-dot3"><span /><span /><span /></span>
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
        placeholder={about ? `Ask about ${about}…` : mobile ? 'Ask Claude…' : 'Ask Claude…'}
      />
    </div>
  )
}
