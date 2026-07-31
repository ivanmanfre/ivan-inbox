import { useCallback, useEffect, useRef, useState } from 'react'
import { IDLE, voiceReduce, type VoiceEvent, type VoiceState } from './chat/voice'
import { mockFlag } from './mock'

// Drives the voice state machine from mock timers. No audio is captured this
// phase — what is being judged is whether the UI a real capture would drive is
// coherent, and whether the machine underneath it is the one the audit specified.
//
// Every timer here is a transition OUT of the state it belongs to, with one
// owner, which is the fix for audit (c): the reference has four stall-recovery
// timeouts plus the VAD's own three racing to write a display enum. Here the
// state decides which timer is even scheduled.

const MOCK_TRANSCRIPTS = [
  'why is the over cap pill clipped on the phone',
  'what does use inbox do on every window focus',
  'show me the three states on the ops queue',
]

// Mock cadence, chosen to sit near the measured reference numbers rather than to
// look fast: STT was 2.0-3.5s felt on the reference, done→first-audio 0.86s
// short / 2.0s long (phase0-latency-ledger).
const T = { arming: 260, listen: 2400, transcribe: 900, speak: 1900 }

export function useVoice({ onTranscript, handsFree, turnDone, spokenReplies }: {
  onTranscript: (text: string) => void
  handsFree: boolean
  // Flips true when the chat turn this voice session started has finished.
  turnDone: boolean
  spokenReplies: boolean
}) {
  const [state, setState] = useState<VoiceState>(IDLE)
  const hf = useRef(handsFree)
  hf.current = handsFree
  const timers = useRef<number[]>([])
  const rounds = useRef(0)
  const nth = useRef(0)

  const clear = useCallback(() => {
    for (const t of timers.current) clearTimeout(t)
    timers.current = []
  }, [])
  useEffect(() => clear, [clear])

  const dispatch = useCallback((ev: VoiceEvent) => {
    setState(s => voiceReduce(s, ev, { handsFree: hf.current }))
  }, [])

  const later = useCallback((ms: number, fn: () => void) => {
    timers.current.push(window.setTimeout(fn, ms))
  }, [])

  // ---- state entries. One effect, switched on the state, so there is exactly
  // one active schedule at a time and nothing races. ----
  useEffect(() => {
    clear()
    switch (state.s) {
      case 'ARMING': {
        const deny = mockFlag('voice')
        later(T.arming, () => {
          // iOS audio unlock has to happen synchronously inside the tap handler,
          // never after an await — that is what the real implementation does at
          // the pointerdown site (see VoiceControl), not here.
          if (deny === 'denied') dispatch({ e: 'fail', reason: 'mic-denied', retryable: false })
          else dispatch({ e: 'granted' })
        })
        break
      }
      case 'LISTENING': {
        // Mic level drives the pulse. A per-frame inline style recompute, not a
        // keyframe — the animation budget stays where it was.
        const started = Date.now()
        const iv = window.setInterval(() => {
          const t = (Date.now() - started) / 1000
          const level = 0.18 + 0.34 * Math.abs(Math.sin(t * 3.1)) + 0.12 * Math.abs(Math.sin(t * 7.7))
          setState(s => (s.s === 'LISTENING' ? { s: 'LISTENING', level } : s))
        }, 90)
        timers.current.push(iv as unknown as number)
        later(T.listen, () => {
          rounds.current = 0
          dispatch({ e: 'heard-silence' })
        })
        break
      }
      case 'TRANSCRIBING': {
        const fail = mockFlag('voice')
        later(T.transcribe, () => {
          if (fail === 'stt') dispatch({ e: 'fail', reason: 'stt-upstream', retryable: true })
          else {
            const text = MOCK_TRANSCRIPTS[nth.current++ % MOCK_TRANSCRIPTS.length]
            onTranscript(text)
            dispatch({ e: 'transcript', text })
          }
        })
        break
      }
      case 'SPEAKING':
        later(T.speak, () => dispatch({ e: 'speak-end' }))
        break
      default:
        break
    }
    return clear
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.s, clear, dispatch, later, onTranscript])

  // SENDING ends when the chat turn does — the chat's own state machine owns that
  // leg, and voice reads it rather than running a competing 8s fallback timer
  // (the reference's hfDoneFallbackRef, audit (c) row 3).
  useEffect(() => {
    if (state.s === 'SENDING' && turnDone) {
      dispatch({ e: 'turn-done', speak: spokenReplies })
    }
  }, [state.s, turnDone, spokenReplies, dispatch])

  return {
    state,
    arm: () => dispatch({ e: 'arm' }),
    cancel: () => dispatch({ e: 'cancel' }),
    resume: () => dispatch({ e: 'resume' }),
    skip: () => dispatch({ e: 'skip' }),
    dismiss: () => dispatch({ e: 'dismiss' }),
    // Exposed so the composer can drop straight into SENDING when a transcript
    // was handed off, keeping one state variable for the whole turn.
    noSpeech: () => dispatch({ e: 'no-speech', round: ++rounds.current }),
  }
}
