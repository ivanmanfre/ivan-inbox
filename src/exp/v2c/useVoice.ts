import { useCallback, useEffect, useRef, useState } from 'react'
import {
  IDLE, recognitionCtor, speakableText, sttErrorReason, sttSupported, ttsSupported,
  voiceReduce, type SpeechRecognitionLike, type SpeechRecognitionResultEvent,
  type VoiceEvent, type VoiceState,
} from './chat/voice'
import { mockFlag } from './mock'

// Voice, on the device.
//
// Input is webkitSpeechRecognition, output is speechSynthesis, and nothing leaves
// the browser for either — the vault has no OPENAI_API_KEY, so the audit's
// edge-brokered STT branch is unavailable and its fallback becomes the design.
// That is a better pipeline here, not a lesser one: the reference had four network
// legs (capture → upload → transcribe → send) and this has one (the chat turn),
// which is why first-audible cannot miss its target.
//
// The structure is unchanged from the tournament and it is the point: ONE state at
// a time, every timeout a named transition out of a named state, and the state
// itself forbidding the illegal move. What changed is that real events drive it
// instead of timers.
//
//   * SPEAKING has no transition that arms the microphone (chat/voice.ts), and on
//     entry this hook also aborts the recogniser. There is no code path to the
//     AEC-less echo bug, and no timer racing to create one.
//   * Every failure carries a typed reason, so "mic refused" / "no microphone" /
//     "network" / "this browser cannot" are four different sentences with four
//     different remedies.
//
// Feature detection is a first-class outcome: where SpeechRecognition does not
// exist, `supported` is false and the CALLER hides the affordance entirely. A mic
// button that cannot work is worse than no mic button.

// Three consecutive empty listens is the give-up threshold; retrying forever
// against a dead mic is how the reference looped silently on a broken backend.
const MOCK_TRANSCRIPTS = [
  'why is the over cap pill clipped on the phone',
  'what does use inbox do on every window focus',
  'show me the three states on the ops queue',
]

// Mock cadence, near the measured reference numbers rather than chosen to look
// fast: STT felt 2.0-3.5s on the reference, done→first-audio 0.86s short / 2.0s
// long (phase0-latency-ledger).
const T = { arming: 260, listen: 2400, transcribe: 900, speak: 1900 }

export type VoiceDriver = 'device' | 'mock' | 'none'

// The mock is not a fallback — it is how the three unreachable states (a refused
// permission, a dead engine, the hands-free loop) get captured for review in a
// headless browser that has no speech engine at all. It only exists when a URL
// asked for it by name.
export function voiceDriver(): VoiceDriver {
  if (mockFlag('voice') !== null) return 'mock'
  return sttSupported() ? 'device' : 'none'
}

export function useVoice({ onTranscript, handsFree, turnDone, spokenReplies, replyText }: {
  onTranscript: (text: string) => void
  handsFree: boolean
  // Flips true when the chat turn this voice session started has finished.
  turnDone: boolean
  spokenReplies: boolean
  // What to read back. Read at the moment SPEAKING is entered, so a reply that
  // arrived while the mic was still open is never spoken over.
  replyText?: string
}) {
  const driver = voiceDriver()
  const [state, setState] = useState<VoiceState>(IDLE)
  const hf = useRef(handsFree)
  hf.current = handsFree
  const reply = useRef(replyText)
  reply.current = replyText
  const timers = useRef<number[]>([])
  const rounds = useRef(0)
  const nth = useRef(0)
  const rec = useRef<SpeechRecognitionLike | null>(null)
  const heard = useRef('')

  const clear = useCallback(() => {
    for (const t of timers.current) clearTimeout(t)
    timers.current = []
  }, [])

  const stopRec = useCallback(() => {
    const r = rec.current
    rec.current = null
    if (!r) return
    r.onstart = null; r.onend = null; r.onerror = null; r.onresult = null
    try { r.abort() } catch { /* already dead */ }
  }, [])

  useEffect(() => () => { clear(); stopRec(); if (ttsSupported()) window.speechSynthesis.cancel() },
    [clear, stopRec])

  const dispatch = useCallback((ev: VoiceEvent) => {
    setState(s => voiceReduce(s, ev, { handsFree: hf.current }))
  }, [])

  const later = useCallback((ms: number, fn: () => void) => {
    timers.current.push(window.setTimeout(fn, ms))
  }, [])

  // ---- ARMING → the real recogniser ----
  const startRecognition = useCallback(() => {
    const Ctor = recognitionCtor()
    if (!Ctor) return dispatch({ e: 'fail', reason: 'unsupported', retryable: false })
    stopRec()
    heard.current = ''
    let r: SpeechRecognitionLike
    try { r = new Ctor() } catch {
      return dispatch({ e: 'fail', reason: 'unsupported', retryable: false })
    }
    rec.current = r
    r.lang = 'en-US'
    // One utterance per turn: the recogniser finalising IS the end-of-speech
    // signal, which is a real event and not a silence timer we had to invent.
    r.continuous = false
    r.interimResults = true
    r.maxAlternatives = 1

    r.onstart = () => dispatch({ e: 'granted' })

    r.onresult = (e: SpeechRecognitionResultEvent) => {
      let interim = ''
      let final = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i]
        const text = res[0]?.transcript ?? ''
        if (res.isFinal) final += text
        else interim += text
      }
      if (interim) {
        // There is no amplitude on this API, so the meter encodes SPEECH ACTIVITY:
        // it moves while words are being recognised. That answers the only question
        // the meter is asked ("is it hearing me") without pretending to be a VU.
        const level = Math.min(1, 0.25 + (interim.trim().split(/\s+/).length % 7) / 8)
        dispatch({ e: 'level', level })
      }
      if (final.trim()) {
        heard.current = final.trim()
        // The machine's named path out of LISTENING, then the transcript itself.
        dispatch({ e: 'heard-silence' })
        dispatch({ e: 'transcript', text: heard.current })
        onTranscript(heard.current)
        rounds.current = 0
      }
    }

    r.onerror = (ev: { error: string }) => {
      const mapped = sttErrorReason(ev.error)
      if (mapped === 'no-speech') {
        rounds.current += 1
        dispatch({ e: 'no-speech', round: rounds.current })
        return
      }
      if (ev.error === 'aborted') return // we stopped it on purpose
      dispatch({ e: 'fail', reason: mapped.reason, retryable: mapped.retryable })
    }

    r.onend = () => {
      // Ended with nothing final: that is silence, not a failure.
      if (!heard.current) {
        rounds.current += 1
        dispatch({ e: 'no-speech', round: rounds.current })
      }
    }

    try { r.start() } catch {
      dispatch({ e: 'fail', reason: 'stt-upstream', retryable: true })
    }
  }, [dispatch, onTranscript, stopRec])

  // ---- SPEAKING → the real synthesiser ----
  const speak = useCallback((text: string) => {
    if (!ttsSupported() || !text) return dispatch({ e: 'speak-end' })
    try {
      window.speechSynthesis.cancel()
      const u = new SpeechSynthesisUtterance(speakableText(text))
      u.rate = 1.04
      u.onend = () => dispatch({ e: 'speak-end' })
      u.onerror = () => dispatch({ e: 'fail', reason: 'tts-failed', retryable: false })
      window.speechSynthesis.speak(u)
    } catch {
      dispatch({ e: 'fail', reason: 'tts-failed', retryable: false })
    }
  }, [dispatch])

  // ---- state entries. One effect switched on the state, so exactly one schedule
  // is live at a time and nothing races. ----
  useEffect(() => {
    clear()
    if (driver === 'mock') {
      switch (state.s) {
        case 'ARMING': {
          const deny = mockFlag('voice')
          later(T.arming, () => {
            if (deny === 'denied') dispatch({ e: 'fail', reason: 'mic-denied', retryable: false })
            else dispatch({ e: 'granted' })
          })
          break
        }
        case 'LISTENING': {
          const started = Date.now()
          const iv = window.setInterval(() => {
            const t = (Date.now() - started) / 1000
            const level = 0.18 + 0.34 * Math.abs(Math.sin(t * 3.1)) + 0.12 * Math.abs(Math.sin(t * 7.7))
            setState(s => (s.s === 'LISTENING' ? { s: 'LISTENING', level } : s))
          }, 90)
          timers.current.push(iv as unknown as number)
          later(T.listen, () => { rounds.current = 0; dispatch({ e: 'heard-silence' }) })
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
    }

    // ---- device driver ----
    switch (state.s) {
      case 'ARMING':
        startRecognition()
        break
      case 'SPEAKING':
        // Belt as well as braces: the machine has no path from here to LISTENING,
        // and the microphone is also physically closed before a word is spoken.
        stopRec()
        speak(reply.current ?? '')
        break
      case 'IDLE':
      case 'ERROR':
      case 'PAUSED':
        stopRec()
        break
      default:
        break
    }
    return clear
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.s, driver, clear, dispatch, later, onTranscript, speak, startRecognition, stopRec])

  // SENDING ends when the chat turn does — the chat's own state machine owns that
  // leg, and voice reads it rather than running a competing fallback timer (the
  // reference's hfDoneFallbackRef, audit (c) row 3).
  useEffect(() => {
    if (state.s === 'SENDING' && turnDone) {
      dispatch({ e: 'turn-done', speak: spokenReplies && ttsSupported() })
    }
  }, [state.s, turnDone, spokenReplies, dispatch])

  const cancel = useCallback(() => {
    stopRec()
    if (ttsSupported()) window.speechSynthesis.cancel()
    dispatch({ e: 'cancel' })
  }, [dispatch, stopRec])

  const skip = useCallback(() => {
    if (ttsSupported()) window.speechSynthesis.cancel()
    dispatch({ e: 'skip' })
  }, [dispatch])

  return {
    state,
    // False on a browser with no speech engine. The caller HIDES the affordance
    // rather than rendering a button that cannot do anything.
    supported: driver !== 'none',
    speaksBack: ttsSupported(),
    driver,
    arm: () => dispatch({ e: 'arm' }),
    cancel,
    resume: () => dispatch({ e: 'resume' }),
    skip,
    dismiss: () => dispatch({ e: 'dismiss' }),
    noSpeech: () => dispatch({ e: 'no-speech', round: ++rounds.current }),
  }
}
