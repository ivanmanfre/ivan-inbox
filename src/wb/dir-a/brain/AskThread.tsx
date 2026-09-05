/* ==========================================================================
   src/wb/dir-a/brain/AskThread.tsx: S29.

   03-DIRECTION moves 9 to 12: the answer reveals as it streams with a caret
   riding the tail, ONE status line shimmers while Claude works and goes flat
   the instant it resolves, a collapsible group lists what the turn touched,
   and the sources are numbered where they are listed.

   Every hook, guard, effect and string of the old thread is kept. What is
   rebuilt is the view: the shelf, the turns and the answer prose sit on the
   design system and on `../kit`, and every glyph the old markup typed is a
   named icon now.
   ========================================================================== */
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Button, Chip, Icon, Working, fadeT, list, rise, spring } from '../../../ds'
import { parseMarkdown, type InlineNode } from '../../../exp/v2c/chat/renderer'
import { turnOutcome, type Turn } from '../../../exp/v2c/chat/events'
import { abortTurn } from '../../../lib/turns'
import type { ChatHandle } from '../../../exp/v2c/useChat'
import type { Job } from '../../../exp/v2c/layout'
import { extractRecallNouns, buildRecallCommand } from '../../../exp/brain/b/recall'
import { groundedClause, sourceBasenames, sourcesChipLabel } from '../../../exp/brain/b/brainMeta'
import { detectLinks } from '../../../lib/unfurl'
import { ToolStrip, TurnMeta } from './Tools'
import { LinkPreview } from './LinkPreview'
import { Composer } from './Composer'
import './brain.css'

// The one place a turn error's text is checked against D6's exact copy. The
// broker reports `thread_busy` as NOT retryable already (transport.ts's
// RETRYABLE set omits it), so `turn.error.retryable` is false there by
// construction. this constant exists only so the composer can also disable
// SENDING pre-emptively rather than let the operator draw the refusal.
const THREAD_BUSY_RE = /still working on the last one/i

/**
 * The transport writes for an engineer. Both of its sentences put a name he has
 * never heard of on the glass, and one puts an em dash there too. The skin
 * cannot edit the transport, so it maps at the render. Anything unmapped falls
 * through to the transport's own words rather than to an invented sentence.
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
  return message.replace(/\bbrokers?\b/gi, 'Claude').replace(/\s+—\s+/g, '. ')
}

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
            type="button" className="a-brain-recall" data-recall data-noun={part} key={key++}
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
 * The answer's footer. What the brain read and what it was grounded on are
 * CHIPS on one row under the prose, not a stack of lines: they are metadata
 * about the answer, and a conversation surface keeps metadata to the footer
 * where the eye can skip it. The count and the list are the memory files ALONE
 * (brainMeta.ts); the summary is its own chip and is never counted as a file.
 *
 * Move 12 asked for numbered citation marks. The marks are numbered HERE,
 * where the sources are listed, and not inline in the prose: nothing in
 * `turn.sources` says which claim came from which file, so an inline mark
 * would be an attribution this surface invented.
 */
function AnswerFooter({ turn }: { turn: Turn }) {
  const [open, setOpen] = useState(false)
  const label = sourcesChipLabel(turn.sources)
  const grounded = groundedClause(turn.sources)
  if (!label && !grounded) return null
  const names = sourceBasenames(turn.sources)
  return (
    <div className="a-wrapline">
      {label && (
        <Chip icon={open ? 'discloseUp' : 'disclose'} onClick={() => setOpen(v => !v)} selected={open}>
          <span data-sources>{label}</span>
        </Chip>
      )}
      {grounded && <Chip tone="quiet">{grounded}</Chip>}
      <AnimatePresence initial={false}>
        {open && names.length > 0 && (
          <motion.div
            className="a-brain-cites"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0, transition: spring }}
            exit={{ opacity: 0, transition: fadeT }}
          >
            {names.map((n, i) => (
              <span className="a-brain-cite" key={n}>
                <span className="a-brain-cite-n">{i + 1}</span>
                <span className="a-brain-cite-p">{n}</span>
              </span>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function AnswerCard({ turn, onRetry, onRecall, justLanded, focused }: {
  turn: Turn; onRetry?: () => void; onRecall: (noun: string) => void; justLanded: boolean; focused: boolean
}) {
  const outcome = turnOutcome(turn)
  const isBusy = THREAD_BUSY_RE.test(turn.error?.message ?? '')
  return (
    <motion.div
      className="a-brain-answer"
      data-answer data-turn={turn.turnId ?? turn.id}
      data-focus={focused ? '' : undefined}
      data-settle={justLanded ? '' : undefined}
      animate={justLanded ? { opacity: [0, 1], y: [8, 0] } : { opacity: 1, y: 0 }}
      transition={spring}
    >
      <TurnMeta turn={turn} outcome={outcome} />
      <ToolStrip calls={turn.tools} />
      {turn.text && <div className="a-brain-prose">{<AnswerBody text={turn.text} onRecall={onRecall} />}</div>}
      {detectLinks(turn.text || '').slice(0, 1).map(l => <LinkPreview key={l.url} url={l.url} />)}
      {turn.aborted && <div className="a-brain-note">You stopped this one. Nothing more is coming.</div>}
      {turn.error && (
        <div className="a-brain-err">
          <Icon name="error" size={16} />
          <span>{errorCopy(turn.error.message)}</span>
          {/* thread_busy is not retryable at the transport level already; this
              extra text check is belt-and-braces for a message that reached
              here through any other path. */}
          {turn.error.retryable && !isBusy && onRetry && (
            <Button variant="quiet" size="sm" icon="retry" onClick={onRetry}>Retry</Button>
          )}
        </div>
      )}
      <AnswerFooter turn={turn} />
    </motion.div>
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
  /** The turn a push notification named (`boot.turn`, or a feed row's own
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
    <div className="a-brain-ask">
      <div className="a-brain-thread" ref={scroller}>
        <div className="a-brain-shelf">
          <span className="a-brain-shelf-t">{sessionLine(chat.grounding)}</span>
          <span data-new-thread>
            <Button variant="quiet" size="sm" icon="add" onClick={() => chat.newThread()}>New thread</Button>
          </span>
        </div>

        {empty ? (
          <motion.div className="a-stack" variants={list} initial="hidden" animate="show">
            <motion.div className="a-page-t" variants={rise}>
              {about ? <>Ask about {about}.</> : 'Ask anything.'}
            </motion.div>
            <motion.div className="a-body-t" variants={rise}>
              {about
                ? 'Claude keeps this thread between turns. The transcript is the continuity.'
                : 'Claude reads your memory, the calls and every lane before it answers, and keeps this thread between turns.'}
            </motion.div>
            <motion.div className="a-brain-starters" variants={rise}>
              {STARTERS.map(s => (
                <Button key={s} variant="outline" iconEnd="next" onClick={() => send(s)}>{s}</Button>
              ))}
            </motion.div>
          </motion.div>
        ) : (
          chat.turns.map(t => t.role === 'user' ? (
            <div className="a-brain-uturn" key={t.id} data-turn={t.turnId ?? t.id}>
              <div className="a-brain-ubub">{t.text}</div>
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
            this line was two controls for one state. */}
        {runningElsewhereActive && (
          <div data-running-elsewhere>
            <Working live>Still working on this. It started on another screen and it will land here on its own.</Working>
          </div>
        )}

        <AnimatePresence initial={false}>
          {chat.busy && (
            <motion.div
              className="a-brain-answer" data-live=""
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0, transition: spring }}
              exit={{ opacity: 0, transition: fadeT }}
            >
              {chat.streamTools.length > 0 && <ToolStrip calls={chat.streamTools} />}
              {chat.streamText && (
                <div className="a-brain-prose">
                  <AnswerBody text={chat.streamText} onRecall={onRecall} />
                  <span className="a-brain-caret" aria-hidden="true" />
                </div>
              )}
              {/* Move 11: ONE status line while Claude works, and it goes flat
                  by leaving, the instant the turn resolves. The system's own
                  `Working` carries the live treatment, so this surface spends
                  its single continuous loop here and nowhere else. */}
              <Working live>
                {chat.slow ? 'Still starting up. The first one is the slow one.' : "Keeps working if you lock the phone. You'll get a notification."}
              </Working>
            </motion.div>
          )}
        </AnimatePresence>
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
