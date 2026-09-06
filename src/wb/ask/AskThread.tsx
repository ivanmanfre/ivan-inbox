/* ==========================================================================
   src/wb/ask/AskThread.tsx: S29.

   03-DIRECTION moves 9 to 12.

   9  The card the operator tapped in the feed GROWS into the thread: the
      answer it opens is animated from that card's own rectangle onto its own,
      on the one spring, and a downward drag on it takes him back to the feed.
   10 The answer reveals WORD BY WORD as it streams, each word a fade on the
      one duration, with a caret riding the tail.
   11 ONE status line shimmers while Claude works and goes flat by leaving the
      instant the turn resolves; under the answer a collapsible group lists
      what the turn touched.
   12 A source is cited INLINE, right after the sentence that names it, as a
      small numbered mark. The mark fires only where the prose really names
      the file: nothing in `turn.sources` maps a claim to a source, so a mark
      after an arbitrary claim would be an attribution this surface invented.
      The footer chip stays (S29-13 is a ledger contract) and its expanded list
      carries the SAME numbers, so a mark in the prose and a name in the list
      are one thing said twice, not two.

   Every hook, guard, effect and string of the old thread is kept. What is
   rebuilt is the view: the shelf, the turns and the answer prose sit on the
   design system and on `../kit`, and every glyph the old markup typed is a
   named icon now.
   ========================================================================== */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { AnimatePresence, animate, motion, useReducedMotion } from 'motion/react'
import { Button, Chip, Icon, Working, fadeT, list, rise, spring } from '../../ds'
import { parseMarkdown, type InlineNode } from '../../exp/v2c/chat/renderer'
import { turnOutcome, type Turn } from '../../exp/v2c/chat/events'
import { abortTurn } from '../../lib/turns'
import type { ChatHandle } from '../../exp/v2c/useChat'
import type { Job } from '../../exp/v2c/layout'
import { extractRecallNouns, buildRecallCommand } from '../../exp/brain/b/recall'
import { groundedClause, sourceBasenames, sourcesChipLabel } from '../../exp/brain/b/brainMeta'
import { detectLinks } from '../../lib/unfurl'
import { ToolStrip, TurnMeta } from './Tools'
import { LinkPreview } from './LinkPreview'
import { Composer, type ComposerExtras } from './Composer'
import './ask.css'

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
  return message.replace(/\bbrokers?\b/gi, 'Claude').replace(/\s+,\s+/g, '. ')
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
type Cites = { re: RegExp | null; index: Map<string, number> }

/**
 * The numbered marks, and the ONLY thing they are allowed to key on.
 *
 * `turn.sources` is a list of files, not a map from claim to file, so the only
 * honest place for an inline mark is where the prose ITSELF names the file.
 * The matcher takes each memory basename and its stem, longest first, so
 * `feedback-x-2026-09-05.md` wins over `feedback-x-2026-09-05`.
 */
function buildCites(names: string[]): Cites {
  const index = new Map<string, number>()
  const keys: string[] = []
  names.forEach((name, i) => {
    const stem = name.replace(/\.[a-z0-9]+$/i, '')
    for (const k of stem === name ? [name] : [name, stem]) {
      if (index.has(k)) continue
      index.set(k, i + 1)
      keys.push(k)
    }
  })
  if (!keys.length) return { re: null, index }
  keys.sort((a, b) => b.length - a.length)
  return {
    re: new RegExp(`(${keys.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`),
    index,
  }
}

/** One word of a streaming answer: it fades in on mount and never again, so a
 * word already on screen holds still while the next one arrives. */
function words(text: string, keyBase: string): ReactNode[] {
  // Split KEEPING the whitespace, so a word's own key never shifts as the
  // stream grows and an already-mounted word is never remounted (which would
  // replay its fade).
  return text.split(/(\s+)/).map((w, i) => (
    w.trim()
      ? <span className="a-brain-w" key={`${keyBase}:${i}`}>{w}</span>
      : <span key={`${keyBase}:${i}`}>{w}</span>
  ))
}

function renderInline(
  nodes: InlineNode[],
  nouns: string[],
  onRecall: (noun: string) => void,
  claim: { used: boolean },
  opts: { stream?: boolean; cites?: Cites; block?: number } = {},
): ReactNode[] {
  const out: ReactNode[] = []
  let key = 0
  const b = opts.block ?? 0
  const plain = (text: string): ReactNode => (
    opts.stream
      ? <span key={key++}>{words(text, `${b}:${key}`)}</span>
      : <span key={key++}>{text}</span>
  )
  const sorted = [...nouns].sort((a, b) => b.length - a.length)
  const re = sorted.length
    ? new RegExp(`(${sorted.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`)
    : null
  // A run of prose, split first on the source names it really carries (move 12)
  // and then on the recall nouns. The mark rides AFTER the name, which is where
  // a citation goes.
  const run = (text: string): void => {
    const cites = opts.cites
    const pieces = cites?.re ? text.split(cites.re) : [text]
    for (const piece of pieces) {
      const n = cites?.index.get(piece)
      if (n !== undefined) {
        out.push(
          <span className="a-brain-src" key={key++}>
            {piece}
            <sup className="a-brain-citemark" data-cite={n} aria-label={`source ${n}, ${piece}`}>{n}</sup>
          </span>,
        )
        continue
      }
      if (!piece) continue
      if (!re) { out.push(plain(piece)); continue }
      for (const part of piece.split(re)) {
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
          out.push(plain(part))
        }
      }
    }
  }
  for (const n of nodes) {
    if (n.t === 'code') { out.push(<code className="wb-ic" key={key++}>{n.v}</code>); continue }
    if (n.t === 'strong') { out.push(<b key={key++}>{n.v}</b>); continue }
    // Emphasis without italics: the house canon retired italic body outright,
    // so the model's `*emphasis*` lands as a weight step instead of a slant.
    if (n.t === 'em') { out.push(<em className="bb-em" key={key++}>{n.v}</em>); continue }
    if (n.t === 'link') { out.push(<a className="msg-link" href={n.href} target="_blank" rel="noreferrer" key={key++}>{n.v}</a>); continue }
    run(n.v)
  }
  return out
}

function AnswerBody({ text, onRecall, stream, cites }: {
  text: string
  onRecall: (noun: string) => void
  /** The turn is still arriving: reveal it a word at a time (move 10). */
  stream?: boolean
  cites?: Cites
}) {
  const nouns = extractRecallNouns(text)
  const blocks = parseMarkdown(text)
  return (
    <>
      {blocks.map((b, i) => {
        const claim = { used: false }
        const opt = { stream, cites, block: i }
        if (b.t === 'code') {
          return (
            <pre className={`wb-code${b.open ? ' open' : ''}`} key={i}>
              {b.lang && <span className="wb-code-l">{b.lang}</span>}
              <code>{b.text}</code>
            </pre>
          )
        }
        if (b.t === 'h') return <div className={`wb-mh h${b.level}`} key={i}>{renderInline(b.nodes, nouns, onRecall, claim, opt)}</div>
        if (b.t === 'ul') {
          return (
            <ul className={`wb-ul${b.ordered ? ' ord' : ''}`} key={i}>
              {b.items.map((it, j) => (
                <li key={j}>
                  <span className="wb-li-m">{b.ordered ? `${j + 1}.` : '·'}</span>
                  <span>{renderInline(it, nouns, onRecall, { used: claim.used || j > 0 }, opt)}</span>
                </li>
              ))}
            </ul>
          )
        }
        return <p className="wb-p" key={i}>{renderInline(b.nodes, nouns, onRecall, claim, opt)}</p>
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

/**
 * Move 9's half of the morph, done as a FLIP.
 *
 * The feed hands up the rectangle of the card that was tapped. On the first
 * layout after the answer mounts, this measures where the answer actually
 * landed, sets the transform that puts it back ON the card, and releases it to
 * identity on the one spring. So what the operator sees is the card he touched
 * growing into the answer, and no second copy of anything is ever on screen.
 *
 * `transformOrigin` is the top left corner because that is the corner both
 * rectangles share once the scroll has put the answer under the head.
 */
function useMorphFrom(from: DOMRect | null, done: (() => void) | undefined) {
  const ref = useRef<HTMLDivElement>(null)
  const reduced = useReducedMotion()
  const played = useRef<DOMRect | null>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !from || played.current === from) return
    played.current = from
    done?.()
    if (reduced) return
    const to = el.getBoundingClientRect()
    if (to.width === 0 || to.height === 0) return
    const sx = Math.max(0.2, from.width / to.width)
    const sy = Math.max(0.2, from.height / to.height)
    void animate(
      el,
      { transform: [`translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${sx}, ${sy})`, 'none'], opacity: [0.4, 1] },
      { ...spring },
    )
  }, [from, reduced, done])
  return ref
}

function AnswerCard({ turn, onRetry, onRecall, justLanded, focused, cites, morphFrom, onMorphed, onDragBack }: {
  turn: Turn
  onRetry?: () => void
  onRecall: (noun: string) => void
  justLanded: boolean
  focused: boolean
  cites: Cites
  /** The rect of the feed card that opened this turn, once (move 9). */
  morphFrom?: DOMRect | null
  onMorphed?: () => void
  /** A downward drag on the focused answer goes back where it came from. */
  onDragBack?: () => void
}) {
  const outcome = turnOutcome(turn)
  const isBusy = THREAD_BUSY_RE.test(turn.error?.message ?? '')
  const ref = useMorphFrom(morphFrom ?? null, onMorphed)
  const drag = focused && onDragBack
  return (
    <motion.div
      ref={ref}
      className="a-brain-answer"
      data-answer data-turn={turn.turnId ?? turn.id}
      data-focus={focused ? '' : undefined}
      data-settle={justLanded ? '' : undefined}
      animate={justLanded ? { opacity: [0, 1], y: [8, 0] } : { opacity: 1, y: 0 }}
      transition={spring}
      drag={drag ? 'y' : false}
      dragConstraints={{ top: 0, bottom: 0 }}
      dragElastic={{ top: 0, bottom: 0.5 }}
      dragDirectionLock
      onDragEnd={drag ? (_, info) => { if (info.offset.y > 120 || info.velocity.y > 600) onDragBack() } : undefined}
    >
      <TurnMeta turn={turn} outcome={outcome} />
      <ToolStrip calls={turn.tools} />
      {turn.text && <div className="a-brain-prose">{<AnswerBody text={turn.text} onRecall={onRecall} cites={cites} />}</div>}
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

export function AskThread({
  chat, about, mobile, focusTurn = null, onFocused, morphFrom = null, onMorphed, onDragBack,
  composerExtras, see, text: textProp, onText,
}: {
  chat: ChatHandle
  job: Job
  about: string | null
  mobile: boolean
  /** The turn a push notification named (`boot.turn`, or a feed row's own
   * `&turn=` link). Scrolled to once, then marked so the thread goes back to
   * following the bottom. */
  focusTurn?: string | null
  onFocused?: () => void
  /** Move 9: the rect of the feed card that opened the focused turn. */
  morphFrom?: DOMRect | null
  onMorphed?: () => void
  onDragBack?: () => void
  /** S15: what the docked pane hands the composer (its slash palette). */
  composerExtras?: ComposerExtras
  /** S15: the exact block of screen context that rides with the next message. */
  see?: string
  /** Controlled composer text. The docked pane holds it because its palette is
   * derived from it; the phone does not, and keeps the state here. */
  text?: string
  onText?: (v: string) => void
}) {
  const [ownText, setOwnText] = useState('')
  const text = textProp ?? ownText
  const setText = onText ?? setOwnText
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
    void chat.send(t, about ?? undefined, see)
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
              cites={buildCites(sourceBasenames(t.sources))}
              justLanded={t.id === justLandedId}
              focused={!!focusTurn && (t.turnId ?? t.id) === focusTurn}
              morphFrom={!!focusTurn && (t.turnId ?? t.id) === focusTurn ? morphFrom : null}
              onMorphed={onMorphed}
              onDragBack={onDragBack}
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
                  {/* Move 10. Each word fades in once as it arrives; a word
                      already on screen keeps its key, so it keeps its DOM node
                      and never replays. The caret rides the tail. */}
                  <AnswerBody text={chat.streamText} onRecall={onRecall} stream />
                  <span className="a-brain-caret" aria-hidden="true" />
                </div>
              )}
              {/* Move 11: ONE status line while Claude works, and it goes flat
                  by leaving, the instant the turn resolves. The line SHIMMERS
                  rather than spinning: the surface is allowed exactly one
                  continuous loop and this is where it is spent, so `.a-brain-
                  status` also stills the icon `Working` would otherwise turn. */}
              <span className="a-brain-status a-working">
                <Working live>
                  {chat.slow ? 'Still starting up. The first one is the slow one.' : "Keeps working if you lock the phone. You'll get a notification."}
                </Working>
              </span>
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
        extras={composerExtras}
      />
    </div>
  )
}
