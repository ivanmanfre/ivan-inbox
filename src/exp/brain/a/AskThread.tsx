// AskThread.tsx — the conversation itself. Shared by the phone's Ask place
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
import { JOB_LABEL, type Job } from '../../v2c/layout'
import { abortTurn } from '../../../lib/turns'
import { detectLinks } from '../../../lib/unfurl'
import { CLAUDE_ERROR_COPY } from '../../../lib/claude'
import { LinkPreviewCard } from './LinkPreviewCard'
import { Composer } from './Composer'
import { extractRecallNouns, recallPrompt } from './recall'
import { groundedOnLine, sessionStateLine, sourceBasenames, sourcesChipLabel } from './brainMeta'

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
  const nouns = useMemo(() => extractRecallNouns(turn.text), [turn.text])
  if (!chip && nouns.length === 0) return null
  return (
    <div className="ba-answermeta">
      {chip && (
        <details className="ba-sources" data-sources>
          <summary>{chip}</summary>
          <div className="ba-sources-list">{sourceBasenames(turn.sources).join(' · ')}</div>
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

export function AskThread({ chat, job, about, aboutContext, subjects, mobile, onOpenAbout, headerExtra }: {
  chat: ChatHandle
  job: Job
  about: string | null
  aboutContext: string | null
  subjects: Subject[]
  mobile: boolean
  onOpenAbout?: (() => void) | null
  /** Desktop-only: the Feed toggle button, rendered into this header. */
  headerExtra?: ReactNode
}) {
  const [see, setSee] = useState<SeeState>(EMPTY_SEE)
  const seeBlock = buildSeeBlock(subjects, see)
  const scroller = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }, [chat.turns.length, chat.streamText])

  const empty = chat.turns.length === 0 && chat.status === 'idle' && !chat.runningElsewhere
  const groundedDate = chat.grounding?.groundedOn ?? chat.thread?.grounded_summary_date ?? null
  const groundedLine = groundedOnLine(groundedDate)
  const sessionLine = sessionStateLine(chat.thread?.session_started_at ?? null)

  const openTurn = [...chat.turns].reverse()
    .find(t => t.role === 'user' && (t.status === 'running' || t.status === 'queued'))
  const currentTurnId = chat.busy ? chat.turns[chat.turns.length - 1]?.turnId : undefined

  const send = (text: string) => { if (text.trim()) void chat.send(text, aboutContext ?? about ?? undefined, seeBlock) }
  const recall = (noun: string) => { if (!chat.busy) void chat.send(recallPrompt(noun), aboutContext ?? about ?? undefined) }

  return (
    <div className="ba-ask">
      <div className="ba-ask-h">
        <span className="ba-ask-ic">✳</span>
        <div className="ba-ask-title">
          <div className="ba-ask-n">Ask</div>
          <div className="ba-ask-s">{sessionLine}</div>
        </div>
        {headerExtra}
        <button
          type="button" data-new-thread className="ba-newthread"
          title="Start a fresh thread" aria-label="Start a fresh thread"
          onClick={() => chat.newThread()}
        >new</button>
      </div>
      {groundedLine && <div className="ba-grounded-top">{groundedLine}</div>}

      {about && mobile && (
        <div className={`ba-about${onOpenAbout ? ' tap' : ''}`} onClick={onOpenAbout ?? undefined}>
          <span className="ba-about-l">Asking about</span>
          <span className="ba-about-n">{about}</span>
        </div>
      )}

      <SeeChips subjects={subjects} see={see} setSee={setSee} />

      <div className="ba-msgs" ref={scroller}>
        {empty ? (
          <div className="ba-empty">
            <div className="ba-empty-t">
              {about ? <>Ask about <b>{about}</b> without leaving it.</> : <>Ask about the {JOB_LABEL[job].toLowerCase()} you're looking at.</>}
            </div>
            <div className="ba-empty-s">Every turn starts a fresh Claude session — the transcript above is the continuity, not the model's memory.</div>
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
                    <div data-answer data-turn={t.turnId ?? t.id}>
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
                <div className="ba-running">
                  <span className="ba-running-dot" />
                  <span>Working — this keeps going even if you lock your phone. You'll get a notification when it lands.</span>
                  <button type="button" data-stop className="ba-running-stop" onClick={chat.abort}>Stop</button>
                </div>
                <ChatStreaming text={chat.streamText} tools={chat.streamTools} slow={chat.slow} />
              </div>
            )}
            {chat.runningElsewhere && !chat.busy && (
              <div className="ba-running elsewhere">
                <span className="ba-running-dot" />
                <span>Still working — this turn started elsewhere. It will land here on its own.</span>
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
