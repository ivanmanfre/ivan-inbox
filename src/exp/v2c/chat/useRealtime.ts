// useRealtime — the LIVE CONVERSATION loop, one speech-to-speech session.
//
// DROP-IN for useLive: it returns the exact same surface
// ({ state, level, interim, last, turns, supported, open, close, skip, resume,
// pause, feedResult }) so ChatPane and LiveSheet consume it unchanged.
//
// WHAT THIS REPLACES. useLive ran three vendors in series — ElevenLabs
// scribe_v2_realtime for ears, inbox-fast (Haiku over SSE) for the brain,
// speechSynthesis for the mouth — and decided turn-taking ITSELF with an energy
// threshold (VAD_RMS) plus a silence timer. phase4-voice.md measured that
// shape: WER 38.6%, and ~97% of the latency was the endpointer waiting out the
// silence after you stopped talking. You cannot tune that away, because the
// slow part is the waiting, not the code.
//
// Here the model owns audio in, audio out, AND endpointing, semantically, on
// partial content. Audio goes browser → OpenAI over WebRTC with no hop through
// an edge relay.
//
// 🔴 THE INVERTED INVARIANT. voice.ts's reducer pins "SPEAKING has no
// transition that arms the mic", and useLive gated mic frames while SPEAKING so
// the model could not hear itself. BARGE-IN REQUIRES THE OPPOSITE: the mic
// stays hot while the assistant talks, which is the whole point — you can cut
// it off mid-sentence. What used to be carried by a state gate is now carried
// by echoCancellation on getUserMedia plus the model's own echo handling. Do
// not "fix" this by muting during SPEAKING; that silently removes barge-in.
//
// WORK still escalates. The model gets ONE tool, escalate_to_workbench, and
// calling it dispatches through the same chat.send as a typed message so the
// pipeline streams into the pane. feedResult() speaks the summary when it lands.
import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { IDLE, type VoiceState } from './voice'

const RT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/inbox-rt-session`
const CALLS_URL = 'https://api.openai.com/v1/realtime/calls'

// --- the pre-session mic buffer -------------------------------------------
//
// useLive had one, and it was load-bearing: connecting takes ~1.5-3s (mic grant
// → mint → SDP → ICE), and a WebRTC track carries NOTHING until ICE is up, so
// every word said inside that window was simply gone. You tap Live, start
// talking, and the model answers the back half of your sentence.
//
// Measured on the wire 2026-08-16 before writing this: `input_audio_buffer.append`
// IS accepted over the `oai-events` data channel, not only over the WebSocket
// transport — appended 5s of 24k mono PCM16, got `input_audio_buffer.committed`
// and a verbatim transcript back. So the fix is to capture PCM from the moment
// the mic is granted and replay it into the same input buffer the live track
// feeds, letting the model's own VAD endpoint the merged stream.
const RT_RATE = 24_000            // the format the API wants: 24k mono pcm16
const PRE_MAX_S = 20              // hard cap — a flush is billed as input audio
const PRE_SPEECH_PEAK = 0.035     // whole buffer under this = room tone, don't pay for it
const PRE_LEAD_S = 0.25           // keep this much run-up before the first loud frame
const PRE_CHUNK = 24_000          // base64 chars per data-channel message

/** Float frames → base64 PCM16, chunked so a long buffer cannot blow the stack. */
function encodePcm16(frames: Float32Array[]): string {
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
// Phase 6 of the scope, and it is not decoration: this lane bills PER MINUTE OF
// AUDIO against a live budget, and it shipped while the Apify $199 cap fight was
// open. A voice session with no meter is a spend you find out about on the
// invoice.
//
// Rates are gpt-realtime-2.1-mini as published 2026-08-16, USD per 1M tokens.
// 🔴 ONE PLACE. If the broker's INBOX_RT_MODEL changes, these change with it —
// the full model is ~3x on the audio lines and the readout would silently
// under-report by that factor.
const RATES = { inText: 0.60, inAudio: 10.00, outText: 2.40, outAudio: 20.00 }

export type LiveUsage = { inText: number; inAudio: number; outText: number; outAudio: number }

const NO_USAGE: LiveUsage = { inText: 0, inAudio: 0, outText: 0, outAudio: 0 }

/**
 * USD for a usage tally. Deliberately an UPPER BOUND: cached input tokens bill
 * at a discount and this does not apply it, so the number on screen can be a
 * little high but never reassuringly low.
 */
export function usageCost(u: LiveUsage): number {
  return (u.inText * RATES.inText + u.inAudio * RATES.inAudio
    + u.outText * RATES.outText + u.outAudio * RATES.outAudio) / 1_000_000
}

type RtEvent = { type?: string; [k: string]: unknown }

const INSTRUCTIONS = [
  'You are Ivan\'s voice interface to his own content and outreach system.',
  'Keep spoken replies SHORT — one or two sentences. He is listening, not reading.',
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
  'first like "checking" or "on it" — then keep listening while it runs.',
  '',
  'Answer directly ONLY for: conversational back-and-forth, restating or clarifying',
  'what he just said, and helping him phrase the task he wants to dispatch.',
].join('\n')

export function useRealtime({ onEscalate }: {
  onEscalate: (task: string) => void
}) {
  const [state, setState] = useState<VoiceState>(IDLE)
  const [level, setLevel] = useState(0)
  const [interim, setInterim] = useState('')
  const [last, setLast] = useState<LiveExchange | null>(null)
  const [turns, setTurns] = useState(0)
  const [usage, setUsage] = useState<LiveUsage>(NO_USAGE)

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
  // been queued, then 1. A gain rather than track.enabled — see the note in
  // open() for the 0.5s that costs.
  const outGate = useRef<GainNode | null>(null)
  const outTrack = useRef<MediaStreamTrack | null>(null)
  // Latest exchange halves, accumulated across deltas before they pair up.
  const heard = useRef('')
  const reply = useRef('')
  // Set when a turn was paired with NO transcript yet, so a late one can be
  // back-filled into it instead of leaking into the next turn.
  const heardPending = useRef(false)
  // Set when he cut the assistant off, cleared when a new response starts. Stops
  // the tail of a cancelled response from dragging the dock back into SPEAKING.
  const barged = useRef(false)
  // onEscalate identity changes every render in ChatPane; keep it in a ref so
  // the data-channel handler never goes stale without re-subscribing.
  const escalate = useRef(onEscalate)
  escalate.current = onEscalate

  const supported = typeof RTCPeerConnection === 'function'
    && typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia

  const send = useCallback((msg: Record<string, unknown>) => {
    const ch = dc.current
    if (ch && ch.readyState === 'open') ch.send(JSON.stringify(msg))
  }, [])

  // Stop taping the mic into the pre-session buffer. Idempotent: called both on
  // a successful flush and on close, and the second call must be harmless.
  const stopTap = useCallback(() => {
    try { preTap.current?.disconnect() } catch { /* already gone */ }
    if (preTap.current) preTap.current.onaudioprocess = null
    preTap.current = null
  }, [])

  /**
   * Replay everything said while connecting into the session's input buffer,
   * then let the live mic through.
   *
   * 🔴 ORDER IS THE WHOLE PROBLEM, TWICE OVER.
   *
   * (1) Appends land at the END of the input buffer, so if the live track is
   *     already flowing the model hears [live tail][replayed opening][live rest].
   *     Measured 2026-08-16: a clean "Check my database and tell me how many
   *     content drafts are pending right now" came back as "Can't check my
   *     database and tell me how graphs are pending right now".
   * (2) `send` only QUEUES on the data channel. Opening the mic the instant the
   *     last append is queued still races ~100KB of SCTP against RTP, and the
   *     seam eats the middle of the sentence. So the gate waits on
   *     `bufferedAmount` reaching zero, re-appending anything the tap caught in
   *     the meantime, and only then opens.
   *
   * Deliberately does NOT commit: the mic continues straight through the seam,
   * so the model's own VAD decides where the turn ends. Committing here would
   * cut the sentence in half at exactly the join this exists to hide.
   */
  const flushPre = useCallback(async () => {
    // Whatever happens below, the mic must end up live.
    const openMic = () => {
      stopTap(); pre.current = []
      const g = outGate.current
      if (!g) return
      // A 20ms ramp rather than a step: a hard jump to 1 puts a click in the
      // first frame the model hears.
      const t0 = g.context.currentTime
      g.gain.setValueAtTime(0, t0)
      g.gain.linearRampToValueAtTime(1, t0 + 0.02)
    }

    const append = (frames: Float32Array[]) => {
      const b64 = encodePcm16(frames)
      for (let i = 0; i < b64.length; i += PRE_CHUNK) {
        send({ type: 'input_audio_buffer.append', audio: b64.slice(i, i + PRE_CHUNK) })
      }
    }

    /** Resolve once the channel has actually put everything on the wire. */
    const drain = () => new Promise<void>(resolve => {
      const started = performance.now()
      const poll = () => {
        const ch = dc.current
        // The 1s ceiling is a guard, not a timeout we expect to hit: a stuck
        // channel must not leave the microphone muted forever.
        if (!ch || ch.bufferedAmount === 0 || performance.now() - started > 1000) return resolve()
        setTimeout(poll, 8)
      }
      poll()
    })

    const frames = pre.current
    pre.current = []
    if (!frames.length) { openMic(); return }

    // Was anything actually said? A silent flush is billed as input audio for
    // nothing, and it happens on every single session start.
    let firstLoud = -1
    for (let i = 0; i < frames.length && firstLoud < 0; i++) {
      const f = frames[i]
      for (let j = 0; j < f.length; j++) {
        if (Math.abs(f[j]) > PRE_SPEECH_PEAK) { firstLoud = i; break }
      }
    }
    if (firstLoud < 0) { openMic(); return }

    // Drop the room tone before the first word, keeping a short run-up so the
    // model still hears the attack of the first consonant. Everything after it
    // is kept: the tail is the bridge to the live mic.
    const lead = Math.ceil((PRE_LEAD_S * RT_RATE) / frames[0].length)
    append(frames.slice(Math.max(0, firstLoud - lead)))
    await drain()

    // Bridge passes: while the first flush was going out the tap kept running,
    // and those frames are exactly the words that used to fall in the gap.
    for (let pass = 0; pass < 4; pass++) {
      const more = pre.current
      pre.current = []
      if (!more.length) break
      append(more)
      await drain()
    }
    openMic()
  }, [send, stopTap])

  const close = useCallback(() => {
    cancelAnimationFrame(raf.current)
    stopTap(); pre.current = []
    try { dc.current?.close() } catch { /* already gone */ }
    try { pc.current?.close() } catch { /* already gone */ }
    try { mic.current?.getTracks().forEach(t => t.stop()) } catch { /* already gone */ }
    // The clone is not in mic.current's stream, so it needs stopping by hand —
    // miss this and the browser keeps the recording indicator lit.
    try { outTrack.current?.stop() } catch { /* already gone */ }
    outTrack.current = null
    try { void ctx.current?.close() } catch { /* already gone */ }
    dc.current = null; pc.current = null; mic.current = null; ctx.current = null
    heard.current = ''; reply.current = ''
    setState(IDLE); setLevel(0); setInterim('')
    // Usage is NOT reset here: what the last session cost stays readable after
    // it ends, which is the only moment anyone actually looks at it.
  }, [stopTap])

  const onEvent = useCallback((ev: RtEvent) => {
    const t = ev.type ?? ''

    // --- turn-taking, decided by the model rather than by our silence timer ---
    if (/input_audio_buffer\.speech_started/.test(t)) {
      // Hot mic during SPEAKING is deliberate: this IS the barge-in path.
      // Do NOT clear reply here: barge-in fires this WHILE a response is still
      // streaming, which wiped the text before response.done could read it.
      barged.current = true
      setState({ s: 'LISTENING', level: 0 })
    }
    // A new response is the only correct place to reset the reply buffer.
    if (/response\.created/.test(t)) { reply.current = ''; barged.current = false }

    // --- what he said ---
    if (/input_audio_transcription\.delta/.test(t)) {
      const d = typeof ev.delta === 'string' ? ev.delta : ''
      if (d) setInterim(prev => prev + d)
    }
    if (/input_audio_transcription\.completed/.test(t)) {
      const txt = typeof ev.transcript === 'string' ? ev.transcript : ''
      if (txt) {
        setInterim('')
        // Transcription is async and routinely lands AFTER response.done, which
        // then paired an exchange with an empty `heard` — measured 2026-08-16,
        // the dock showed the reply with no question above it. Back-fill that
        // turn rather than letting the words leak into the next one.
        if (heardPending.current) {
          heardPending.current = false
          setLast(prev => (prev ? { ...prev, heard: txt } : prev))
        } else {
          heard.current = txt
        }
      }
    }

    // --- what it said ---
    //
    // 🔴 THERE ARE NO AUDIO DELTAS ON THIS TRANSPORT. Over WebRTC the assistant's
    // audio arrives on the RTP track and only TRANSCRIPT deltas come down the
    // data channel — so keying SPEAKING off `output_audio.delta` (the WebSocket
    // event) meant the state never fired at all. Caught by the per-state
    // screenshot pass 2026-08-16: the dock never showed "Speaking", so the
    // tap-to-skip affordance was unreachable by touch. Transcript deltas are
    // emitted in step with the audio, so they are the honest signal here.
    if (/output_audio_transcript\.delta|response\.audio_transcript\.delta/.test(t)) {
      const d = typeof ev.delta === 'string' ? ev.delta : ''
      if (d) {
        reply.current += d
        if (!barged.current) setState(prev => (prev.s === 'SPEAKING' ? prev : { s: 'SPEAKING' }))
      }
    }

    // --- the tool: real work leaves this session ---
    if (/response\.function_call_arguments\.done/.test(t)) {
      const name = typeof ev.name === 'string' ? ev.name : ''
      const callId = typeof ev.call_id === 'string' ? ev.call_id : ''
      if (name === 'escalate_to_workbench') {
        let task = ''
        try {
          const a = JSON.parse(typeof ev.arguments === 'string' ? ev.arguments : '{}')
          task = typeof a.task === 'string' ? a.task : ''
        } catch { /* malformed args: fall through to the ack below */ }
        if (task) escalate.current(task)
        // Close the tool call immediately so the model keeps talking to him
        // while the pipeline runs. The real answer arrives via feedResult().
        send({
          type: 'conversation.item.create',
          item: {
            type: 'function_call_output',
            call_id: callId,
            output: JSON.stringify({ status: 'dispatched, running now' }),
          },
        })
      }
    }

    if (/response\.done/.test(t)) {
      // The API reports usage per response; the session total is the sum. Read
      // defensively — a missing field must cost 0, never NaN, or the readout
      // turns into "$NaN" the first time the shape changes.
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
    }

    if (t === 'error') {
      const e = ev.error as { message?: string } | undefined
      console.warn('realtime error', e?.message ?? ev)
    }
  }, [send])

  const open = useCallback(async () => {
    if (!supported || pc.current) return
    setState({ s: 'ARMING' })
    try {
      // 1. Mic first, straight off the user gesture, or iOS drops the grant.
      //    echoCancellation is load-bearing now that the mic stays hot while
      //    the assistant is speaking (see the inverted-invariant note above).
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
      mic.current = stream

      // 1b. Audio graph, BEFORE the network legs — this is the whole point of
      //     the pre-session buffer. It runs at 24k so the tap needs no
      //     resampling of its own, and it drives the level meter from the mic
      //     grant onward, so ARMING can honestly show that it already hears him.
      const AC = window.AudioContext
        ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      const ac = new AC({ sampleRate: RT_RATE })
      ctx.current = ac
      const src = ac.createMediaStreamSource(stream)
      const analyser = ac.createAnalyser()
      analyser.fftSize = 512
      src.connect(analyser)

      const tap = ac.createScriptProcessor(4096, 1, 1)
      // Chrome will not run a ScriptProcessor that reaches no destination, and
      // routing it straight to the speakers would play his own mic back at him.
      // A zero gain satisfies the graph without making a sound.
      const mute = ac.createGain()
      mute.gain.value = 0
      const capFrames = Math.ceil((PRE_MAX_S * RT_RATE) / 4096)
      tap.onaudioprocess = (e) => {
        if (pre.current.length >= capFrames) return
        pre.current.push(new Float32Array(e.inputBuffer.getChannelData(0)))
      }
      src.connect(tap); tap.connect(mute); mute.connect(ac.destination)
      preTap.current = tap

      // The OUTBOUND track is a Web Audio destination, not the mic track, and
      // its gate is a GAIN rather than `track.enabled`.
      //
      // 🔴 Why: measured 2026-08-16. Gating with `enabled` costs ~0.5s of speech
      // every time it flips back on — the encoder has been sending silence, and
      // it does not resume carrying voice instantly. The transcript lost the
      // middle of the sentence ("how many content drafts" → "how many") even
      // though the tap itself only lagged 140ms. A gain node keeps the encoder
      // warm on real (silent) frames the whole time, so opening the seam is a
      // sample-accurate ramp instead of a stream restart.
      const outGain = ac.createGain()
      outGain.gain.value = 0
      const dest = ac.createMediaStreamDestination()
      src.connect(outGain); outGain.connect(dest)
      outGate.current = outGain

      const buf = new Uint8Array(analyser.frequencyBinCount)
      const tick = () => {
        analyser.getByteTimeDomainData(buf)
        let peak = 0
        for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i] - 128) / 128)
        setLevel(peak)
        setState(prev => (prev.s === 'LISTENING' ? { s: 'LISTENING', level: peak } : prev))
        raf.current = requestAnimationFrame(tick)
      }
      raf.current = requestAnimationFrame(tick)

      // 2. Ephemeral secret. The broker pins the model, so the client cannot
      //    make a spend decision.
      const { data: sess } = await supabase.auth.getSession()
      const jwt = sess.session?.access_token
      if (!jwt) { stopTap(); setState({ s: 'ERROR', reason: 'no-key-broker', retryable: true }); return }
      const r = await fetch(RT_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ instructions: INSTRUCTIONS }),
      })
      if (!r.ok) { stopTap(); setState({ s: 'ERROR', reason: 'no-key-broker', retryable: true }); return }
      const { value, model } = await r.json() as { value: string; model: string }

      // 3. WebRTC
      const conn = new RTCPeerConnection()
      pc.current = conn
      const el = audioEl.current ?? new Audio()
      el.autoplay = true
      audioEl.current = el
      conn.ontrack = (e) => { el.srcObject = e.streams[0] }
      const out = dest.stream.getAudioTracks()[0]
      outTrack.current = out
      conn.addTrack(out, dest.stream)

      const chan = conn.createDataChannel('oai-events')
      dc.current = chan
      chan.onmessage = (e) => {
        try { onEvent(JSON.parse(e.data as string) as RtEvent) } catch { /* not ours */ }
      }
      chan.onopen = () => {
        // NO session.update here. Tools AND instructions are set once, at mint
        // time, by inbox-rt-session. Sending a partial session object replaces
        // the config and silently drops the instructions — measured 2026-08-16:
        // session.updated acked, then the model stopped escalating entirely.
        //
        // The one thing that DOES go out first is whatever he already said
        // while this was connecting.
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
      if (!sdpRes.ok) { stopTap(); setState({ s: 'ERROR', reason: 'stt-network', retryable: true }); return }
      await conn.setRemoteDescription({ type: 'answer', sdp: await sdpRes.text() })
    } catch (e) {
      const denied = e instanceof Error && /NotAllowed|Permission/i.test(e.name + e.message)
      stopTap()
      setState({ s: 'ERROR', reason: denied ? 'mic-denied' : 'stt-network', retryable: !denied })
    }
  }, [supported, onEvent, flushPre, stopTap])

  // skip = cut the assistant off. Same affordance the sheet already offers,
  // now also reachable by simply talking over it.
  const skip = useCallback(() => { send({ type: 'response.cancel' }) }, [send])

  const pause = useCallback(() => {
    mic.current?.getAudioTracks().forEach(t => { t.enabled = false })
    setState({ s: 'PAUSED', reason: 'no-speech' })
  }, [])

  const resume = useCallback(() => {
    mic.current?.getAudioTracks().forEach(t => { t.enabled = true })
    setState({ s: 'LISTENING', level: 0 })
  }, [])

  // The pipeline turn landed. Hand it to the model as context and have it say
  // the short version out loud.
  const feedResult = useCallback((text: string) => {
    send({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: `The workbench finished. Result:\n\n${text}\n\nTell me the outcome in one or two sentences.` }],
      },
    })
    send({ type: 'response.create' })
  }, [send])

  useEffect(() => close, [close])

  return {
    state, level, interim, last, turns, supported,
    usage, cost: usageCost(usage),
    open, close, skip, resume, pause, feedResult,
  }
}
