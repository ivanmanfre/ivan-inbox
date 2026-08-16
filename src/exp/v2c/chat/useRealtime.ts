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

export type LiveExchange = { heard: string; reply: string }

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

  const pc = useRef<RTCPeerConnection | null>(null)
  const dc = useRef<RTCDataChannel | null>(null)
  const mic = useRef<MediaStream | null>(null)
  const audioEl = useRef<HTMLAudioElement | null>(null)
  const ctx = useRef<AudioContext | null>(null)
  const raf = useRef(0)
  // Latest exchange halves, accumulated across deltas before they pair up.
  const heard = useRef('')
  const reply = useRef('')
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

  const close = useCallback(() => {
    cancelAnimationFrame(raf.current)
    try { dc.current?.close() } catch { /* already gone */ }
    try { pc.current?.close() } catch { /* already gone */ }
    try { mic.current?.getTracks().forEach(t => t.stop()) } catch { /* already gone */ }
    try { void ctx.current?.close() } catch { /* already gone */ }
    dc.current = null; pc.current = null; mic.current = null; ctx.current = null
    heard.current = ''; reply.current = ''
    setState(IDLE); setLevel(0); setInterim('')
  }, [])

  const onEvent = useCallback((ev: RtEvent) => {
    const t = ev.type ?? ''

    // --- turn-taking, decided by the model rather than by our silence timer ---
    if (/input_audio_buffer\.speech_started/.test(t)) {
      // Hot mic during SPEAKING is deliberate: this IS the barge-in path.
      // Do NOT clear reply here: barge-in fires this WHILE a response is still
      // streaming, which wiped the text before response.done could read it.
      setState({ s: 'LISTENING', level: 0 })
    }
    // A new response is the only correct place to reset the reply buffer.
    if (/response\.created/.test(t)) reply.current = ''

    // --- what he said ---
    if (/input_audio_transcription\.delta/.test(t)) {
      const d = typeof ev.delta === 'string' ? ev.delta : ''
      if (d) setInterim(prev => prev + d)
    }
    if (/input_audio_transcription\.completed/.test(t)) {
      const txt = typeof ev.transcript === 'string' ? ev.transcript : ''
      if (txt) { heard.current = txt; setInterim('') }
    }

    // --- what it said ---
    if (/output_audio\.delta|response\.audio\.delta/.test(t)) {
      setState({ s: 'SPEAKING' })
    }
    if (/output_audio_transcript\.delta|response\.audio_transcript\.delta/.test(t)) {
      const d = typeof ev.delta === 'string' ? ev.delta : ''
      if (d) reply.current += d
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
      if (heard.current || reply.current) {
        setLast({ heard: heard.current, reply: reply.current.trim() })
        setTurns(n => n + 1)
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

      // 2. Ephemeral secret. The broker pins the model, so the client cannot
      //    make a spend decision.
      const { data: sess } = await supabase.auth.getSession()
      const jwt = sess.session?.access_token
      if (!jwt) { setState({ s: 'ERROR', reason: 'no-key-broker', retryable: true }); return }
      const r = await fetch(RT_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ instructions: INSTRUCTIONS }),
      })
      if (!r.ok) { setState({ s: 'ERROR', reason: 'no-key-broker', retryable: true }); return }
      const { value, model } = await r.json() as { value: string; model: string }

      // 3. WebRTC
      const conn = new RTCPeerConnection()
      pc.current = conn
      const el = audioEl.current ?? new Audio()
      el.autoplay = true
      audioEl.current = el
      conn.ontrack = (e) => { el.srcObject = e.streams[0] }
      conn.addTrack(stream.getAudioTracks()[0], stream)

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
        setState({ s: 'LISTENING', level: 0 })
      }

      const offer = await conn.createOffer()
      await conn.setLocalDescription(offer)
      const sdpRes = await fetch(`${CALLS_URL}?model=${encodeURIComponent(model)}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${value}`, 'Content-Type': 'application/sdp' },
        body: offer.sdp ?? '',
      })
      if (!sdpRes.ok) { setState({ s: 'ERROR', reason: 'stt-network', retryable: true }); return }
      await conn.setRemoteDescription({ type: 'answer', sdp: await sdpRes.text() })

      // 4. Mic level for the meter — the visual answer to "is it hearing me".
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      const ac = new AC()
      ctx.current = ac
      const analyser = ac.createAnalyser()
      analyser.fftSize = 512
      ac.createMediaStreamSource(stream).connect(analyser)
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
    } catch (e) {
      const denied = e instanceof Error && /NotAllowed|Permission/i.test(e.name + e.message)
      setState({ s: 'ERROR', reason: denied ? 'mic-denied' : 'stt-network', retryable: !denied })
    }
  }, [supported, onEvent, send])

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

  return { state, level, interim, last, turns, supported, open, close, skip, resume, pause, feedResult }
}
