// useStt — push-to-talk dictation over the server-side inbox-stt broker.
//
// This is NOT the browser SpeechRecognition path. That engine measured 38.6%
// WER on this product's own nouns, dropped finals mid-sentence, and shipped the
// audio to Google's speech-api regardless of what its comments claimed
// (useVoice.ts, 2026-08-01). It stays retired — a standing decision, not a
// preference. This hook records with MediaRecorder and posts the bytes to
// /functions/v1/inbox-stt (ElevenLabs scribe_v2 + keyterms), which cleared the
// return gate at WER 1.11% / p50 957ms (phase5-voice.md).
//
// Contract facts this file leans on (all verified against the deployed fn):
// - Auth is the Supabase user JWT alone. No apikey header.
// - multipart/form-data with one `file` part; fetch sets the boundary — never
//   set Content-Type by hand.
// - 422 no_speech_detected is the EXPECTED outcome of tapping the mic and not
//   speaking. It renders as a quiet hint, never as an error state and never as
//   an empty insert.
// - The transcript is INSERTED into the composer, never auto-sent. Dictation
//   drafts; the operator sends.
import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../../../lib/supabase'

const FN_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/inbox-stt`

// The fn rejects at 10MB (413 audio_too_large). Opus at MediaRecorder's default
// bitrate runs ~4KB/s, so a 90s cap stops the recorder two orders of magnitude
// under the ceiling while still covering any sane dictation.
const MAX_RECORD_MS = 90_000

export type SttState = 'idle' | 'recording' | 'transcribing'

export type SttResult =
  | { kind: 'text'; text: string }
  | { kind: 'silence' } // 422 no_speech_detected — "didn't catch that"
  | { kind: 'error'; message: string }

type UseStt = {
  state: SttState
  /** ms elapsed while recording; 0 otherwise. Ticks ~4×/s for the indicator. */
  elapsedMs: number
  /** Quiet one-liner for the composer row (silence hint or error). Cleared on next start. */
  note: string | null
  supported: boolean
  /** Toggle: idle→start recording, recording→stop+transcribe. No-op while transcribing. */
  toggle: () => void
}

function errorCopy(status: number, code: string | undefined): string {
  if (status === 401) return 'Your session expired. Sign in again.'
  if (status === 403) return 'This mic is not enabled for this account.'
  if (code === 'audio_too_short') return 'Too quick — hold it a beat longer.'
  if (status === 413) return 'That recording ran too long.'
  if (status === 502 || status === 504) return 'Transcription is slow right now. Try again.'
  if (status === 503) return 'Transcription is not configured server-side.'
  return 'Could not transcribe that. Try again.'
}

// Pure — the whole response-interpretation branch, extracted so it is testable
// without a DOM (this repo has no jsdom/render-hook tooling, deliberately).
// 422 is the EXPECTED silence outcome and must never render as an error; an
// empty 200 text is treated the same, so a blank insert is impossible.
export function interpretSttResponse(status: number, body: unknown): SttResult {
  if (status === 422) return { kind: 'silence' }
  const b = (body ?? {}) as { text?: unknown; error?: unknown }
  if (status < 200 || status >= 300) {
    return { kind: 'error', message: errorCopy(status, typeof b.error === 'string' ? b.error : undefined) }
  }
  const text = typeof b.text === 'string' ? b.text.trim() : ''
  return text ? { kind: 'text', text } : { kind: 'silence' }
}

export function useStt(onText: (text: string) => void): UseStt {
  const [state, setState] = useState<SttState>('idle')
  const [elapsedMs, setElapsedMs] = useState(0)
  const [note, setNote] = useState<string | null>(null)
  const rec = useRef<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])
  const startedAt = useRef(0)
  const tick = useRef<ReturnType<typeof setInterval> | null>(null)
  const capTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // onText lives in a ref so a long transcription never inserts through a stale closure.
  const onTextRef = useRef(onText)
  onTextRef.current = onText

  const supported = typeof window !== 'undefined'
    && typeof window.MediaRecorder !== 'undefined'
    && !!navigator.mediaDevices?.getUserMedia

  const clearTimers = () => {
    if (tick.current) { clearInterval(tick.current); tick.current = null }
    if (capTimer.current) { clearTimeout(capTimer.current); capTimer.current = null }
  }

  const transcribe = useCallback(async (blob: Blob) => {
    setState('transcribing')
    try {
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token
      if (!token) { setNote('Your session expired. Sign in again.'); setState('idle'); return }
      const form = new FormData()
      form.append('file', blob, 'dictation.webm')
      const res = await fetch(FN_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      })
      const body = await res.json().catch(() => null)
      const out = interpretSttResponse(res.status, body)
      if (out.kind === 'text') { onTextRef.current(out.text); setNote(null) }
      else if (out.kind === 'silence') setNote("Didn't catch that.")
      else setNote(out.message)
      setState('idle')
    } catch {
      setNote('Network dropped mid-transcription. Try again.')
      setState('idle')
    }
  }, [])

  const toggle = useCallback(() => {
    if (state === 'transcribing') return
    if (state === 'recording') { rec.current?.stop(); return }
    setNote(null)
    navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : undefined
      const r = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
      rec.current = r
      chunks.current = []
      r.ondataavailable = e => { if (e.data.size > 0) chunks.current.push(e.data) }
      r.onstop = () => {
        clearTimers()
        setElapsedMs(0)
        stream.getTracks().forEach(t => t.stop())
        const blob = new Blob(chunks.current, { type: r.mimeType || 'audio/webm' })
        chunks.current = []
        void transcribe(blob)
      }
      r.start()
      startedAt.current = Date.now()
      setElapsedMs(0)
      tick.current = setInterval(() => setElapsedMs(Date.now() - startedAt.current), 250)
      capTimer.current = setTimeout(() => { if (r.state === 'recording') r.stop() }, MAX_RECORD_MS)
      setState('recording')
    }).catch(() => {
      setNote('Microphone access was denied.')
      setState('idle')
    })
  }, [state, transcribe])

  // Unmount mid-recording: stop the hardware, drop the audio. Never transcribe
  // into a pane that no longer exists.
  useEffect(() => () => {
    clearTimers()
    const r = rec.current
    if (r && r.state === 'recording') {
      r.onstop = () => r.stream.getTracks().forEach(t => t.stop())
      r.stop()
    }
  }, [])

  return { state, elapsedMs, note, supported, toggle }
}
