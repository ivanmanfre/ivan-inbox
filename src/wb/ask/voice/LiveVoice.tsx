// LiveVoice: the full-screen live conversation (P2 winner A, `voice` state).
//
// A dark stage, a lime orb that reacts to whoever is talking (his mic level
// while listening, Claude's own audio level while speaking), captions of both
// sides, and three controls: Mute, End, Type. While an escalated Claude turn
// runs, a "Working on it" line names the task; the answer lands in the thread
// as a normal turn and the voice model says the short version.
//
// iOS: mic, AudioContext and audio playback all want a user gesture. open()
// does its gesture-bound work synchronously, so it is only ever called from a
// tap handler, or on mount when the browser reports a live user activation
// (the composer's lime button tap that opened this screen). A deep link has
// no gesture: it shows one big "Tap to talk". If an auto-start is refused
// anyway, the hook lands in ERROR 'needs-gesture' and the same button shows.
//
// Transcript decision (P3, logged in the wave file): escalated tasks land in
// the thread as normal user turns via `send`. The rest of the spoken back and
// forth stays in the session only: the thread model has no note/turn type a
// client can write without going through the Claude brain.
import { useCallback, useEffect, useRef, useState } from 'react'
import { Icon, LiveDot, Working } from '../../../ds'
import type { Turn } from '../../../exp/v2c/chat/events'
import { useRealtime } from '../../../lib/realtime/useRealtime'
import { VOICE_COPY, type VoiceErrorReason, type VoiceState } from '../../../lib/realtime/voice'
import { useEscalations } from './useEscalations'
import './voice.css'

export type LiveVoiceProps = {
  onClose(): void
  send(text: string): void
  turns: Turn[]
}

/** True when the browser says this moment is inside a user gesture. */
function hasGesture(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation
  return ua?.isActive === true
}

// VOICE_COPY is shared with the dictation path; these lines are for a live session.
const LIVE_COPY: Partial<Record<VoiceErrorReason, string>> = {
  'no-key-broker': 'Could not start a session. Check the connection and try again.',
  'stt-network': 'Lost the connection to the voice session.',
  'stt-upstream': 'The voice session failed. Try again in a moment.',
}

function stateLine(s: VoiceState, muted: boolean): string {
  switch (s.s) {
    case 'ARMING': return 'Connecting. Keep talking, nothing is lost.'
    case 'LISTENING': return muted ? 'Muted. Tap Unmute to talk again.' : 'Listening'
    case 'SPEAKING': return 'Claude is speaking. Talk to cut in.'
    case 'ERROR': return LIVE_COPY[s.reason] ?? VOICE_COPY[s.reason]
    default: return ''
  }
}

function clock(ms: number): string {
  const t = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`
}

function money(usd: number): string {
  if (usd <= 0) return ''
  if (usd < 0.01) return '<1c'
  return `$${usd.toFixed(2)}`
}

/** Split a reply into what came before the current sentence and the current one. */
export function splitCaption(text: string): [string, string] {
  const t = text.trim()
  const m = t.match(/^([\s\S]*[.!?])\s+(\S[\s\S]*)$/)
  return m ? [m[1], m[2]] : ['', t]
}

export function LiveVoice({ onClose, send, turns }: LiveVoiceProps) {
  const escalate = useRef<(task: string) => void>(() => {})
  const rt = useRealtime({ onEscalate: task => escalate.current(task) })
  const esc = useEscalations({ turns, send, feed: rt.feedResult })
  escalate.current = esc.enqueue

  const [auto] = useState(hasGesture)
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const s = rt.state

  // Auto-start only while the tap that opened this screen is still live.
  const { open } = rt
  useEffect(() => { if (auto) void open() }, [auto, open])

  const live = s.s === 'LISTENING' || s.s === 'SPEAKING'
  useEffect(() => {
    if (live && startedAt === null) setStartedAt(Date.now())
  }, [live, startedAt])
  useEffect(() => {
    if (startedAt === null) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [startedAt])

  const { close, setMuted, skip } = rt
  const end = useCallback(() => { close(); onClose() }, [close, onClose])
  // Called straight from the tap: open() spends the gesture before its first await.
  const start = useCallback(() => { void open() }, [open])

  const needsTap = s.s === 'IDLE' || (s.s === 'ERROR' && s.reason === 'needs-gesture')
  const failed = s.s === 'ERROR' && s.reason !== 'needs-gesture'
  const orbLevel = s.s === 'SPEAKING' ? rt.outLevel : s.s === 'LISTENING' && !rt.muted ? rt.level : 0
  const heard = rt.interim || rt.last?.heard || ''
  const [before, current] = splitCaption(rt.said || rt.last?.reply || '')
  const cost = money(rt.cost)

  return (
    <div className="lv" role="dialog" aria-modal="true" aria-label="Live voice" data-state={s.s}>
      <div className="lv-top">
        <span className="lv-tag">
          {live && <LiveDot label="Live" />}
          <span>{live ? 'Live' : s.s === 'ARMING' ? 'Connecting' : 'Voice'}</span>
          {startedAt !== null && <span className="lv-num">{clock(now - startedAt)}</span>}
          {cost && <span className="lv-num lv-cost" title="Estimated spend on this voice session">{cost}</span>}
        </span>
      </div>

      <div className="lv-orb-wrap">
        {s.s === 'SPEAKING' && <><span className="lv-ring" /><span className="lv-ring b" /><span className="lv-ring c" /></>}
        <button
          type="button"
          className="lv-orb"
          data-dim={needsTap || failed || rt.muted ? '' : undefined}
          style={{ transform: `scale(${1 + orbLevel * 0.35})` }}
          aria-label={s.s === 'SPEAKING' ? 'Stop the reply' : needsTap ? 'Tap to talk' : 'Voice level'}
          onClick={s.s === 'SPEAKING' ? skip : needsTap ? start : undefined}
        />
      </div>

      {needsTap ? (
        <div className="lv-start">
          <button type="button" className="lv-go" onClick={start}>
            <Icon name="mic" size={24} />Tap to talk
          </button>
          <p className="lv-hint">Claude listens and answers out loud. Real work runs in the chat.</p>
        </div>
      ) : (
        <>
          <p className="lv-state" role="status">{stateLine(s, rt.muted)}</p>
          <div className="lv-caps" aria-live="polite">
            {heard && <p className="lv-me"><b>You</b> · {heard}</p>}
            {(before || current) && (
              <p className="lv-ai">{before && <span className="lv-before">{before} </span>}{current}</p>
            )}
            {esc.working && (
              <Working className="lv-doing">
                <span className="lv-doing-t">Working on it: {esc.working}</span>
              </Working>
            )}
            {failed && s.s === 'ERROR' && s.retryable && (
              <button type="button" className="lv-retry" onClick={start}>Try again</button>
            )}
          </div>
        </>
      )}

      <div className="lv-ctl">
        <button
          type="button" className="lv-c" aria-pressed={rt.muted}
          data-on={rt.muted ? '' : undefined}
          disabled={!live && s.s !== 'ARMING'}
          onClick={() => setMuted(!rt.muted)}
        >
          <span className="lv-c-b lv-mute"><Icon name="mic" size={24} /></span>{rt.muted ? 'Unmute' : 'Mute'}
        </button>
        <button type="button" className="lv-c lv-end" onClick={end}>
          <span className="lv-c-b"><Icon name="close" size={24} /></span>End
        </button>
        <button type="button" className="lv-c" onClick={end} aria-label="Type instead">
          <span className="lv-c-b"><Icon name="keyboard" size={24} /></span>Type
        </button>
      </div>
    </div>
  )
}
