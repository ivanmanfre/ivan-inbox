// AskThread.tsx - the conversation itself. Shared by the phone's Ask place
// and the desktop AskPane, so the thread and every brain-visibility fact read
// identically in both places (parity, not a second design).
//
// Reused by IMPORT, never forked: ChatTurn/ChatStreaming (ChatMessage.tsx) for
// the bubble/tool-strip/markdown rendering, useStt for dictation (via
// Composer.tsx), the pure paneContext helpers for the "what travels" strip.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ChatStreaming, ChatTurn } from '../../v2c/ChatMessage'
import { attached, buildSeeBlock, EMPTY_SEE, offAll, onAll, seeLine, type SeeState, type Subject } from '../../v2c/chat/paneContext'
import type { ChatHandle } from '../../v2c/useChat'
import { type Job } from '../../v2c/layout'
import { abortTurn } from '../../../lib/turns'
import { detectLinks } from '../../../lib/unfurl'
import { CLAUDE_ERROR_COPY } from '../../../lib/claude'
import { LinkPreviewCard } from './LinkPreviewCard'
import { Composer } from './Composer'
import { extractRecallNouns, recallPrompt } from './recall'
import { groundedOnLine, sessionStateLine, sourceBasenames, sourceSummaryClause, sourcesChipLabel } from './brainMeta'

const THREAD_BUSY_COPY = CLAUDE_ERROR_COPY.thread_busy

function starters(job: Job, about: string | null): string[] {
  if (about) return ['What is this actually waiting on?', 'Draft a reply in my voice', 'Summarise where this stands']
  switch (job) {
    case 'content': return ['Which drafts have been in review longest?', 'What is stuck in QA right now?', 'What ships today?']
    case 'sends': return ['Which lane is starving?', 'Why is the governor over cap?', 'What is the accept rate this week?']
    case 'ops': return ['What is in the comment queue right now?', 'What needs me today?', 'What is HALTED and why?']
    default: return ['What needs me today?', 'Which drafts are stale and why?', 'Recap what happened overnight']
  }
}

// A tap-to-remove chip strip for whatever is selected elsewhere in the app.
// Deliberately simpler than ChatPane's SeeStrip (which is private to that
// file and not importable): all-or-nothing per subject, no full-text toggle.
// The reused, TESTED pure functions (buildSeeBlock/seeLine/attached) are the
// same ones ChatPane's strip runs on, so what this prints and what it sends
// are still the same string.
function SeeChips({ subjects, see, setSee }: {
  subjects: Subject[]
  see: SeeState
  setSee: (fn: (s: SeeState) => SeeState) => void
}) {
  if (subjects.length === 0) return null
  const on = attached(subjects, see)
  return (
    <div className="ba-see">
      <span className="ba-see-l">{seeLine(subjects, see)}</span>
      <button
        type="button" className="ba-see-t"
        onClick={() => setSee(s => (on.length === 0 ? onAll(s, subjects) : offAll(s, subjects)))}
      >{on.length === 0 ? 'Attach again' : 'Detach all'}</button>
    </div>
  )
}

function AnswerMeta({ turn, onRecall }: { turn: { text: string; sources?: { kind: string; path: string }[] }; onRecall: (noun: string) => void }) {
  const chip = sourcesChipLabel(turn.sources)
  // Only the files. The assembler's own block ids and its `auto` bookkeeping
  // row are not names he would recognise, and the memory summary is a DATE,
  // not a file, so it gets its own clause instead of sitting in the list.
  const files = sourceBasenames(turn.sources)
  const summary = sourceSummaryClause(turn.sources)
  const nouns = useMemo(() => extractRecallNouns(turn.text), [turn.text])
  if (!chip && nouns.length === 0) return null
  return (
    <div className="ba-answermeta">
      {chip && (
        <details className="ba-sources" data-sources>
          <summary>{chip}</summary>
          <div className="ba-sources-list">{files.join(' · ')}</div>
          {summary && <div className="ba-sources-list">{summary}</div>}
        </details>
      )}
      {nouns.length > 0 && (
        <div className="ba-recall-row">
          {nouns.map(n => (
            <button key={n} type="button" data-recall className="ba-recall-chip" onClick={() => onRecall(n)}>
              recall {n}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function AskThread({ chat, job, about, aboutContext, subjects, mobile, onOpenAbout, headerExtra, headerEnd, bootTurn }: {
  chat: ChatHandle
  job: Job
  about: string | null
  aboutContext: string | null
  subjects: Subject[]
  mobile: boolean
  onOpenAbout?: (() => void) | null
  /** Desktop-only: the Feed toggle button, rendered into this header. */
  headerExtra?: ReactNode
  /** Desktop-only: the pane's own close control, which is always last in the row. */
  headerEnd?: ReactNode
  /** The turn a push named (`&turn=` on the deep link). Scrolled to and marked once. */
  bootTurn?: string | null
}) {
  const [see, setSee] = useState<SeeState>(EMPTY_SEE)
  const seeBlock = buildSeeBlock(subjects, see)
  const scroller = useRef<HTMLDivElement>(null)
  const bootScrolled = useRef(false)

  // A push names a THREAD and a TURN. Landing at the bottom of a long thread
  // when the notification was about the fourth answer up is a miss, so the
  // named turn wins the first scroll - once, and only if it has actually
  // hydrated; every later render goes back to following the tail.
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    if (bootTurn && !bootScrolled.current) {
      const target = el.querySelector(`[data-turn="${bootTurn.replace(/["\\]/g, '')}"]`)
      if (target) {
        bootScrolled.current = true
        target.scrollIntoView({ block: 'center' })
        return
      }
    }
    el.scrollTop = el.scrollHeight
  }, [chat.turns.length, chat.streamText, bootTurn])

  const hydrating = chat.turnsLoading && chat.turns.length === 0
  const empty = !hydrating && chat.turns.length === 0 && chat.status === 'idle' && !chat.runningElsewhere
  const groundedDate = chat.grounding?.groundedOn ?? chat.thread?.grounded_summary_date ?? null
  const groundedLine = groundedOnLine(groundedDate)
  const sessionLine = sessionStateLine(
    chat.thread?.session_started_at ?? null,
    chat.grounding?.session ?? null,
    chat.turns.length > 0,
  )

  const openTurn = [...chat.turns].reverse()
    .find(t => t.role === 'user' && (t.status === 'running' || t.status === 'queued'))
  const currentTurnId = chat.busy ? chat.turns[chat.turns.length - 1]?.turnId : undefined

  const streaming = chat.streamText.length > 0 || chat.streamTools.length > 0

  const send = (text: string) => { if (text.trim()) void chat.send(text, aboutContext ?? about ?? undefined, seeBlock) }
  const recall = (noun: string) => { if (!chat.busy) void chat.send(recallPrompt(noun), aboutContext ?? about ?? undefined) }

  return (
    <div className="ba-ask">
      <div className="ba-ask-h">
        <span className="ba-ask-ic">✳</span>
        <div className="ba-ask-n">Ask</div>
        {headerExtra}
        <button
          type="button" data-new-thread className="ba-newthread"
          title="Start a fresh thread" aria-label="Start a fresh thread"
          onClick={() => chat.newThread()}
        >New thread</button>
        {headerEnd}
      </div>
      {/* Both brain facts on ONE full-width line: what the session is doing,
          and which memory it stands on. Stacked under the header rather than
          squeezed beside the button, which wrapped it to four lines. */}
      <div className="ba-ask-s">{groundedLine ? `${sessionLine} ${groundedLine}.` : sessionLine}</div>

      {about && mobile && (
        <div className={`ba-about${onOpenAbout ? ' tap' : ''}`} onClick={onOpenAbout ?? undefined}>
          <span className="ba-about-l">Asking about</span>
          <span className="ba-about-n">{about}</span>
        </div>
      )}

      <SeeChips subjects={subjects} see={see} setSee={setSee} />

      <div className="ba-msgs" ref={scroller}>
        {hydrating && (
          <div className="ba-hydrating" data-loading>
            <div className="ba-hydrating-t">Opening the last conversation.</div>
            <div className="ba-skel-list">
              <div className="ba-skel-row"><span className="ba-skel-line" /></div>
              <div className="ba-skel-row"><span className="ba-skel-line short" /></div>
              <div className="ba-skel-row"><span className="ba-skel-line" /></div>
            </div>
          </div>
        )}
        {empty ? (
          <div className="ba-empty">
            <div className="ba-empty-t">
              {about ? <>Ask about <b>{about}</b> without leaving it.</> : <>Ask anything. Claude reads your memory, the calls and every lane before it answers.</>}
            </div>
            {/* The truth the session line already tells: threads resume, so
                what he sent an hour ago is still in hand. */}
            <div className="ba-empty-s">Claude keeps this thread between turns.</div>
            <div className="ba-starters">
              {starters(job, about).map(s => (
                <button key={s} type="button" className="ba-starter" onClick={() => send(s)}>{s}</button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {chat.turns.map((t, i) => {
              const last = i === chat.turns.length - 1
              const links = t.role === 'user' ? detectLinks(t.text) : []
              const isThreadBusy = t.error?.message === THREAD_BUSY_COPY
              return (
                <div key={t.id}>
                  {t.role === 'assistant' ? (
                    <div
                      data-answer data-turn={t.turnId ?? t.id}
                      className={bootTurn && t.turnId === bootTurn ? 'ba-boot-turn' : undefined}
                    >
                      <ChatTurn turn={t} onRetry={last && !isThreadBusy ? chat.retry : undefined} />
                      {!t.error && !t.aborted && <AnswerMeta turn={t} onRecall={recall} />}
                    </div>
                  ) : (
                    <>
                      <ChatTurn turn={t} />
                      {links[0] && <LinkPreviewCard url={links[0].url} />}
                    </>
                  )}
                </div>
              )
            })}
            {chat.busy && (
              <div data-answer data-turn={currentTurnId}>
                {/* ONE running indicator. The shared renderer draws its own
                    dots whenever it has neither text nor tools yet, so it is
                    only mounted once the answer has something to show; until
                    then this banner is the whole state, and the Stop for it
                    is the composer's, never a second one here. */}
                <div className="ba-running" data-running>
                  <span className="ba-running-dot" />
                  <span>
                    {chat.slow
                      ? 'Still starting up. The first one is the slow one. This keeps going even if you lock your phone, and you will get a notification when it lands.'
                      : 'Working. This keeps going even if you lock your phone, and you will get a notification when it lands.'}
                  </span>
                </div>
                {streaming && <ChatStreaming text={chat.streamText} tools={chat.streamTools} slow={false} />}
              </div>
            )}
            {chat.runningElsewhere && !chat.busy && (
              <div className="ba-running elsewhere">
                <span className="ba-running-dot" />
                <span>Still working. This turn started elsewhere, and it will land here on its own.</span>
                {openTurn?.turnId && (
                  <button
                    type="button" data-stop className="ba-running-stop"
                    onClick={() => { void abortTurn(openTurn.turnId!) }}
                  >Stop</button>
                )}
              </div>
            )}
          </>
        )}
      </div>

      <Composer busy={chat.busy} onSend={send} onAbort={chat.abort} placeholder={about ? `Ask about ${about}…` : 'Ask Claude…'} />
    </div>
  )
}
