import { useCallback, useEffect, useRef, useState } from 'react'
import { ChatStreaming, ChatTurn } from './ChatMessage'
import { HandsFreeSheet, VoiceControl, VoiceStrip } from './VoiceControl'
import { useVoice } from './useVoice'
import { TRANSPORT_IS_MOCK } from './chat/transport'
import type { ChatHandle } from './useChat'
import type { Job } from './layout'
import { JOB_LABEL } from './layout'

// Starters, derived from what the operator is actually looking at. Three chips,
// never a wall — and they exist to make the peer relationship legible: the
// question is pre-aimed at the thing in the other pane.
function starters(job: Job, about: string | null): string[] {
  if (about) {
    return [
      `What is ${about} actually waiting on?`,
      `Draft a reply for ${about} in my voice`,
      `Where in the code does ${about} get its data?`,
    ]
  }
  switch (job) {
    case 'content': return [
      'Which drafts have been in review longest?',
      'Why would an approved post have no date?',
      'What writes carousel_drafts.status?',
    ]
    case 'sends': return [
      'Why is the governor over cap today?',
      'Which lane is starving?',
      'Where does the accept rate come from?',
    ]
    case 'ops': return [
      'What is in the comment queue right now?',
      'Which edge function drafts a comment reply?',
      'What happens when I approve an ops card?',
    ]
    default: return [
      'What did useInbox do on every window focus?',
      'Which drafts are stale and why?',
      'Walk me through the send path',
    ]
  }
}

export function ChatPane({ chat, job, about, onClose, onOpenAbout, mobile }: {
  chat: ChatHandle
  job: Job
  // The context peer's human name, if one is open. This is what makes chat a
  // PEER rather than a tab: the conversation knows what it is next to.
  about: string | null
  onClose: () => void
  // Mobile only: there is no third region, so the pairing degrades to a tappable
  // context card that flips back to the item.
  onOpenAbout: (() => void) | null
  mobile: boolean
}) {
  const [text, setText] = useState('')
  const [handsFree, setHandsFree] = useState(false)
  const [sheet, setSheet] = useState(false)
  const [turnDone, setTurnDone] = useState(false)
  const scroller = useRef<HTMLDivElement>(null)

  const send = useCallback((prompt: string) => {
    if (!prompt.trim() || chat.busy) return
    setText('')
    void chat.send(prompt, about ?? undefined)
  }, [chat, about])

  const onTranscript = useCallback((t: string) => {
    setTurnDone(false)
    void chat.send(t, about ?? undefined).then(() => setTurnDone(true))
  }, [chat, about])

  const voice = useVoice({ onTranscript, handsFree, turnDone, spokenReplies: true })

  useEffect(() => {
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }, [chat.turns.length, chat.streamText])

  const empty = chat.turns.length === 0 && chat.status === 'idle'

  return (
    <>
      <div className="wb-pane-h">
        {mobile && <span className="back" onClick={onClose}>‹</span>}
        <span className="wb-pane-ic asst">✳</span>
        <div className="wb-pane-ttl">
          <div className="wb-pane-n">Claude</div>
          <div className="wb-pane-s">
            {chat.sessionId ? `session ${chat.sessionId}` : 'no session yet'}
            {chat.model && ` · ${chat.model}`}
          </div>
        </div>
        {TRANSPORT_IS_MOCK && <span className="wb-mockchip">mock</span>}
        {!mobile && <span className="wb-pane-x" onClick={onClose}>✕</span>}
      </div>

      {/* The context card. On desktop it labels a pane the operator can also see;
          on mobile it is the ONLY surviving half of the pair, so it is tappable
          and flips back to the item. */}
      {about && (
        <div
          className={`wb-about-card${onOpenAbout ? ' tap' : ''}`}
          onClick={onOpenAbout ?? undefined}
        >
          <span className="wb-about-l">Asking about</span>
          <span className="wb-about-n">{about}</span>
          {onOpenAbout && <span className="wb-about-go">›</span>}
        </div>
      )}

      <div className="wb-msgs" ref={scroller}>
        {empty ? (
          <div className="wb-chat-empty">
            <div className="wb-chat-empty-t">
              {about
                ? <>Ask about <b>{about}</b> without leaving it.</>
                : <>Ask about the {JOB_LABEL[job].toLowerCase()} you’re looking at.</>}
            </div>
            <div className="wb-chat-empty-s">
              Every turn starts a fresh Claude session — the transcript above is the
              continuity, not the model’s memory.
            </div>
            <div className="wb-starters">
              {starters(job, about).map(s => (
                <button className="wb-starter" key={s} onClick={() => send(s)}>{s}</button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {chat.turns.map((t, i) => (
              <ChatTurn
                key={t.id}
                turn={t}
                onRetry={i === chat.turns.length - 1 ? chat.retry : undefined}
              />
            ))}
            {chat.busy && (
              <ChatStreaming text={chat.streamText} tools={chat.streamTools} slow={chat.slow} />
            )}
            {!chat.busy && chat.cost && (
              <div className="wb-cost">
                {chat.cost.durationMs != null && `${(chat.cost.durationMs / 1000).toFixed(1)}s`}
                {chat.cost.costUsd != null && ` · $${chat.cost.costUsd.toFixed(4)}`}
              </div>
            )}
          </>
        )}
      </div>

      <VoiceStrip
        state={voice.state}
        onDismiss={voice.dismiss}
        onResume={voice.resume}
        onHandsFree={() => setSheet(true)}
        handsFree={handsFree}
      />

      <div className="wb-composer">
        <VoiceControl
          state={voice.state}
          onArm={voice.arm}
          onCancel={voice.cancel}
          onResume={voice.resume}
          onSkip={voice.skip}
          onDismiss={voice.dismiss}
          onHandsFree={() => { setHandsFree(true); setSheet(true) }}
          handsFree={handsFree}
        />
        <input
          className="cfield"
          placeholder={about ? `Ask about ${about}…` : 'Ask Claude…'}
          value={text}
          onChange={e => setText(e.target.value)}
          // Enter sends here on purpose, unlike the outbound DM composer: a chat
          // turn is conversational, not consequential. Nothing leaves the building.
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) send(text) }}
        />
        {chat.busy ? (
          <div className="csend wb-stop" onClick={chat.abort} title="Stop">◼</div>
        ) : (
          <div
            className="csend"
            onClick={() => send(text)}
            style={text.trim() ? { background: 'var(--accent)', color: '#fff' } : undefined}
          >↑</div>
        )}
      </div>

      {sheet && (
        <HandsFreeSheet
          state={voice.state}
          onClose={() => { setSheet(false); setHandsFree(false); voice.cancel() }}
          onArm={voice.arm}
          onSkip={voice.skip}
        />
      )}
    </>
  )
}
