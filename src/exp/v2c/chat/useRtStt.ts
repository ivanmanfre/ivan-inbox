// useRtStt — LIVE dictation over the ElevenLabs realtime WS.
//
// "Words must appear in the chat AS he speaks" (Ivan, verbatim). The batch
// path (useStt.ts) records a blob and shows nothing until the vendor answers;
// this hook streams PCM16 over a browser WebSocket and surfaces
// partial_transcript frames as an interim tail while committed segments become
// stable composer text. The batch hook is KEPT as the fallback path — this one
// mounts only where the browser can capture raw PCM.
//
// Measured contract (scripts/p3-rt-stt-bench.mjs, 2026-08-03, in the ledger):
//   mint 0.6-0.8s warm · WS open ~0.25s · first partial ~2.2s after speech
//   start (server-side floor — invariant to chunk size and commit strategy)
//   · commit→final ~0.2s · finals 0.00% WER with keyterms (batch: 1.6%) ·
//   silence → no partials, empty committed, nothing inserted.
//
// Ordering on mic press: mint and getUserMedia start IN PARALLEL, and audio
// frames buffer client-side until the socket's session_started — so the
// first words are never lost to the ~1s of token+socket setup, and the mint
// stays off the speech-capture critical path.
//
// Tokens are SINGLE-USE: one mint per mic press, never cached.
import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { floatToPcm16Base64, frameLevel, parseRtEvent, rtAudioFrame, rtSocketUrl, RT_SAMPLE_RATE } from './rtstt'

const FN_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/inbox-rt-token`

// ~100ms of audio per WS frame — the cadence the bench ran at.
const SAMPLES_PER_SEND = 1600
// Pre-session buffer bound: 30s of PCM16 at 16k. Past this the mic has been
// open with no session for half a minute; something is wrong — fail, not grow.
const MAX_BUFFER_FRAMES = 300
// Dictation cap, same rationale as the batch path's 90s.
const MAX_SESSION_MS = 90_000
// How long `finishing` waits for the final committed_transcript.
const FINAL_WAIT_MS = 3000

export type RtSttState = 'idle' | 'starting' | 'listening' | 'finishing'

type UseRtStt = {
  state: RtSttState
  /** The newest partial — rendered as a visually-distinct tail, never inserted. */
  interim: string
  /** Mic RMS level 0..~0.5 while listening, for the meter. */
  level: number
  elapsedMs: number
  note: string | null
  supported: boolean
  /** idle→start; listening→commit+finish. No-op while starting/finishing. */
  toggle: () => void
  /** Hard stop: drop the session, insert nothing. */
  cancel: () => void
}

function errorCopy(code: string): string {
  if (code === 'mic-denied') return 'Microphone access was denied.'
  if (code === 'auth') return 'Your session expired. Sign in again.'
  if (code === 'quota_exceeded' || code === 'rate_limited') return 'Transcription is over its limit right now. Try again in a minute.'
  if (code === 'mint') return 'Live dictation could not start (token). Try again.'
  return 'Live dictation dropped. Try again.'
}

export function useRtStt(onCommitted: (text: string) => void): UseRtStt {
  const [state, setState] = useState<RtSttState>('idle')
  const [interim, setInterim] = useState('')
  const [level, setLevel] = useState(0)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [note, setNote] = useState<string | null>(null)

  const ws = useRef<WebSocket | null>(null)
  const ctx = useRef<AudioContext | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const node = useRef<AudioWorkletNode | ScriptProcessorNode | null>(null)
  const sessionOpen = useRef(false)
  const pending = useRef<string[]>([])       // b64 PCM frames buffered pre-session
  const acc = useRef<Float32Array[]>([])     // samples accumulating toward one send
  const accLen = useRef(0)
  const committedAny = useRef(false)
  const timers = useRef<number[]>([])
  const onCommittedRef = useRef(onCommitted)
  onCommittedRef.current = onCommitted
  // ⚠ StrictMode alive-flag: set true in the effect BODY, never cleanup-only —
  // the dev double-invoke otherwise leaves it false forever (useChat.ts:79).
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false; teardownRef.current() }
  }, [])

  const supported = typeof window !== 'undefined'
    && typeof window.WebSocket !== 'undefined'
    && typeof window.AudioContext !== 'undefined'
    && !!navigator.mediaDevices?.getUserMedia

  const clearTimers = () => {
    for (const t of timers.current) clearTimeout(t)
    timers.current = []
  }

  const teardown = useCallback(() => {
    clearTimers()
    const w = ws.current; ws.current = null
    if (w) { w.onmessage = null; w.onerror = null; w.onclose = null; try { w.close() } catch { /* dead */ } }
    const n = node.current; node.current = null
    if (n) { try { n.disconnect() } catch { /* dead */ } }
    const c = ctx.current; ctx.current = null
    if (c) { void c.close().catch(() => { /* dead */ }) }
    const s = stream.current; stream.current = null
    if (s) s.getTracks().forEach(t => t.stop())
    sessionOpen.current = false
    pending.current = []
    acc.current = []; accLen.current = 0
    if (alive.current) { setInterim(''); setLevel(0); setElapsedMs(0) }
  }, [])
  const teardownRef = useRef(teardown)
  teardownRef.current = teardown

  const fail = useCallback((code: string) => {
    teardown()
    if (!alive.current) return
    setNote(errorCopy(code))
    setState('idle')
  }, [teardown])

  // One ~100ms frame is ready: level for the meter, bytes to the socket (or
  // the pre-session buffer).
  const pushSamples = useCallback((samples: Float32Array) => {
    setLevel(l => l * 0.6 + frameLevel(samples) * 0.4)
    acc.current.push(samples)
    accLen.current += samples.length
    if (accLen.current < SAMPLES_PER_SEND) return
    const joined = new Float32Array(accLen.current)
    let off = 0
    for (const s of acc.current) { joined.set(s, off); off += s.length }
    acc.current = []; accLen.current = 0
    const b64 = floatToPcm16Base64(joined)
    const w = ws.current
    if (w && w.readyState === WebSocket.OPEN && sessionOpen.current) {
      w.send(rtAudioFrame(b64, false))
    } else if (pending.current.length < MAX_BUFFER_FRAMES) {
      pending.current.push(b64)
    }
  }, [])

  const start = useCallback(async () => {
    setNote(null)
    committedAny.current = false
    setState('starting')
    const startedAt = Date.now()
    timers.current.push(window.setInterval(() => setElapsedMs(Date.now() - startedAt), 250) as unknown as number)
    timers.current.push(window.setTimeout(() => { void finishRef.current() }, MAX_SESSION_MS))

    // Mic and token in PARALLEL — capture starts buffering immediately.
    const micP = navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    })
    const tokenP = (async () => {
      const { data } = await supabase.auth.getSession()
      const jwt = data.session?.access_token
      if (!jwt) throw new Error('auth')
      const res = await fetch(FN_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'stt' }),
      })
      if (res.status === 401) throw new Error('auth')
      if (!res.ok) throw new Error('mint')
      const body = await res.json() as { token?: string }
      if (!body.token) throw new Error('mint')
      return body.token
    })()

    let mic: MediaStream
    try { mic = await micP } catch { return fail('mic-denied') }
    if (!alive.current) { mic.getTracks().forEach(t => t.stop()); return }
    stream.current = mic

    // Capture path: AudioContext at 16k (Chrome resamples), AudioWorklet for
    // the PCM tap, ScriptProcessor as the legacy fallback. MediaRecorder is
    // useless here — it emits opus, and the realtime API wants raw PCM16.
    try {
      const c = new AudioContext({ sampleRate: RT_SAMPLE_RATE })
      ctx.current = c
      const src = c.createMediaStreamSource(mic)
      try {
        const workletSrc = `registerProcessor('rt-pcm', class extends AudioWorkletProcessor {
          process(inputs) { const ch = inputs[0] && inputs[0][0]; if (ch) this.port.postMessage(ch.slice(0)); return true }
        })`
        const url = URL.createObjectURL(new Blob([workletSrc], { type: 'application/javascript' }))
        await c.audioWorklet.addModule(url)
        URL.revokeObjectURL(url)
        const n = new AudioWorkletNode(c, 'rt-pcm')
        n.port.onmessage = (e: MessageEvent<Float32Array>) => pushSamples(e.data)
        src.connect(n)
        node.current = n
      } catch {
        // Fallback: ScriptProcessor. Deprecated, still everywhere.
        const n = c.createScriptProcessor(4096, 1, 1)
        n.onaudioprocess = (e) => pushSamples(new Float32Array(e.inputBuffer.getChannelData(0)))
        src.connect(n)
        n.connect(c.destination)
        node.current = n
      }
    } catch { return fail('audio') }

    let token: string
    try { token = await tokenP } catch (e) {
      return fail(e instanceof Error ? e.message : 'mint')
    }
    if (!alive.current) return

    const w = new WebSocket(rtSocketUrl(token))
    ws.current = w
    w.onerror = () => { if (ws.current === w) fail('ws') }
    w.onclose = () => {
      // A close while we still think we're live is a failure; during
      // finishing/teardown ws.current is already null or replaced.
      if (ws.current === w && sessionOpen.current) fail('ws')
    }
    w.onmessage = (e) => {
      const ev = parseRtEvent(e.data as string)
      if (ev.kind === 'session') {
        sessionOpen.current = true
        for (const b64 of pending.current) w.send(rtAudioFrame(b64, false))
        pending.current = []
        if (alive.current) setState('listening')
      } else if (ev.kind === 'partial') {
        if (alive.current) setInterim(ev.text)
      } else if (ev.kind === 'committed') {
        const text = ev.text.trim()
        if (text) { committedAny.current = true; onCommittedRef.current(text) }
        if (alive.current) setInterim('')
        finalWaiter.current?.()
      } else if (ev.kind === 'error') {
        fail(ev.code)
      }
    }
  }, [fail, pushSamples])

  const finalWaiter = useRef<(() => void) | null>(null)

  const finish = useCallback(async () => {
    const w = ws.current
    if (!w || w.readyState !== WebSocket.OPEN || !sessionOpen.current) {
      teardown()
      if (alive.current) { setNote("Didn't catch that."); setState('idle') }
      return
    }
    setState('finishing')
    // Flush whatever is accumulated, then commit on a final silent frame.
    if (accLen.current > 0) {
      const joined = new Float32Array(accLen.current)
      let off = 0
      for (const s of acc.current) { joined.set(s, off); off += s.length }
      acc.current = []; accLen.current = 0
      w.send(rtAudioFrame(floatToPcm16Base64(joined), false))
    }
    w.send(rtAudioFrame(floatToPcm16Base64(new Float32Array(SAMPLES_PER_SEND)), true))
    await new Promise<void>(resolve => {
      finalWaiter.current = resolve
      timers.current.push(window.setTimeout(resolve, FINAL_WAIT_MS) as unknown as number)
    })
    finalWaiter.current = null
    teardown()
    if (!alive.current) return
    // Same honesty contract as the batch path: a session that committed
    // nothing changes nothing, and says so quietly.
    if (!committedAny.current) setNote("Didn't catch that.")
    setState('idle')
  }, [teardown])
  const finishRef = useRef(finish)
  finishRef.current = finish

  const toggle = useCallback(() => {
    if (state === 'starting' || state === 'finishing') return
    if (state === 'listening') { void finish(); return }
    void start()
  }, [state, start, finish])

  const cancel = useCallback(() => {
    teardown()
    if (alive.current) setState('idle')
  }, [teardown])

  return { state, interim, level, elapsedMs, note, supported, toggle, cancel }
}
