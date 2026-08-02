import { useCallback, useEffect, useRef, useState } from 'react'
import { ChatStreaming, ChatTurn } from './ChatMessage'
import { HandsFreeSheet, VoiceControl, VoiceStrip } from './VoiceControl'
import { useStt } from './chat/useStt'
import { useVoice } from './useVoice'
import { transportIsMock } from './chat/transport'
import { CLAUDE_MODELS } from '../../lib/claude'
import type { ChatHandle } from './useChat'
import type { Job } from './layout'
import { JOB_LABEL } from './layout'

// The container's own default is a real, working choice and the FIRST entry, not
// an "auto" fallback tucked at the bottom. Today it is also the only one that
// completes a turn — the upstream takes no per-request model yet — so burying it
// would be burying the working option.
const MODEL_OPTIONS: { id: string | null; label: string; note: string }[] = [
  { id: null, label: 'Container default', note: 'Whatever the box booted with' },
  ...CLAUDE_MODELS.map(m => ({ id: m.id as string, label: m.label, note: m.note })),
]

function modelLabel(id: string | null): string {
  if (!id || id === 'container-default') return 'default'
  return MODEL_OPTIONS.find(m => m.id === id)?.label ?? id
}

// ---------------------------------------------------------------------------
// The slash palette (phase 6 ask 7)
// ---------------------------------------------------------------------------
//
// What happened before this existed: nothing. A `/`-prefixed message was sent
// raw, indistinguishable from any other sentence, all the way to the model —
// traced end to end by the phase-6 scout through ChatPane → useChat.send →
// chat/transport → supabase/functions/inbox-claude, and the broker POSTs the
// whole string as one prompt argument to a FRESH Claude Code CLI invocation.
// Slash commands are an interactive-REPL affordance and there is no REPL on the
// other end, so `/clear` would simply have been read as the first line of a
// question.
//
// So the palette is entirely CLIENT-SIDE and every command short-circuits BEFORE
// send() — nothing here adds a network call, a dependency, or a server contract.
//
// The commands are wrappers around capabilities useChat exposes:
//   /model <id>  → chat.setWanted, the same setter the model menu calls
//   /retry       → chat.retry, already wired to the last turn's retry control
//   /stop        → chat.abort, already wired to the stop button while busy
//   /clear       → chat.reset — useChat gained a clean reset for this run
//                  (empties the transcript, forgets the server session, keeps
//                  the chosen model). Added under the revamp's explicit grant;
//                  the parity pass had omitted it because no reset existed.
// `/about <off-screen id>` stays absent (no path exists to reference a peer
// that is not open).
type Command = {
  name: string
  // What it does when it CAN run, and what is true instead when it cannot. The
  // second string is why `hint` is a function: "Abort the turn in flight" on a
  // pane with nothing in flight is a lie about the button.
  hint: (busy: boolean, hasTurns: boolean) => string
  ready: (busy: boolean, hasTurns: boolean) => boolean
  run: (chat: ChatHandle) => void
}

const COMMANDS: Command[] = [
  ...MODEL_OPTIONS.map(m => ({
    name: `/model ${m.id ?? 'default'}`,
    hint: () => m.label,
    ready: () => true,
    run: (chat: ChatHandle) => chat.setWanted(m.id),
  })),
  {
    name: '/retry',
    hint: (_b, hasTurns) => (hasTurns ? 'Re-send the last turn' : 'nothing to retry yet'),
    ready: (busy, hasTurns) => !busy && hasTurns,
    run: chat => chat.retry(),
  },
  {
    name: '/stop',
    hint: busy => (busy ? 'Abort the turn in flight' : 'nothing is running'),
    ready: busy => busy,
    run: chat => chat.abort(),
  },
  {
    name: '/clear',
    hint: (_b, hasTurns) => (hasTurns ? 'Start a fresh thread (keeps your model choice)' : 'nothing to clear yet'),
    ready: (_b, hasTurns) => hasTurns,
    run: chat => chat.reset(),
  },
]

/**
 * Which commands a given composer string offers.
 *
 * Only a `/` at POSITION 0 opens the palette (`text[0] === '/'`), so a question
 * that happens to contain a URL path never triggers it. Returns [] for anything
 * else, which is what closes the palette — there is no second source of truth
 * about whether it is open.
 *
 * 🔴 The vocabulary NEVER shrinks. The first build filtered unavailable commands
 * out of the list, and the measurement caught what that costs: with no turns on
 * the pane, typing `/retry` matched nothing, the palette closed, and Enter went
 * back to sending the literal string "/retry" to the model — the exact behaviour
 * this ask exists to end. A palette that hides its own vocabulary teaches
 * nothing and silently re-opens the hole. Unavailable commands are listed,
 * dimmed, and say why; running one is a no-op (chat.retry and chat.abort both
 * already guard internally) that clears the composer.
 */
export function matchCommands(text: string): Command[] {
  if (text[0] !== '/') return []
  const q = text.slice(1).toLowerCase().trim()
  if (q === '') return COMMANDS
  // Token-wise, not whole-string: "/model haiku" must find
  // `/model claude-haiku-4-5` even though the contiguous substring
  // "model haiku" appears in no command name. The live-transport probe caught
  // the old whole-string match returning ZERO commands for exactly that input —
  // which closed the palette and let Enter send the literal "/model haiku" to
  // the model, the fall-through this palette exists to end.
  const tokens = q.split(/\s+/)
  return COMMANDS.filter(c => {
    const name = c.name.slice(1).toLowerCase()
    return tokens.every(t => name.includes(t))
  })
}

// ---------------------------------------------------------------------------
// Voice, off by default (phase 6 ask 9)
// ---------------------------------------------------------------------------
//
// Ivan tried the mic in this pane and it is unusable for conversation. That is
// not a taste call — it matches what the prior run measured on this exact
// engine: 38.6% word error rate, and `continuous:false` dropping finals
// mid-sentence (useVoice.ts). A control that loses a third of what you say is
// worse than no control, and it sits in the composer where it is the easiest
// thing to hit by accident.
//
// 🔴 NOTHING IS DELETED. useVoice, VoiceControl, VoiceStrip and HandsFreeSheet
// are all still here, still built, still wired — the mic is simply not MOUNTED
// unless the flag is on. Turning it back on is one line in the console:
//
//     localStorage.setItem('wb-voice', 'on')   // then reload
//
// Read once at module scope rather than per render: this is a developer flag,
// not a setting, and there is deliberately no UI for it this pass.
function voiceEnabled(): boolean {
  try { return localStorage.getItem('wb-voice') === 'on' } catch { return false }
}

// A content draft's title is a whole sentence. Naming it in the header, the
// heading and three starters put the same sixteen words on screen five times —
// so it is named ONCE, in the context card, and shortened everywhere else.
function short(label: string, max = 34): string {
  if (label.length <= max) return label
  return `${label.slice(0, max - 1).replace(/[\s,.;:]+$/, '')}…`
}

// Starters, aimed at whatever is in the other pane. Three, never a wall. They do
// not repeat the subject's name — the context card above already says it.
function starters(job: Job, about: string | null): string[] {
  if (about) {
    return [
      'What is this actually waiting on?',
      'Draft a reply in my voice',
      'Where does this get its data?',
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

export function ChatPane({ chat, job, about, aboutContext, onClose, onOpenAbout, mobile }: {
  chat: ChatHandle
  job: Job
  // The context peer's human name, if one is open. This is what makes chat a
  // PEER rather than a tab: the conversation knows what it is next to.
  about: string | null
  // What the context peer IS, for the payload rather than the label. A content
  // draft carries its lane and its register — "a POST in Mattan Danino's lane" —
  // so a downstream voice check cannot judge a post against DM or comment voice
  // (IA §5.7). Falls back to the label when a peer has nothing extra to say.
  aboutContext?: string | null
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
  const [models, setModels] = useState(false)
  // ask 9 — the OLD (browser-API) mic is unmounted unless the flag is on. See voiceEnabled().
  const [voiceOn] = useState(voiceEnabled)
  const scroller = useRef<HTMLDivElement>(null)
  const field = useRef<HTMLInputElement>(null)

  // The NEW mic — server-side dictation over inbox-stt, which cleared its
  // return gate (WER 1.11% / p50 957ms, phase5-voice.md). Opposite default to
  // the retired browser path: shown unless 'wb-voice' is explicitly 'off'.
  // Transcripts are INSERTED into the composer, never auto-sent.
  const [sttOn] = useState(() => { try { return localStorage.getItem('wb-voice') !== 'off' } catch { return true } })
  const stt = useStt(t => {
    setText(prev => (prev.trim() ? `${prev.replace(/\s+$/, '')} ${t}` : t))
    field.current?.focus()
  })

  // The palette is DERIVED from the composer's text, never a second piece of
  // state that could disagree with it. `cursor` is the only state it owns.
  const cmds = matchCommands(text)
  const hasTurns = chat.turns.length > 0
  const [cursor, setCursor] = useState(0)
  const paletteOpen = cmds.length > 0
  const active = cmds[Math.min(cursor, cmds.length - 1)]

  const send = useCallback((prompt: string) => {
    if (!prompt.trim() || chat.busy) return
    setText('')
    void chat.send(prompt, aboutContext ?? about ?? undefined)
  }, [chat, about, aboutContext])

  // A command NEVER reaches send(): it runs locally and clears the composer.
  const runCommand = useCallback((c: Command) => {
    c.run(chat)
    setText('')
    setCursor(0)
  }, [chat])

  const onTranscript = useCallback((t: string) => {
    setTurnDone(false)
    void chat.send(t, aboutContext ?? about ?? undefined).then(() => setTurnDone(true))
  }, [chat, about, aboutContext])

  // What gets read back: the newest assistant turn. Read at the moment SPEAKING is
  // entered, never captured earlier, so a turn that landed while the mic was still
  // open is not spoken over.
  const lastAsst = [...chat.turns].reverse().find(t => t.role === 'assistant')
  const voice = useVoice({
    onTranscript,
    handsFree,
    turnDone,
    spokenReplies: true,
    replyText: lastAsst?.error ? lastAsst.error.message : lastAsst?.text,
  })

  useEffect(() => {
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }, [chat.turns.length, chat.streamText])

  const empty = chat.turns.length === 0 && chat.status === 'idle'
  const lastErr = chat.turns.length > 0 && chat.turns[chat.turns.length - 1].error !== null
  const mock = transportIsMock()

  // The honest-degrade state. A picked model the container refused leaves the
  // selection ALONE — silently reverting it to the default would be the app
  // choosing for Ivan and then hiding that it did. It says what happened and
  // offers the one action that works.
  const lastTurn = chat.turns[chat.turns.length - 1]
  const modelRefused = !!lastTurn?.error && /model/i.test(lastTurn.error.message) && chat.wanted !== null

  return (
    <>
      <div className="wb-pane-h">
        {mobile && <span className="back" onClick={onClose}>‹</span>}
        <span className="wb-pane-ic asst">✳</span>
        <div className="wb-pane-ttl">
          <div className="wb-pane-n">Claude</div>
          <div className="wb-pane-s">
            {/* The live broker has no session to name: the upstream never passes
                --resume, so "no session yet" would imply one is coming. Say what
                is true instead. */}
            {chat.sessionId
              ? `session ${chat.sessionId}`
              : mock ? 'no session yet' : 'a fresh session every turn'}
            {/* What the last turn RAN on, per the broker — not what is selected.
                Before any turn there is nothing to report, so nothing is shown. */}
            {chat.model && ` · ran on ${modelLabel(chat.model)}`}
          </div>
        </div>
        <button
          className={`wb-modelbtn${chat.wanted ? ' picked' : ''}`}
          onClick={() => setModels(v => !v)}
          title="Choose the model for the next turn"
        >{modelLabel(chat.wanted)}</button>
        <span
          className={`wb-live${chat.busy ? ' busy' : ''}${lastErr ? ' err' : ''}`}
          title={lastErr ? 'last turn failed' : chat.busy ? 'streaming' : 'ready'}
        />
        {mock && <span className="wb-mockchip">mock</span>}
        {!mobile && <span className="wb-pane-x" onClick={onClose}>✕</span>}
      </div>

      {models && (
        <div className="wb-modelmenu">
          {MODEL_OPTIONS.map(m => (
            <button
              key={m.id ?? 'default'}
              className={`wb-modelopt${chat.wanted === m.id ? ' on' : ''}`}
              onClick={() => { chat.setWanted(m.id); setModels(false) }}
            >
              <span className="wb-modelopt-l">{m.label}</span>
              <span className="wb-modelopt-n">{m.note}</span>
              {chat.wanted === m.id && <span className="wb-modelopt-t">✓</span>}
            </button>
          ))}
          {/* Stated once, where the choice is made, rather than discovered by
              sending a turn that fails. It is the current truth about the box. */}
          <div className="wb-modelnote">
            The container takes no per-turn model yet, so anything but the default
            is refused rather than quietly ignored.
          </div>
        </div>
      )}

      {modelRefused && (
        <div className="wb-modelwarn">
          <span>{lastTurn.error!.message}</span>
          <button onClick={() => chat.setWanted(null)}>Use container default</button>
        </div>
      )}

      {/* The context card. On desktop it labels a pane the operator can also see;
          on mobile it is the ONLY surviving half of the pair, so it is tappable
          and flips back to the item. */}
      {about && (
        <div
          className={`wb-about-card${onOpenAbout ? ' tap' : ''}`}
          onClick={onOpenAbout ?? undefined}
        >
          <span className="wb-about-l">Asking about</span>
          <span className="wb-about-n">{short(about, 52)}</span>
          {onOpenAbout && <span className="wb-about-go">›</span>}
        </div>
      )}

      <div className="wb-msgs" ref={scroller}>
        {empty ? (
          <div className="wb-chat-empty">
            <div className="wb-chat-empty-t">
              {about
                ? <>Ask about <b>{short(about)}</b> without leaving it.</>
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
          </>
        )}
      </div>

      {/* Feature-detected, not error-handled: on a browser with no speech engine
          the strip and the mic are absent entirely. A button that cannot work is
          worse than no button, and an "unsupported" toast after the tap is worse
          than both. */}
      {voiceOn && voice.supported && (
        <VoiceStrip
          state={voice.state}
          onDismiss={voice.dismiss}
          onResume={voice.resume}
          onHandsFree={() => setSheet(true)}
          handsFree={handsFree}
        />
      )}

      {/* The palette sits ABOVE the composer, in the same overlay grammar the
          model menu already establishes — it is the one existing precedent in
          this pane, and reusing it means a `/` list and a picked model look like
          the same kind of object. */}
      {paletteOpen && (
        <div className="wb-palette">
          {cmds.map((c, i) => (
            <button
              key={c.name}
              className={`wb-pal-opt${c === active ? ' on' : ''}${c.ready(chat.busy, hasTurns) ? '' : ' off'}`}
              // onMouseDown, not onClick: the input keeps focus, so the palette
              // does not close under the pointer before the click lands.
              onMouseDown={e => { e.preventDefault(); runCommand(c) }}
              onMouseEnter={() => setCursor(i)}
            >
              <span className="wb-pal-n">{c.name}</span>
              <span className="wb-pal-h">{c.hint(chat.busy, hasTurns)}</span>
            </button>
          ))}
          <div className="wb-pal-f">↑↓ to move · ⏎ to run · esc to cancel</div>
        </div>
      )}

      <div className="wb-composer">
        {voiceOn && voice.supported && (
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
        )}
        {sttOn && stt.supported && (
          <button
            type="button"
            className={`cmic${stt.state !== 'idle' ? ` cmic-${stt.state}` : ''}`}
            onClick={stt.toggle}
            disabled={stt.state === 'transcribing'}
            aria-label={stt.state === 'recording' ? 'Stop recording' : 'Dictate'}
            title={stt.state === 'recording' ? 'Stop recording' : 'Dictate'}
          >
            {stt.state === 'recording'
              ? <span className="cmic-live">{Math.floor(stt.elapsedMs / 1000)}s</span>
              : stt.state === 'transcribing' ? '…' : '🎙'}
          </button>
        )}
        <input
          ref={field}
          className="cfield"
          placeholder={stt.note ?? (about ? `Ask about ${short(about, 22)}…` : 'Ask Claude…')}
          value={text}
          onChange={e => { setText(e.target.value); setCursor(0) }}
          // Enter sends here on purpose, unlike the outbound DM composer: a chat
          // turn is conversational, not consequential. Nothing leaves the building.
          //
          // While the palette is open the same four keys mean palette things,
          // and Enter runs the highlighted command instead of sending the raw
          // "/model …" string to the model — which is exactly what used to
          // happen. Escape clears the composer, which is what closes the palette
          // (it is derived from `text`, so there is nothing else to close).
          onKeyDown={e => {
            if (paletteOpen) {
              if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(c => (c + 1) % cmds.length); return }
              if (e.key === 'ArrowUp') { e.preventDefault(); setCursor(c => (c - 1 + cmds.length) % cmds.length); return }
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (active) runCommand(active); return }
              if (e.key === 'Escape') { e.preventDefault(); setText(''); setCursor(0); return }
            }
            if (e.key === 'Enter' && !e.shiftKey) send(text)
          }}
        />
        {chat.busy ? (
          <div className="csend wb-stop" onClick={chat.abort} title="Stop">◼</div>
        ) : (
          <div
            className="csend"
            // The button obeys the palette too. Without this, the one path that
            // still sent a literal "/model haiku" to the model would be the
            // send button — the exact behaviour ask 7 exists to end.
            onClick={() => (paletteOpen && active ? runCommand(active) : send(text))}
            style={text.trim() ? { background: 'var(--accent)', color: '#fff' } : undefined}
          >↑</div>
        )}
      </div>

      {voiceOn && sheet && (
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
