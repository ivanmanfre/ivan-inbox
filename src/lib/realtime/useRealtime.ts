// useRealtime: the LIVE CONVERSATION loop, one speech-to-speech session.
//
// Restored 2026-09-25 from src/exp/v2c/chat/useRealtime.ts (deleted in
// 7e45573, shipped 2026-08-16) for the live voice screen. What changed on the
// way back, and nothing else:
//   * iOS gesture order: the AudioContext is built and resumed SYNCHRONOUSLY at
//     the top of open(), before the first await, so a tap handler that calls
//     open() spends its gesture on the things that need one. If the context is
//     still suspended once the mic is granted (a deep link, no tap), the hook
//     stops cleanly with ERROR 'needs-gesture' and the screen shows one big
//     "Tap to talk".
//   * mute is a GAIN ramp on the outbound gate, never `track.enabled` (the
//     enable flip costs ~0.5s of speech while the encoder wakes).
//   * `said`: the reply streaming in, for live captions; `outLevel`: the
//     assistant's own audio level, so the orb reacts to both sides.
//   * a peer connection that fails after connect surfaces as ERROR.
//
// Here the model owns audio in, audio out, AND endpointing, semantically, on
// partial content. Audio goes browser to OpenAI over WebRTC with no hop through
// an edge relay.
//
// 🔴 THE INVERTED INVARIANT. voice.ts's reducer pins "SPEAKING has no
// transition that arms the mic". BARGE-IN REQUIRES THE OPPOSITE: the mic stays
// hot while the assistant talks, so you can cut it off mid-sentence. What used
// to be carried by a state gate is carried by echoCancellation on getUserMedia
// plus the model's own echo handling. Do not "fix" this by muting during
// SPEAKING; that silently removes barge-in. (The operator's own Mute button is
// his decision, not the hook's.)
//
// WORK still escalates. The model gets ONE tool, escalate_to_workbench, set at
// MINT time by inbox-rt-session, and calling it dispatches through the same
// chat send as a typed message. feedResult() speaks the summary when it lands.
import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../supabase'
import { IDLE, type VoiceState } from './voice'

const RT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/inbox-rt-session`
const CALLS_URL = 'https://api.openai.com/v1/realtime/calls'

// --- the pre-session mic buffer -------------------------------------------
//
// Connecting takes ~1.5-3s (mic grant, mint, SDP, ICE), and a WebRTC track
// carries NOTHING until ICE is up, so every word said inside that window was
// simply gone. Measured on the wire 2026-08-16: `input_audio_buffer.append` IS
// accepted over the `oai-events` data channel, so the fix is to capture PCM
// from the moment the mic is granted and replay it into the same input buffer
// the live track feeds, letting the model's own VAD endpoint the merged stream.
const RT_RATE = 24_000            // the format the API wants: 24k mono pcm16
const PRE_MAX_S = 20              // hard cap: a flush is billed as input audio
const PRE_SPEECH_PEAK = 0.035     // whole buffer under this = room tone, don't pay for it
const PRE_LEAD_S = 0.25           // keep this much run-up before the first loud frame
const PRE_CHUNK = 24_000          // base64 chars per data-channel message

/** How long a context built outside a tap gets to start before we ask for one. */
const RESUME_WAIT_MS = 600

/** Float frames to base64 PCM16, chunked so a long buffer cannot blow the stack. */
export function encodePcm16(frames: Float32Array[]): string {
  let n = 0
  for (const f of frames) n += f.length
  const pcm = new Uint8Array(n * 2)
  const view = new DataView(pcm.buffer)
  let o = 0
  for (const f of frames) {
    for (let i = 0; i < f.length; i++) {
      const s = Math.max(-1, Math.min(1, f[i]))
      view.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true)
      o += 2
    }
  }
  let bin = ''
  for (let i = 0; i < pcm.length; i += 0x8000) {
    bin += String.fromCharCode(...pcm.subarray(i, i + 0x8000))
  }
  return btoa(bin)
}

export type LiveExchange = { heard: string; reply: string }

// --- what this conversation is costing ------------------------------------
//
// This lane bills PER MINUTE OF AUDIO against a live budget. Rates are
// gpt-realtime-2.1-mini as published 2026-08-16, USD per 1M tokens.
// 🔴 ONE PLACE. If the broker's INBOX_RT_MODEL changes, these change with it.
const RATES = { inText: 0.60, inAudio: 10.00, outText: 2.40, outAudio: 20.00 }

export type LiveUsage = { inText: number; inAudio: number; outText: number; outAudio: number }

const NO_USAGE: LiveUsage = { inText: 0, inAudio: 0, outText: 0, outAudio: 0 }

/**
 * USD for a usage tally. Deliberately an UPPER BOUND: cached input tokens bill
 * at a discount and this does not apply it.
 */
export function usageCost(u: LiveUsage): number {
  return (u.inText * RATES.inText + u.inAudio * RATES.inAudio
    + u.outText * RATES.outText + u.outAudio * RATES.outAudio) / 1_000_000
}

export type RtEvent = { type?: string; [k: string]: unknown }

/**
 * The escalation call, read off a `response.function_call_arguments.done`
 * event. Null for any other event or any other tool. A call with malformed or
 * empty args still returns its call id, so the tool call can be closed.
 */
export function readEscalation(ev: RtEvent): { callId: string; task: string } | null {
  if (!/response\.function_call_arguments\.done/.test(ev.type ?? '')) return null
  if (ev.name !== 'escalate_to_workbench') return null
  const callId = typeof ev.call_id === 'string' ? ev.call_id : ''
  let task = ''
  try {
    const a = JSON.parse(typeof ev.arguments === 'string' ? ev.arguments : '{}') as { task?: unknown }
    task = typeof a.task === 'string' ? a.task.trim() : ''
  } catch { /* malformed args: closed below with an empty task */ }
  return { callId, task }
}

export const INSTRUCTIONS = [
  'You are Ivan\'s voice interface to his own content and outreach system.',
  'Keep spoken replies SHORT: one or two sentences. He is listening, not reading.',
  '',
  'CRITICAL: you do not know anything about his system, his clients, his numbers,',
  'his workflows or his data. You have no access to them and no memory of them.',
  'NEVER guess, estimate, or state a fact about his business from your own knowledge.',
  'Inventing a workflow id, a spend figure or a client detail is the worst thing you',
  'can do here, because it sounds confident and it is wrong.',
  '',
  'So: if he asks anything factual about his system, his data, his clients, or asks',
  'you to DO anything (look something up, check state, edit, run, write, analyse),',
  'call escalate_to_workbench with a clear one-line task. Say a SHORT holding line',
  'first like "checking" or "on it", then keep listening while it runs.',
  '',
  // Measured 2026-08-16: the same spoken question ("how many content drafts are
  // pending") came back 8, then 0, on two consecutive runs. "Pending" maps to
  // several statuses across several tables; a spoken question is not re-read
  // before it is sent, so the ambiguity has to be handled HERE.
  'When he asks for a count or a figure, spoken questions are vaguer than typed',
  'ones: pass his exact words through in the task and tell the workbench to state',
  'WHICH table and field it used. When the summary comes back, say what was',
  'counted, not just the number: "8 of your own, by review status" beats "8".',
  '',
  'Answer directly ONLY for: conversational back-and-forth, restating or clarifying',
  'what he just said, and helping him phrase the task he wants to dispatch.',
].join('\n')

function peakOf(analyser: AnalyserNode, buf: Uint8Array<ArrayBuffer>): number {
  analyser.getByteTimeDomainData(buf)
  let peak = 0
  for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i] - 128) / 128)
  return peak
}

export function useRealtime({ onEscalate }: {
  onEscalate: (task: string) => void
}) {
  const [state, setState] = useState<VoiceState>(IDLE)
  const [level, setLevel] = useState(0)
  const [outLevel, setOutLevel] = useState(0)
  const [interim, setInterim] = useState('')
  // The reply as it streams, for captions. Reset when a new response starts.
  const [said, setSaid] = useState('')
  const [last, setLast] = useState<LiveExchange | null>(null)
  const [turns, setTurns] = useState(0)
  const [usage, setUsage] = useState<LiveUsage>(NO_USAGE)
  const [muted, setMutedState] = useState(false)

  const pc = useRef<RTCPeerConnection | null>(null)
  const dc = useRef<RTCDataChannel | null>(null)
  const mic = useRef<MediaStream | null>(null)
  const audioEl = useRef<HTMLAudioElement | null>(null)
  const ctx = useRef<AudioContext | null>(null)
  const raf = useRef(0)
  // Everything heard between the mic grant and the data channel opening.
  const pre = useRef<Float32Array[]>([])
  const preTap = useRef<ScriptProcessorNode | null>(null)
  // The gate on the OUTBOUND audio: gain 0 until the pre-session buffer has
  // been queued AND drained, then 1 (or 0 again while muted).
  const outGate = useRef<GainNode | null>(null)
  const gateOpen = useRef(false)
  const mutedRef = useRef(false)
  const outTrack = useRef<MediaStreamTrack | null>(null)
  const remoteAnalyser = useRef<AnalyserNode | null>(null)
  // Latest exchange halves, accumulated across deltas before they pair up.
  const heard = useRef('')
  const reply = useRef('')
  // Set when a turn was paired with NO transcript yet, so a late one can be
  // back-filled into it instead of leaking into the next turn.
  const heardPending = useRef(false)
  // Set when he cut the assistant off, cleared when a new response starts. Stops
  // the tail of a cancelled response from dragging the state back into SPEAKING.
  const barged = useRef(false)
  // A response is in flight between response.created and response.done. A
  // response.create sent inside that window is refused by the API
  // (conversation_already_has_active_response), so feedResult defers its ask.
  const responding = useRef(false)
  const askAfter = useRef(false)
  // A generation counter: close() during an in-flight open() must stop that
  // open() from wiring a session into a closed hook.
  const gen = useRef(0)
  const escalate = useRef(onEscalate)
  escalate.current = onEscalate

  const supported = typeof RTCPeerConnection === 'function'
    && typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia

  const emit = useCallback((msg: Record<string, unknown>) => {
    const ch = dc.current
    if (ch && ch.readyState === 'open') ch.send(JSON.stringify(msg))
  }, [])

  // Stop taping the mic into the pre-session buffer. Idempotent.
  const stopTap = useCallback(() => {
    try { preTap.current?.disconnect() } catch { /* already gone */ }
    if (preTap.current) preTap.current.onaudioprocess = null
    preTap.current = null
  }, [])

  /** Ramp the outbound gate. A 20ms ramp rather than a step: a hard jump clicks. */
  const rampGate = useCallback((to: number) => {
    const g = outGate.current
    if (!g) return
    const t0 = g.context.currentTime
    g.gain.cancelScheduledValues(t0)
    g.gain.setValueAtTime(g.gain.value, t0)
    g.gain.linearRampToValueAtTime(to, t0 + 0.02)
  }, [])

  /**
   * Replay everything said while connecting into the session's input buffer,
   * then let the live mic through.
   *
   * 🔴 ORDER IS THE WHOLE PROBLEM, TWICE OVER.
   * (1) Appends land at the END of the input buffer, so if the live track is
   *     already flowing the model hears [live tail][replayed opening][live rest].
   * (2) `send` only QUEUES on the data channel. Opening the mic the instant the
   *     last append is queued still races SCTP against RTP, so the gate waits
   *     on `bufferedAmount` reaching zero, re-appending anything the tap caught
   *     in the meantime, and only then opens.
   * Deliberately does NOT commit: the model's own VAD decides where the turn ends.
   */
  const flushPre = useCallback(async () => {
    const openMic = () => {
      stopTap(); pre.current = []
      gateOpen.current = true
      rampGate(mutedRef.current ? 0 : 1)
    }

    const append = (frames: Float32Array[]) => {
      const b64 = encodePcm16(frames)
      for (let i = 0; i < b64.length; i += PRE_CHUNK) {
        emit({ type: 'input_audio_buffer.append', audio: b64.slice(i, i + PRE_CHUNK) })
      }
    }

    /** Resolve once the channel has actually put everything on the wire. */
    const drain = () => new Promise<void>(resolve => {
      const started = performance.now()
      const poll = () => {
        const ch = dc.current
        // The 1s ceiling is a guard: a stuck channel must not leave the mic muted forever.
        if (!ch || ch.bufferedAmount === 0 || performance.now() - started > 1000) return resolve()
        setTimeout(poll, 8)
      }
      poll()
    })

    const frames = pre.current
    pre.current = []
    // Muted while connecting: what he said then was not meant for the model.
    if (!frames.length || mutedRef.current) { openMic(); return }

    let firstLoud = -1
    for (let i = 0; i < frames.length && firstLoud < 0; i++) {
      const f = frames[i]
      for (let j = 0; j < f.length; j++) {
        if (Math.abs(f[j]) > PRE_SPEECH_PEAK) { firstLoud = i; break }
      }
    }
    if (firstLoud < 0) { openMic(); return }

    const lead = Math.ceil((PRE_LEAD_S * RT_RATE) / frames[0].length)
    append(frames.slice(Math.max(0, firstLoud - lead)))
    await drain()

    // Bridge passes: the tap kept running while the first flush went out.
    for (let pass = 0; pass < 4; pass++) {
      const more = pre.current
      pre.current = []
      if (!more.length) break
      append(more)
      await drain()
    }
    openMic()
  }, [emit, stopTap, rampGate])

  /** Tear everything down. `next` is the state to land in (IDLE, or an ERROR). */
  const teardown = useCallback((next: VoiceState) => {
    gen.current++
    cancelAnimationFrame(raf.current)
    stopTap(); pre.current = []
    try { dc.current?.close() } catch { /* already gone */ }
    try { pc.current?.close() } catch { /* already gone */ }
    try { mic.current?.getTracks().forEach(t => t.stop()) } catch { /* already gone */ }
    // The Web Audio destination track is not in mic.current's stream, so it
    // needs stopping by hand, or the browser keeps the recording indicator lit.
    try { outTrack.current?.stop() } catch { /* already gone */ }
    outTrack.current = null
    try { void ctx.current?.close() } catch { /* already gone */ }
    try { if (audioEl.current) audioEl.current.srcObject = null } catch { /* already gone */ }
    dc.current = null; pc.current = null; mic.current = null; ctx.current = null
    outGate.current = null; gateOpen.current = false; remoteAnalyser.current = null
    heard.current = ''; reply.current = ''; heardPending.current = false
    responding.current = false; askAfter.current = false
    setState(next); setLevel(0); setOutLevel(0); setInterim('')
    // Usage is NOT reset: what the last session cost stays readable after it ends.
  }, [stopTap])

  const close = useCallback(() => teardown(IDLE), [teardown])

  const onEvent = useCallback((ev: RtEvent) => {
    const t = ev.type ?? ''

    // --- turn-taking, decided by the model rather than by a silence timer ---
    if (/input_audio_buffer\.speech_started/.test(t)) {
      // Hot mic during SPEAKING is deliberate: this IS the barge-in path.
      // Do NOT clear reply here: barge-in fires this WHILE a response is still
      // streaming, which wiped the text before response.done could read it.
      barged.current = true
      setState({ s: 'LISTENING', level: 0 })
    }
    // A new response is the only correct place to reset the reply buffer.
    if (/response\.created/.test(t)) {
      reply.current = ''; barged.current = false; responding.current = true; setSaid('')
    }

    // --- what he said ---
    if (/input_audio_transcription\.delta/.test(t)) {
      const d = typeof ev.delta === 'string' ? ev.delta : ''
      if (d) setInterim(prev => prev + d)
    }
    if (/input_audio_transcription\.completed/.test(t)) {
      const txt = typeof ev.transcript === 'string' ? ev.transcript.trim() : ''
      if (txt) {
        setInterim('')
        // Transcription is async and routinely lands AFTER response.done, which
        // then paired an exchange with an empty `heard`. Back-fill that turn
        // rather than letting the words leak into the next one.
        if (heardPending.current) {
          heardPending.current = false
          setLast(prev => (prev ? { ...prev, heard: txt } : prev))
        } else {
          heard.current = txt
        }
      }
    }

    // --- what it said ---
    // 🔴 THERE ARE NO AUDIO DELTAS ON THIS TRANSPORT. Over WebRTC the
    // assistant's audio arrives on the RTP track and only TRANSCRIPT deltas come
    // down the data channel, so keying SPEAKING off `output_audio.delta` (the
    // WebSocket event) never fires. Transcript deltas are the honest signal.
    if (/output_audio_transcript\.delta|response\.audio_transcript\.delta/.test(t)) {
      const d = typeof ev.delta === 'string' ? ev.delta : ''
      if (d) {
        reply.current += d
        setSaid(reply.current)
        if (!barged.current) setState(prev => (prev.s === 'SPEAKING' ? prev : { s: 'SPEAKING' }))
      }
    }

    // --- the tool: real work leaves this session ---
    const call = readEscalation(ev)
    if (call) {
      if (call.task) escalate.current(call.task)
      // Close the tool call immediately so the model keeps talking to him
      // while the pipeline runs. The real answer arrives via feedResult().
      emit({
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: call.callId,
          output: JSON.stringify(call.task
            ? { status: 'dispatched, running now' }
            : { status: 'not dispatched: the task was empty, ask him to say it again' }),
        },
      })
    }

    if (/response\.done/.test(t)) {
      // The API reports usage per response; the session total is the sum. A
      // missing field must cost 0, never NaN.
      const resp = ev.response as { usage?: Record<string, unknown> } | undefined
      const u = resp?.usage
      if (u) {
        const det = (k: string, f: string) => {
          const d = u[k] as Record<string, unknown> | undefined
          const v = d?.[f]
          return typeof v === 'number' ? v : 0
        }
        setUsage(prev => ({
          inText: prev.inText + det('input_token_details', 'text_tokens'),
          inAudio: prev.inAudio + det('input_token_details', 'audio_tokens'),
          outText: prev.outText + det('output_token_details', 'text_tokens'),
          outAudio: prev.outAudio + det('output_token_details', 'audio_tokens'),
        }))
      }
      if (heard.current || reply.current) {
        setLast({ heard: heard.current, reply: reply.current.trim() })
        setTurns(n => n + 1)
        heardPending.current = !heard.current
        heard.current = ''
      }
      setState({ s: 'LISTENING', level: 0 })
      responding.current = false
      if (askAfter.current) { askAfter.current = false; emit({ type: 'response.create' }) }
    }

    if (t === 'error') {
      const e = ev.error as { message?: string } | undefined
      console.warn('realtime error', e?.message ?? ev)
    }
  }, [emit])

  const open = useCallback(async () => {
    if (!supported || pc.current || ctx.current) return
    const my = ++gen.current
    const stale = () => gen.current !== my
    setState({ s: 'ARMING' })

    // 0. Everything that needs a user gesture, SYNCHRONOUSLY, before any await.
    //    iOS starts an AudioContext suspended unless it is built (or resumed)
    //    inside the tap, and the outbound track is fed from this context, so a
    //    suspended one sends silence for the whole session.
    const AC = window.AudioContext
      ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    const ac = new AC({ sampleRate: RT_RATE })
    ctx.current = ac
    const resumed = ac.resume().catch(() => undefined)
    const el = audioEl.current ?? new Audio()
    el.autoplay = true
    el.setAttribute('playsinline', '')
    audioEl.current = el

    try {
      // 1. Mic. echoCancellation is load-bearing: the mic stays hot while the
      //    assistant is speaking (barge-in).
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
      if (stale()) { stream.getTracks().forEach(t => t.stop()); return }
      mic.current = stream

      // 1a. The context must actually be running, or nothing he says leaves.
      await Promise.race([resumed, new Promise(r => setTimeout(r, RESUME_WAIT_MS))])
      if (stale()) return
      if (ac.state !== 'running') {
        teardown({ s: 'ERROR', reason: 'needs-gesture', retryable: true })
        return
      }

      // 1b. Audio graph BEFORE the network legs: this is the pre-session buffer.
      const src = ac.createMediaStreamSource(stream)
      const analyser = ac.createAnalyser()
      analyser.fftSize = 512
      src.connect(analyser)

      const tap = ac.createScriptProcessor(4096, 1, 1)
      // Chrome will not run a ScriptProcessor that reaches no destination, and
      // routing it to the speakers would play his mic back at him. A zero gain
      // satisfies the graph without making a sound.
      const silent = ac.createGain()
      silent.gain.value = 0
      const capFrames = Math.ceil((PRE_MAX_S * RT_RATE) / 4096)
      tap.onaudioprocess = (e) => {
        if (pre.current.length >= capFrames) return
        pre.current.push(new Float32Array(e.inputBuffer.getChannelData(0)))
      }
      src.connect(tap); tap.connect(silent); silent.connect(ac.destination)
      preTap.current = tap

      // The OUTBOUND track is a Web Audio destination, and its gate is a GAIN
      // rather than `track.enabled`. Measured 2026-08-16: the enable flip costs
      // ~0.5s of speech. A gain keeps the encoder warm on real (silent) frames.
      const outGain = ac.createGain()
      outGain.gain.value = 0
      const dest = ac.createMediaStreamDestination()
      src.connect(outGain); outGain.connect(dest)
      outGate.current = outGain

      const buf = new Uint8Array(analyser.frequencyBinCount)
      let lastIn = -1, lastOut = -1
      const tick = () => {
        // Quantised so a still room does not re-render the screen 60 times a second.
        const peak = Math.round(peakOf(analyser, buf) * 50) / 50
        const ra = remoteAnalyser.current
        const outPeak = ra ? Math.round(peakOf(ra, buf) * 50) / 50 : 0
        if (peak !== lastIn) {
          lastIn = peak
          setLevel(peak)
          setState(prev => (prev.s === 'LISTENING' ? { s: 'LISTENING', level: peak } : prev))
        }
        if (outPeak !== lastOut) { lastOut = outPeak; setOutLevel(outPeak) }
        raf.current = requestAnimationFrame(tick)
      }
      raf.current = requestAnimationFrame(tick)

      // 2. Ephemeral secret. The broker pins the model AND the tools, so the
      //    client makes no spend decision and sends no session.update.
      const { data: sess } = await supabase.auth.getSession()
      if (stale()) return
      const jwt = sess.session?.access_token
      if (!jwt) { teardown({ s: 'ERROR', reason: 'no-key-broker', retryable: true }); return }
      const r = await fetch(RT_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ instructions: INSTRUCTIONS }),
      })
      if (stale()) return
      if (!r.ok) { teardown({ s: 'ERROR', reason: 'no-key-broker', retryable: true }); return }
      const { value, model } = await r.json() as { value: string; model: string }
      if (stale()) return

      // 3. WebRTC
      const conn = new RTCPeerConnection()
      pc.current = conn
      conn.ontrack = (e) => {
        const remote = e.streams[0]
        el.srcObject = remote
        void el.play().catch(() => undefined)
        // Read the assistant's level off the same stream (never routed to the
        // speakers from here: the element plays it).
        try {
          const ra = ac.createAnalyser()
          ra.fftSize = 512
          ac.createMediaStreamSource(remote).connect(ra)
          remoteAnalyser.current = ra
        } catch { /* the orb just will not react to the reply */ }
      }
      conn.onconnectionstatechange = () => {
        if (gen.current !== my) return
        if (conn.connectionState === 'failed') teardown({ s: 'ERROR', reason: 'stt-network', retryable: true })
      }
      const out = dest.stream.getAudioTracks()[0]
      outTrack.current = out
      conn.addTrack(out, dest.stream)

      const chan = conn.createDataChannel('oai-events')
      dc.current = chan
      chan.onmessage = (e) => {
        let ev: RtEvent | null = null
        try { ev = JSON.parse(e.data as string) as RtEvent } catch { /* not ours */ }
        if (ev) onEvent(ev)
      }
      chan.onopen = () => {
        // NO session.update here. Tools AND instructions are set once, at mint
        // time, by inbox-rt-session. A partial session object REPLACES the
        // config and silently drops the instructions (measured 2026-08-16).
        // The one thing that DOES go out first is what he said while connecting.
        void flushPre()
        setState({ s: 'LISTENING', level: 0 })
      }

      const offer = await conn.createOffer()
      await conn.setLocalDescription(offer)
      const sdpRes = await fetch(`${CALLS_URL}?model=${encodeURIComponent(model)}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${value}`, 'Content-Type': 'application/sdp' },
        body: offer.sdp ?? '',
      })
      if (stale()) return
      if (!sdpRes.ok) { teardown({ s: 'ERROR', reason: 'stt-network', retryable: true }); return }
      await conn.setRemoteDescription({ type: 'answer', sdp: await sdpRes.text() })
    } catch (e) {
      if (stale()) return
      const name = e instanceof Error ? `${e.name} ${e.message}` : String(e)
      const denied = /NotAllowed|Permission/i.test(name)
      const noMic = /NotFound|DevicesNotFound/i.test(name)
      teardown({
        s: 'ERROR',
        reason: denied ? 'mic-denied' : noMic ? 'no-mic' : 'stt-network',
        retryable: !denied && !noMic,
      })
    }
  }, [supported, onEvent, flushPre, teardown])

  // skip = cut the assistant off. Also reachable by simply talking over it.
  const skip = useCallback(() => { emit({ type: 'response.cancel' }) }, [emit])

  /** The operator's mute. A gain ramp, so unmuting loses no speech. */
  const setMuted = useCallback((m: boolean) => {
    mutedRef.current = m
    setMutedState(m)
    if (gateOpen.current) rampGate(m ? 0 : 1)
  }, [rampGate])

  // The pipeline turn landed. Hand it to the model as context and have it say
  // the short version out loud.
  const feedResult = useCallback((text: string) => {
    emit({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: `The workbench finished. Result:\n\n${text}\n\nTell me the outcome in one or two sentences.` }],
      },
    })
    if (responding.current) askAfter.current = true
    else emit({ type: 'response.create' })
  }, [emit])

  useEffect(() => close, [close])

  return {
    state, level, outLevel, interim, said, last, turns, supported, muted,
    usage, cost: usageCost(usage),
    open, close, skip, setMuted, feedResult,
  }
}

export type Realtime = ReturnType<typeof useRealtime>
