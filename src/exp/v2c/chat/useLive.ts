// useLive — the LIVE CONVERSATION loop. OpenAI-live-chat shape:
// listen → fast model → speak → listen again, with real work escalating
// through the full Railway Claude Code pipeline mid-conversation.
//
// The state machine is the EXISTING tested reducer in voice.ts, driven with
// handsFree: true — extended by events, not rewritten. The invariant its
// tests pin ("SPEAKING has no transition that arms the mic") survives here
// twice over: the reducer has no such path, and this hook's audio pump
// GATES frames on state — while SPEAKING, mic frames are dropped before
// they reach the socket, so the model can never hear itself.
//
// Lanes (all measured 2026-08-03, numbers in phase3-latency-ledger.md):
//   EARS   ElevenLabs scribe_v2_realtime — ONE WS session for the whole loop
//          (one single-use token per loop open), partials drive the meter and
//          client-side end-of-utterance; manual commit (server VAD returned an
//          empty final on the bench — end-of-utterance stays ours).
//   BRAIN  inbox-fast (direct Anthropic SSE, claude-haiku-4-5) — first text
//          delta 1.0-1.3s. The Railway proxy measured 4.14s wall on a trivial
//          turn, which fails the voice gate; that is why this lane exists.
//   MOUTH  speechSynthesis — PICKED BY NUMBERS: 8-21ms first-audible vs
//          ElevenLabs Flash's 400-945ms first-audio over WS. The loser ships
//          as the fallback (speakEl below): used when speechSynthesis is
//          absent/fails, or forced via localStorage 'wb-live-tts'='el'.
//   WORK   <<ESCALATE: …>> in a fast reply → the caller dispatches the task
//          through the EXISTING useChat.send (inbox-claude broker → Railway
//          CLI) so progress streams into the chat pane; when that turn lands,
//          feedResult() runs one more fast turn to SPEAK a summary.
import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import {
  IDLE, NO_SPEECH_ROUNDS, speakableText, ttsSupported, voiceReduce,
  type VoiceEvent, type VoiceState,
} from './voice'
import { floatToPcm16Base64, frameLevel, parseRtEvent, rtAudioFrame, rtSocketUrl, RT_SAMPLE_RATE } from './rtstt'
import {
  detectEscalation, drainSentences, EOU_SILENCE_MS, LIVE_TURN_CAP, parseFastFrame,
  resultFeed, speechFrontier, splitSseBuffer, trimHistory, type LiveMsg,
} from './live'

const RT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/inbox-rt-token`
const FAST_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/inbox-fast`

const SAMPLES_PER_SEND = 1600
// Energy VAD: RMS above this is speech (AGC-normalised mic), below is quiet.
const VAD_RMS = 0.015
// A round of listening with no speech at all before a no-speech event.
const NO_SPEECH_MS = 8000

export type LiveExchange = { heard: string; reply: string }

export function useLive({ onEscalate }: {
  /** Dispatch an escalated task into the real pipeline (useChat.send). */
  onEscalate: (task: string) => void
}) {
  const [state, setState] = useState<VoiceState>(IDLE)
  const [level, setLevel] = useState(0)
  const [interim, setInterim] = useState('')
  const [last, setLast] = useState<LiveExchange | null>(null)
  const [turns, setTurns] = useState(0)

  const ws = useRef<WebSocket | null>(null)
  const ctx = useRef<AudioContext | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const node = useRef<AudioWorkletNode | ScriptProcessorNode | null>(null)
  const acc = useRef<Float32Array[]>([])
  const accLen = useRef(0)
  // Pre-session buffer: the mic chain comes up ~1s before session_started
  // (token mint + WS open). Words spoken into that gap buffer here and flush
  // on grant — same discipline as useRtStt, without it the loop's FIRST
  // utterance loses its opening words (measured: "Check the Supabase…" arrived
  // as "Supabase Q and the…"). Bounded; only fills during ARMING.
  const preSession = useRef<string[]>([])
  const history = useRef<LiveMsg[]>([])
  const rounds = useRef(0)
  const turnCount = useRef(0)
  const speechHeard = useRef(false)
  const lastVoiceAt = useRef(0)
  const listenStartedAt = useRef(0)
  const queuedResult = useRef<string | null>(null)
  const pendingUser = useRef<string | null>(null)
  const eouTimer = useRef<number | null>(null)
  const abortFast = useRef<AbortController | null>(null)
  const stateRef = useRef<VoiceState>(IDLE)
  stateRef.current = state
  const onEscalateRef = useRef(onEscalate)
  onEscalateRef.current = onEscalate
  // ⚠ StrictMode alive-flag: set true in the effect BODY (useChat.ts:79).
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false; hardStopRef.current() }
  }, [])

  const supported = typeof window !== 'undefined'
    && typeof window.WebSocket !== 'undefined'
    && typeof window.AudioContext !== 'undefined'
    && !!navigator.mediaDevices?.getUserMedia

  const dispatch = useCallback((ev: VoiceEvent) => {
    setState(s => {
      const next = voiceReduce(s, ev, { handsFree: true })
      stateRef.current = next
      return next
    })
  }, [])

  // Release the capture chain (socket, worklet, context, mic) WITHOUT touching
  // the conversation — resume-after-error re-arms through this so the loop
  // keeps its history and turn count.
  const releaseMedia = useCallback(() => {
    const w = ws.current; ws.current = null
    if (w) { w.onmessage = null; w.onerror = null; w.onclose = null; try { w.close() } catch { /* dead */ } }
    const n = node.current; node.current = null
    if (n) { try { n.disconnect() } catch { /* dead */ } }
    const c = ctx.current; ctx.current = null
    if (c) { void c.close().catch(() => { /* dead */ }) }
    const s = stream.current; stream.current = null
    if (s) s.getTracks().forEach(t => t.stop())
    acc.current = []; accLen.current = 0
    preSession.current = []
  }, [])

  const hardStop = useCallback(() => {
    if (eouTimer.current) { clearInterval(eouTimer.current); eouTimer.current = null }
    abortFast.current?.abort(); abortFast.current = null
    if (ttsSupported()) window.speechSynthesis.cancel()
    // Don't rely on cancel() firing every queued utterance's events.
    speechDrained.current = null
    utterPending.current = 0
    activeUtters.current = []
    releaseMedia()
    history.current = []
    queuedResult.current = null
    pendingUser.current = null
    rounds.current = 0
    turnCount.current = 0
    if (alive.current) { setLevel(0); setInterim(''); setTurns(0) }
  }, [releaseMedia])
  const hardStopRef = useRef(hardStop)
  hardStopRef.current = hardStop

  // ---- audio pump: gated on the machine's state. Frames flow to the socket
  // ONLY while LISTENING — during SPEAKING/SENDING they are dropped here,
  // before the network, which is the second lock on the echo bug.
  const pushSamples = useCallback((samples: Float32Array) => {
    const s = stateRef.current.s
    if (s !== 'ARMING' && s !== 'LISTENING' && s !== 'TRANSCRIBING') return
    const rms = frameLevel(samples)
    if (s === 'LISTENING' || s === 'ARMING') {
      setLevel(l => l * 0.6 + Math.min(1, rms * 18) * 0.4)
      if (s === 'LISTENING') dispatch({ e: 'level', level: Math.min(1, rms * 18) })
      // Speech during ARMING counts as heard — it is buffered below and will
      // be transcribed, so the EOU watchdog must know about it.
      if (rms > VAD_RMS) { speechHeard.current = true; lastVoiceAt.current = Date.now() }
    }
    acc.current.push(samples)
    accLen.current += samples.length
    if (accLen.current < SAMPLES_PER_SEND) return
    const joined = new Float32Array(accLen.current)
    let off = 0
    for (const chunk of acc.current) { joined.set(chunk, off); off += chunk.length }
    acc.current = []; accLen.current = 0
    const b64 = floatToPcm16Base64(joined)
    const w = ws.current
    if (s === 'ARMING' || !w || w.readyState !== WebSocket.OPEN) {
      // ~30s bound: past that something is wrong and growing a buffer isn't it.
      if (preSession.current.length < 300) preSession.current.push(b64)
      return
    }
    w.send(rtAudioFrame(b64, false))
  }, [dispatch])

  // ---- ARMING → mic + single-use token + one WS for the whole loop ----
  const arm = useCallback(async () => {
    try {
      // Mic and token mint in PARALLEL, and the CAPTURE CHAIN goes up the
      // moment the mic grants — before the mint resolves. Words spoken during
      // the ~1s of token+socket setup land in the ARMING buffer instead of
      // being lost (measured: the sequential order cost the first ~1.2s and
      // turned "Check the Supabase…" into "Supabase Q and the…").
      const micP = navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
      const tokenP = (async () => {
        const { data } = await supabase.auth.getSession()
        const jwt = data.session?.access_token
        if (!jwt) throw new Error('no-key-broker')
        const res = await fetch(RT_URL, {
          method: 'POST',
          headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ kind: 'stt' }),
        })
        if (!res.ok) throw new Error('no-key-broker')
        const { token } = await res.json() as { token?: string }
        if (!token) throw new Error('no-key-broker')
        return token
      })()
      tokenP.catch(() => { /* awaited below — this only silences the pre-await rejection warning */ })

      let mic: MediaStream
      try { mic = await micP } catch { throw new Error('mic-denied') }
      if (!alive.current) { mic.getTracks().forEach(t => t.stop()); return }
      stream.current = mic
      const c = new AudioContext({ sampleRate: RT_SAMPLE_RATE })
      ctx.current = c
      const src = c.createMediaStreamSource(mic)
      try {
        const workletSrc = `registerProcessor('live-pcm', class extends AudioWorkletProcessor {
          process(inputs) { const ch = inputs[0] && inputs[0][0]; if (ch) this.port.postMessage(ch.slice(0)); return true }
        })`
        const url = URL.createObjectURL(new Blob([workletSrc], { type: 'application/javascript' }))
        await c.audioWorklet.addModule(url)
        URL.revokeObjectURL(url)
        const n = new AudioWorkletNode(c, 'live-pcm')
        n.port.onmessage = (e: MessageEvent<Float32Array>) => pushSamples(e.data)
        src.connect(n)
        node.current = n
      } catch {
        const n = c.createScriptProcessor(4096, 1, 1)
        n.onaudioprocess = (e) => pushSamples(new Float32Array(e.inputBuffer.getChannelData(0)))
        src.connect(n)
        n.connect(c.destination)
        node.current = n
      }

      // Capture is rolling into the ARMING buffer — now wait for the token.
      const token = await tokenP
      if (!alive.current) return

      const w = new WebSocket(rtSocketUrl(token))
      ws.current = w
      w.onerror = () => { if (ws.current === w) dispatch({ e: 'fail', reason: 'stt-network', retryable: true }) }
      w.onmessage = (e) => {
        const ev = parseRtEvent(e.data as string)
        if (ev.kind === 'session') {
          // Words spoken while the session was coming up go first.
          for (const b64 of preSession.current) w.send(rtAudioFrame(b64, false))
          preSession.current = []
          dispatch({ e: 'granted' })
        } else if (ev.kind === 'partial') {
          if (alive.current) setInterim(ev.text)
          if (ev.text.trim()) { speechHeard.current = true; lastVoiceAt.current = Date.now() }
        } else if (ev.kind === 'committed') {
          if (alive.current) setInterim('')
          const text = ev.text.trim()
          // The machine's named path: empty commit = silence → LISTENING.
          pendingUser.current = text || null
          dispatch({ e: 'transcript', text })
        } else if (ev.kind === 'error') {
          const retryable = ev.code !== 'auth_error' && ev.code !== 'quota_exceeded'
          dispatch({ e: 'fail', reason: 'stt-upstream', retryable })
        }
      }
    } catch (e) {
      const reason = e instanceof Error && (e.message === 'mic-denied' || e.message === 'no-key-broker')
        ? e.message as 'mic-denied' | 'no-key-broker'
        : 'stt-network'
      dispatch({ e: 'fail', reason, retryable: reason !== 'mic-denied' })
    }
  }, [dispatch, pushSamples])

  // ---- LISTENING: end-of-utterance + no-speech watchdog ----
  useEffect(() => {
    if (state.s !== 'LISTENING') {
      if (eouTimer.current) { clearInterval(eouTimer.current); eouTimer.current = null }
      return
    }
    speechHeard.current = false
    lastVoiceAt.current = 0
    listenStartedAt.current = Date.now()
    setInterim('')
    // A result that landed while we were speaking/working runs now.
    if (queuedResult.current) {
      const r = queuedResult.current
      queuedResult.current = null
      pendingUser.current = r
      dispatch({ e: 'heard-silence' })
      dispatch({ e: 'transcript', text: r })
      return
    }
    eouTimer.current = window.setInterval(() => {
      const now = Date.now()
      if (speechHeard.current) {
        if (now - lastVoiceAt.current >= EOU_SILENCE_MS) {
          if (eouTimer.current) { clearInterval(eouTimer.current); eouTimer.current = null }
          dispatch({ e: 'heard-silence' })
          // Commit on a final silent frame; the committed_transcript that
          // comes back drives the transcript event above.
          const w = ws.current
          if (w && w.readyState === WebSocket.OPEN) {
            w.send(rtAudioFrame(floatToPcm16Base64(new Float32Array(SAMPLES_PER_SEND)), true))
          }
        }
      } else if (now - listenStartedAt.current >= NO_SPEECH_MS) {
        rounds.current += 1
        if (rounds.current >= NO_SPEECH_ROUNDS) {
          // Auto-disarm: three empty rounds means nobody is talking.
          dispatch({ e: 'no-speech', round: rounds.current })
        } else {
          listenStartedAt.current = now
          dispatch({ e: 'no-speech', round: rounds.current })
        }
      }
    }, 200) as unknown as number
    return () => {
      if (eouTimer.current) { clearInterval(eouTimer.current); eouTimer.current = null }
    }
  }, [state.s, dispatch])

  // ---- streaming speech queue (speechSynthesis path) ----
  // Waiting for the FULL reply measured 2.9s median first-audible from end of
  // speech — over the 2.5s gate. So on the default engine each sentence is
  // spoken AS IT COMPLETES in the SSE stream (speechFrontier withholds the
  // <<ESCALATE>> machine span; drainSentences decides sentence boundaries).
  // Echo safety is unchanged: the mic pump drops frames outside LISTENING,
  // so speech during SENDING can never reach the STT socket.
  const utterPending = useRef(0)
  const activeUtters = useRef<SpeechSynthesisUtterance[]>([]) // Chrome GC trap: unreferenced utterances lose their events
  const speechDrained = useRef<(() => void) | null>(null)
  const turnMode = useRef<'stream' | 'whole'>('whole')

  const queueUtterance = useCallback((text: string) => {
    const t = text.trim()
    if (!t) return
    utterPending.current += 1
    const u = new SpeechSynthesisUtterance(t)
    u.rate = 1.04
    activeUtters.current.push(u)
    const settle = () => {
      const i = activeUtters.current.indexOf(u)
      if (i < 0) return // skip()/hardStop() already zeroed this queue — a late event must not touch the NEXT turn's count
      activeUtters.current.splice(i, 1)
      utterPending.current -= 1
      if (utterPending.current <= 0) {
        utterPending.current = 0
        speechDrained.current?.()
      }
    }
    u.onend = settle
    u.onerror = settle
    window.speechSynthesis.speak(u) // queues natively behind the current utterance
  }, [])

  // ---- SENDING: one fast-lane turn ----
  const runFastTurn = useCallback(async (userText: string) => {
    turnCount.current += 1
    if (alive.current) setTurns(turnCount.current)
    if (turnCount.current > LIVE_TURN_CAP) {
      dispatch({ e: 'fail', reason: 'stt-upstream', retryable: false })
      return
    }
    history.current = trimHistory([...history.current, { role: 'user', content: userText }])
    const ctrl = new AbortController()
    abortFast.current = ctrl
    let reply = ''
    // Streaming speech: on by default, off when ElevenLabs is forced (that
    // path speaks the whole reply over one WS) or speechSynthesis is absent.
    const wantEl = (() => { try { return localStorage.getItem('wb-live-tts') === 'el' } catch { return false } })()
    const streaming = !wantEl && ttsSupported()
    turnMode.current = streaming ? 'stream' : 'whole'
    let frontierConsumed = 0
    let sentenceBuf = ''
    const feedSpeech = (done: boolean) => {
      if (!streaming) return
      const frontier = speechFrontier(reply)
      sentenceBuf += frontier.slice(frontierConsumed)
      frontierConsumed = frontier.length
      const { speak, rest } = drainSentences(sentenceBuf, done)
      sentenceBuf = rest
      for (const s of speak) queueUtterance(s)
    }
    try {
      const { data } = await supabase.auth.getSession()
      const jwt = data.session?.access_token
      if (!jwt) throw new Error('auth')
      const res = await fetch(FAST_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history.current }),
        signal: ctrl.signal,
      })
      if (!res.ok || !res.body) throw new Error(`fast_${res.status}`)
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const { frames, rest } = splitSseBuffer(buf)
        buf = rest
        for (const frame of frames) {
          const ev = parseFastFrame(frame)
          if (ev.kind === 'delta') { reply += ev.text; feedSpeech(false) }
          else if (ev.kind === 'error') throw new Error(ev.detail)
        }
      }
    } catch (e) {
      abortFast.current = null
      if (ctrl.signal.aborted) return
      console.error('fast turn failed', e)
      dispatch({ e: 'fail', reason: 'stt-network', retryable: true })
      return
    }
    abortFast.current = null
    if (!alive.current) return
    history.current = [...history.current, { role: 'assistant', content: reply }]
    const esc = detectEscalation(reply)
    const toSpeak = esc ? esc.spoken : speakableText(reply)
    if (esc) onEscalateRef.current(esc.task)
    if (alive.current) setLast({ heard: userText, reply: toSpeak || reply })
    rounds.current = 0
    if (streaming) {
      // Flush the last (possibly unterminated) sentence, then hand SPEAKING
      // a queue to drain instead of text to start.
      feedSpeech(true)
      pendingSpeech.current = ''
      dispatch({ e: 'turn-done', speak: utterPending.current > 0 })
    } else {
      pendingSpeech.current = toSpeak
      dispatch({ e: 'turn-done', speak: !!toSpeak })
    }
  }, [dispatch, queueUtterance])

  const pendingSpeech = useRef('')

  useEffect(() => {
    if (state.s === 'SENDING' && pendingUser.current) {
      const text = pendingUser.current
      pendingUser.current = null
      void runFastTurn(text)
    }
  }, [state.s, runFastTurn])

  // ---- SPEAKING: speechSynthesis primary (11ms first-audible), ElevenLabs
  // Flash WS fallback (811ms median first-audio) — loser ships as fallback,
  // forceable via localStorage 'wb-live-tts'='el'.
  useEffect(() => {
    if (state.s !== 'SPEAKING') return
    // Stream mode: sentences were queued to speechSynthesis DURING the SSE
    // stream — SPEAKING just waits for the queue to drain (or is already done).
    if (turnMode.current === 'stream') {
      let ended = false
      const end = () => { if (!ended) { ended = true; speechDrained.current = null; dispatch({ e: 'speak-end' }) } }
      if (utterPending.current <= 0) { end(); return }
      speechDrained.current = end
      return () => { speechDrained.current = null }
    }
    const text = pendingSpeech.current
    pendingSpeech.current = ''
    if (!text) { dispatch({ e: 'speak-end' }); return }
    let done = false
    const end = () => { if (!done) { done = true; dispatch({ e: 'speak-end' }) } }
    const wantEl = (() => { try { return localStorage.getItem('wb-live-tts') === 'el' } catch { return false } })()
    if (!wantEl && ttsSupported()) {
      try {
        window.speechSynthesis.cancel()
        const u = new SpeechSynthesisUtterance(text)
        u.rate = 1.04
        u.onend = end
        u.onerror = () => { void speakEl(text).finally(end) }
        window.speechSynthesis.speak(u)
        return () => { window.speechSynthesis.cancel(); end() }
      } catch { void speakEl(text).finally(end) }
    } else {
      void speakEl(text).finally(end)
    }
    return () => { end() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.s, dispatch])

  // ---- public surface ----
  const open = useCallback(() => {
    if (stateRef.current.s !== 'IDLE') return
    history.current = []
    turnCount.current = 0
    rounds.current = 0
    setLast(null)
    setTurns(0)
    dispatch({ e: 'arm' })
    void arm()
  }, [arm, dispatch])

  const close = useCallback(() => {
    hardStop()
    setState(IDLE)
    stateRef.current = IDLE
  }, [hardStop])

  const skip = useCallback(() => {
    if (ttsSupported()) window.speechSynthesis.cancel()
    // cancel() should settle every queued utterance, but browsers are flaky
    // about firing events for not-yet-started ones — zero the queue ourselves
    // so a stale count can never wedge the NEXT turn's SPEAKING.
    speechDrained.current = null
    utterPending.current = 0
    activeUtters.current = []
    dispatch({ e: 'skip' })
  }, [dispatch])

  const resume = useCallback(() => {
    rounds.current = 0
    dispatch({ e: 'resume' })
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      // Socket and mic are still armed; PAUSED→ARMING→granted is instant.
      dispatch({ e: 'granted' })
    } else {
      // The socket died (stt-network is the common retryable failure) — a
      // "resume" that only waits for a dead socket would sit in ARMING
      // forever. Re-arm from scratch: fresh mic chain, fresh single-use
      // token, fresh WS. The conversation history survives on purpose.
      releaseMedia()
      void arm()
    }
  }, [dispatch, arm, releaseMedia])

  /** ⌘D's "toggle the loop mic": LISTENING → PAUSED (frames stop flowing). */
  const pause = useCallback(() => {
    if (stateRef.current.s !== 'LISTENING') return
    rounds.current = 0
    dispatch({ e: 'no-speech', round: NO_SPEECH_ROUNDS })
  }, [dispatch])

  /** A completed pipeline turn — spoken as a summary on the next safe beat. */
  const feedResult = useCallback((text: string) => {
    const fed = resultFeed(text)
    if (stateRef.current.s === 'LISTENING') {
      pendingUser.current = fed
      dispatch({ e: 'heard-silence' })
      dispatch({ e: 'transcript', text: fed })
    } else if (stateRef.current.s === 'PAUSED') {
      // "The fast lane speaks a summary when it lands" — a loop that idled
      // into PAUSED while the pipeline worked WAKES for the result. The
      // LISTENING effect consumes queuedResult on entry.
      queuedResult.current = fed
      resume()
    } else if (stateRef.current.s !== 'IDLE' && stateRef.current.s !== 'ERROR') {
      queuedResult.current = fed
    }
  }, [dispatch, resume])

  return { state, level, interim, last, turns, supported, open, close, skip, resume, pause, feedResult }
}

// ---------------------------------------------------------------------------
// ElevenLabs Flash fallback voice — Daniel over the tts_websocket single-use
// token, PCM 22050 scheduled through a throwaway AudioContext. Measured
// first-audio 400-945ms after text send; that is why it is the fallback and
// not the default.
// ---------------------------------------------------------------------------
const EL_VOICE = 'onwK4e9ZLuTAKqWW03F9' // Daniel

async function speakEl(text: string): Promise<void> {
  try {
    const { data } = await supabase.auth.getSession()
    const jwt = data.session?.access_token
    if (!jwt) return
    const res = await fetch(RT_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'tts' }),
    })
    if (!res.ok) return
    const { token } = await res.json() as { token?: string }
    if (!token) return
    const ctx = new AudioContext({ sampleRate: 22050 })
    await new Promise<void>((resolve) => {
      const ws = new WebSocket(
        `wss://api.elevenlabs.io/v1/text-to-speech/${EL_VOICE}/stream-input`
        + `?model_id=eleven_flash_v2_5&output_format=pcm_22050&single_use_token=${encodeURIComponent(token)}`,
      )
      let playhead = 0
      let closed = false
      const finish = () => {
        if (closed) return
        closed = true
        try { ws.close() } catch { /* dead */ }
        const waitMs = Math.max(0, (playhead - ctx.currentTime) * 1000) + 100
        setTimeout(() => { void ctx.close().catch(() => { /* dead */ }); resolve() }, waitMs)
      }
      const timeout = setTimeout(finish, 20000)
      ws.onopen = () => {
        ws.send(JSON.stringify({ text: ' ' }))
        ws.send(JSON.stringify({ text: `${text} ` }))
        ws.send(JSON.stringify({ text: '' }))
      }
      ws.onerror = () => { clearTimeout(timeout); finish() }
      ws.onclose = () => { clearTimeout(timeout); finish() }
      ws.onmessage = (e) => {
        let msg: { audio?: string; isFinal?: boolean }
        try { msg = JSON.parse(e.data as string) } catch { return }
        if (msg.audio) {
          const bin = atob(msg.audio)
          const samples = new Float32Array(bin.length / 2)
          for (let i = 0; i < samples.length; i++) {
            const lo = bin.charCodeAt(i * 2), hi = bin.charCodeAt(i * 2 + 1)
            let v = (hi << 8) | lo
            if (v >= 0x8000) v -= 0x10000
            samples[i] = v / 0x8000
          }
          const buf = ctx.createBuffer(1, samples.length, 22050)
          buf.copyToChannel(samples, 0)
          const src = ctx.createBufferSource()
          src.buffer = buf
          src.connect(ctx.destination)
          const at = Math.max(ctx.currentTime + 0.05, playhead)
          src.start(at)
          playhead = at + buf.duration
        }
        if (msg.isFinal) { clearTimeout(timeout); finish() }
      }
    })
  } catch { /* fallback voice failing is a lost nicety, not an error state */ }
}
