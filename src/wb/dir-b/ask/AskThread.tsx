/* =========================================================================
   Direction B - S29, the Ask thread. Phone, and the same parts inside the
   desktop pane.

   Copied from `src/exp/brain/b/skins/b/AskThread.tsx`. Every hook and its call
   order, every effect and its dependency array, the deep-link scroll and its
   `[data-answer][data-turn]` selectors, `send`, `onRecall`,
   `stopRunningElsewhere` (the `abortTurn` write) and every user-visible string
   are the source's, unchanged. Only the view changed.

   The moves this file carries:
   - MOVE 10 (Response Stream, ibelick; AI Streaming Text). The streaming answer
     reveals word by word as a fade and a cursor rides its tail. The data path is
     untouched: this is still `chat.streamText`, rendered one span per word.
   - MOVE 11 (Text Shimmer + Tool Group, serafimcloud). ONE status line shimmers
     while Claude works, on `.dirb-working[data-live="true"]`, and goes flat the
     instant the turn resolves. It is the ONE continuous loop on this surface,
     which is why nothing else here ripples, blinks or spins. Under the answer,
     `ToolGroup` collapses what the turn touched into one line.
   - MOVE 12 (AI Response, educalvolpz). The sources chip became small numbered
     marks INLINE at the end of the last claim; pressing one names the files.
   - Bubbles (Agent Chat, serafimcloud). Only our own turns are boxed, and the
     operator's own turn takes the accent tint. Claude's answer is plain
     left-aligned text with no bubble.
   ========================================================================= */
import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Banner, Button, Chip, Icon, cx, list, rise } from '../../../ds'
import { turnOutcome, type Turn } from '../../../exp/v2c/chat/events'
import { abortTurn } from '../../../lib/turns'
import type { ChatHandle } from '../../../exp/v2c/useChat'
import type { Job } from '../../../exp/v2c/layout'
import { buildRecallCommand } from '../../../exp/brain/b/recall'
import { groundedClause, sourceBasenames, sourcesChipLabel } from '../../../exp/brain/b/brainMeta'
import { detectLinks } from '../../../lib/unfurl'
import { useDsBody } from '../shell'
import { AnswerBody } from './AnswerBody'
import { ToolGroup } from './ToolGroup'
import { LinkPreview } from './LinkPreview'
import { Composer } from './Composer'
import './ask.css'

/** The separator the source prints between file names. */
const SEP = ' \u00b7 '

// The one place a turn error's text is checked against D6's exact copy. The
// broker reports `thread_busy` as NOT retryable already (transport.ts's
// RETRYABLE set omits it), so `turn.error.retryable` is false there by
// construction. This constant exists only so the composer can also disable
// SENDING pre-emptively rather than let the operator draw the refusal.
const THREAD_BUSY_RE = /still working on the last one/i

/**
 * The transport writes for an engineer: "Broker unreachable (502). Nothing was
 * sent." and "Stream ended early, the broker dropped the connection." Both put
 * a name he has never heard of on the glass. `src/lib/claude.ts` already keeps
 * `CLAUDE_ERROR_COPY` for exactly this reason; the skin cannot edit the
 * transport, so it maps at the render. Anything unmapped falls through to the
 * transport's own words rather than to an invented sentence.
 */
const ERROR_COPY: [RegExp, string][] = [
  [/broker unreachable|could not reach|econnrefused|network error/i, 'Claude could not be reached. Nothing was sent.'],
  [/stream ended early|dropped the connection|stream (?:closed|aborted)/i, 'The answer stopped early. Send it again.'],
  [/timed? ?out|timeout/i, 'That took too long and stopped. Send it again.'],
]

export function errorCopy(message: string): string {
  for (const [re, plain] of ERROR_COPY) if (re.test(message)) return plain
  // Never leak a name he has not been introduced to, even from a string this
  // map has not seen.
  return message.replace(/\bbrokers?\b/gi, 'Claude').replace(/\s+\u2014\s+/g, '. ')
}

/**
 * MOVE 12. What the brain read, as numbered marks that sit right after the
 * claim instead of as a chip over a list at the bottom. The count and the list
 * are the memory files ALONE (brainMeta.ts): the summary is named in its own
 * clause under the answer, and the envelope's internal block ids are not a
 * thing a reader has ever heard of, so they never reach the DOM at all.
 *
 * The collapsed label the chip used to print is still here, as the group's
 * spoken name and as the first thing the expansion says, so nothing that was
 * readable stopped being readable.
 */
function Cites({ names, label, open, onToggle }: {
  names: string[]; label: string | null; open: boolean; onToggle: () => void
}) {
  if (names.length === 0) return null
  return (
    <span className="dirb-ask-cites" role="group" aria-label={label ?? undefined}>
      {names.map((n, i) => (
        <button
          key={n} type="button" className="dirb-ask-cite" data-sources data-tap
          aria-expanded={open} aria-label={n} onClick={onToggle}
        >{i + 1}</button>
      ))}
    </span>
  )
}

/**
 * The answer card's footer. What the answer was grounded on is a flat chip
 * under the prose, not a line of its own: it is metadata about the answer, and
 * a conversation surface keeps metadata where the eye can skip it. The
 * grounding date is never counted as a file.
 */
function AnswerFooter({ turn, open, names, label }: {
  turn: Turn; open: boolean; names: string[]; label: string | null
}) {
  const grounded = groundedClause(turn.sources)
  if (!grounded && !(open && names.length > 0)) return null
  return (
    <div className="dirb-col" data-answer-foot>
      {open && names.length > 0 && (
        <div className="dirb-ask-sources ds-t-meta dirb-dim">
          {label ? `${label}${SEP}` : ''}{names.join(SEP)}
        </div>
      )}
      {grounded && (
        <div className="dirb-row-wrap">
          <Chip tone="quiet">{grounded}</Chip>
        </div>
      )}
    </div>
  )
}

function AnswerCard({ turn, onRetry, onRecall, justLanded, focused }: {
  turn: Turn; onRetry?: () => void; onRecall: (noun: string) => void; justLanded: boolean; focused: boolean
}) {
  const [open, setOpen] = useState(false)
  const outcome = turnOutcome(turn)
  const isBusy = THREAD_BUSY_RE.test(turn.error?.message ?? '')
  const label = sourcesChipLabel(turn.sources)
  const names = sourceBasenames(turn.sources)
  const cites = <Cites names={names} label={label} open={open} onToggle={() => setOpen(v => !v)} />
  return (
    <div
      className="dirb-bubble dirb-ask-answer"
      data-mine="false"
      data-answer data-turn={turn.turnId ?? turn.id}
      data-settle={justLanded ? 'true' : 'false'}
      data-focused={focused ? 'true' : 'false'}
    >
      <TurnMeta turn={turn} outcome={outcome} />
      {turn.text && <AnswerBody text={turn.text} onRecall={onRecall} tail={cites} />}
      {detectLinks(turn.text || '').slice(0, 1).map(l => <LinkPreview key={l.url} url={l.url} />)}
      {!turn.text && cites}
      {turn.aborted && (
        <div className="dirb-ask-stopped ds-t-meta dirb-dim">You stopped this one. Nothing more is coming.</div>
      )}
      {turn.error && (
        /* thread_busy is not retryable at the transport level already; this
           extra text check is belt-and-braces for a message that reached here
           through any other path. */
        <Banner
          tone="attention" icon="alert" className="dirb-ask-err"
          action={turn.error.retryable && !isBusy && onRetry
            ? <Button size="sm" icon="retry" data-tap onClick={onRetry}>Retry</Button>
            : undefined}
        >{errorCopy(turn.error.message)}</Banner>
      )}
      <ToolGroup calls={turn.tools} />
      <AnswerFooter turn={turn} open={open} names={names} label={label} />
    </div>
  )
}

// Per-turn cost and latency, kept from the source (which kept it from v2a). It
// rides on the TURN, not the pane, so a transcript scrolled back through still
// says what each answer took. The bar is the encoding: the felt difference
// between a 2s answer and a 9s one is what a bar against a fixed 10s scale
// shows for free. Amber past 8s, which is attention, not alarm.
const LATENCY_SCALE_MS = 10_000

function TurnMeta({ turn, outcome }: { turn: Turn; outcome: 'ok' | 'error' | 'aborted' }) {
  const parts: string[] = []
  if (turn.durationMs != null) parts.push(`${(turn.durationMs / 1000).toFixed(1)}s`)
  // Null cost is the honest state against the real broker, which reports none.
  if (turn.costUsd != null) parts.push(`$${turn.costUsd.toFixed(4)}`)
  return (
    <div className="dirb-ask-meta dirb-row">
      <Icon name="ask" size={16} />
      <span className="ds-t-meta">Claude</span>
      <span className="dirb-ask-dot" data-outcome={outcome} />
      {parts.length > 0 && <span className="ds-t-mono">{parts.join(SEP)}</span>}
      {turn.durationMs != null && (
        <span className="dirb-ask-bar" aria-hidden>
          <span
            data-slow={turn.durationMs > 8000 ? 'true' : 'false'}
            style={{ width: `${Math.max(2, Math.min(100, (turn.durationMs / LATENCY_SCALE_MS) * 100))}%` }}
          />
        </span>
      )}
    </div>
  )
}

/** MOVE 11. The ONE status line. It shimmers while it is live and goes flat the
 * instant it resolves, and it is the only continuous motion on this surface. */
function Status({ live, children, ...rest }: {
  live: boolean; children: React.ReactNode
} & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx('dirb-working', 'dirb-ask-status')} data-live={live ? 'true' : 'false'} role="status" {...rest}>
      <span>
        <Icon name="running" size={16} />
        <span className="ds-t-meta">{children}</span>
      </span>
    </div>
  )
}

function sessionLine(grounding: ChatHandle['grounding']): string {
  // The grounding date already sits under every answer as its own chip, so the
  // shelf says only which session this is and never truncates at 390.
  if (!grounding) return 'New conversation'
  return grounding.session === 'resumed' ? 'Continuing this thread' : 'Fresh session'
}

const STARTERS = [
  'What is waiting on me right now?',
  'What broke today?',
  'What should I look at first?',
]

export function AskThread({ chat, about, mobile, focusTurn = null, onFocused }: {
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
  useDsBody()
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
    <div className="dirb-ask">
      <div className="dirb-thread dirb-ask-thread" ref={scroller}>
        <div className="dirb-ask-session dirb-spread">
          <span className="ds-t-meta dirb-dim">{sessionLine(chat.grounding)}</span>
          <span data-new-thread data-tap>
            <Chip icon="add" onClick={() => chat.newThread()}>New thread</Chip>
          </span>
        </div>

        {empty ? (
          <div className="dirb-ask-empty dirb-col">
            <div className="ds-t-page">
              {about ? <>Ask about {about}.</> : 'Ask anything.'}
            </div>
            <div className="ds-t-body dirb-quiet">
              {about
                ? 'Claude keeps this thread between turns. The transcript is the continuity.'
                : 'Claude reads your memory, the calls and every lane before it answers, and keeps this thread between turns.'}
            </div>
            <motion.div className="dirb-ask-starters" variants={list} initial="hidden" animate="show">
              {STARTERS.map(s => (
                <motion.span key={s} variants={rise}>
                  <Chip onClick={() => send(s)}>{s}</Chip>
                </motion.span>
              ))}
            </motion.div>
          </div>
        ) : (
          chat.turns.map(t => t.role === 'user' ? (
            <div
              className="dirb-bubble dirb-ask-ububble"
              data-mine="true" data-ours="true"
              key={t.id} data-turn={t.turnId ?? t.id}
            >{t.text}</div>
          ) : (
            <AnswerCard
              key={t.id} turn={t} onRetry={chat.retry} onRecall={onRecall}
              justLanded={t.id === justLandedId}
              focused={!!focusTurn && (t.turnId ?? t.id) === focusTurn}
            />
          ))
        )}

        <AnimatePresence initial={false}>
          {/* ONE stop control per state, and it is always the same control in
              the same place: the composer's trailing button, which is Send when
              nothing is open and Stop when something is. A second Stop inside
              this line was two controls for one state. */}
          {runningElsewhereActive && (
            <motion.div key="elsewhere" variants={rise} initial="hidden" animate="show" exit="exit">
              {/* The shimmer is handed to the streaming turn when there is one,
                  so this surface never runs two continuous loops at once. */}
              <Status live={!chat.busy} data-running-elsewhere>
                Still working on this. It started on another screen and it will land here on its own.
              </Status>
            </motion.div>
          )}

          {chat.busy && (
            <motion.div
              key="streaming" className="dirb-bubble dirb-ask-answer" data-mine="false"
              variants={rise} initial="hidden" animate="show" exit="exit"
            >
              {chat.streamText && (
                <AnswerBody
                  text={chat.streamText} onRecall={onRecall} reveal
                  tail={<span className="dirb-ask-caret" aria-hidden />}
                />
              )}
              <ToolGroup calls={chat.streamTools} defaultOpen />
              <Status live>
                {chat.slow ? 'Still starting up. The first one is the slow one.' : "Keeps working if you lock the phone. You'll get a notification."}
              </Status>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="dirb-foot dirb-ask-foot">
        <Composer
          value={text}
          onChange={setText}
          onSend={send}
          busy={chat.busy}
          runningElsewhere={!!runningElsewhereActive}
          onStop={chat.busy ? chat.abort : stopRunningElsewhere}
          placeholder={about ? `Ask about ${about}\u2026` : mobile ? 'Ask Claude\u2026' : 'Ask Claude\u2026'}
        />
      </div>
    </div>
  )
}
