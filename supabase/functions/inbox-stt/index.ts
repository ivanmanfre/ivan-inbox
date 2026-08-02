// inbox-stt — server-side speech-to-text for the inbox PWA.
//
// WHY THIS EXISTS. The browser path (webkitSpeechRecognition) was measured on
// 2026-08-01 and failed on three counts at once, recorded in
// goal-runs/inbox-claude-brain-and-voice-2026-08-01-out/phase4-voice.md:
//   - 38.6 % WER on this exact product-noun script — unusable for operator commands
//   - finals silently lost, so a turn could half-happen
//   - the audio left the device to Google's speech-api anyway, so the
//     "nothing leaves the machine" argument for keeping it was never true
// The mic was hidden. It only comes back behind a measured gate (WER < 15 %,
// p50 < 2 s), and this function is the path that had to clear it.
//
// SECURITY POSTURE is copied deliberately from inbox-claude/index.ts, because
// the same facts hold: the inbox is a static bundle on public GitHub Pages and
// can never hold a vendor credential, and exactly one human is allowed to spend
// this one. Every control below fails CLOSED — missing config, unverifiable
// token, wrong user, unparseable body, oversized audio.
//
// PRIVACY. Audio bytes and transcript text are NEVER logged. Only byte counts,
// content types and durations are. A voice note is the most quotable thing the
// operator can hand this system; it does not end up in a log line.
import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')
// Its own secret if set, otherwise the broker's — one operator, one allowlist.
// Never email (mutable) and never role alone (every signed-in user is 'authenticated').
const ALLOWED_USER_ID = Deno.env.get('INBOX_STT_ALLOWED_USER_ID')
  ?? Deno.env.get('INBOX_CLAUDE_ALLOWED_USER_ID')

// Scoped, not '*'. Mirrors inbox-claude's list (GitHub Pages + the vite preview
// ports) and adds the dev server this phase's client half runs on.
const ALLOWED_ORIGINS = [
  'https://ivanmanfre.github.io',
  'http://localhost:4173',
  'http://localhost:4174',
  'http://localhost:4175',
  'http://localhost:5173',
  'http://localhost:5431',
]

/**
 * The engines this function will call, and the exact request each one takes.
 *
 * MEASURED 2026-08-02 on a 20-utterance product-noun script (+2 noisy variants),
 * one request at a time, direct API. Full table in
 * goal-runs/inbox-faithful-revamp-2026-08-02-out/phase5-voice.md:
 *
 *   scribe_v2 + keyterms                         WER  1.67 %   p50  653 ms  ← default
 *   gpt-4o-mini-transcribe + vocabulary prompt   WER  3.94 %   p50  708 ms  (see ECHO_THRESHOLD)
 *   whisper-1 + vocabulary prompt                WER  5.15 %   p50 1184 ms
 *   scribe_v1 + language_code=eng                WER  9.19 %   p50  631 ms
 *   scribe_v2, no keyterms                       WER 11.21 %   p50  630 ms
 *   gpt-4o-mini-transcribe, no prompt            WER 11.50 %   p50  540 ms
 *   whisper-1, no prompt                         WER 17.06 %   p50 1176 ms
 *
 * (For scale: the browser path this replaces measured 38.6 %.)
 *
 * The default wins on every axis that was measured — lowest WER, 0.00 % on a
 * hold-out set whose nouns are absent from the keyterm list, and silence in,
 * silence out. It is also the only biased config with no prompt-echo hazard.
 *
 * INBOX_STT_ENGINE can move the default, but only to a name in this table, and
 * only if that engine's key is actually present — a mis-set env var must 503,
 * never silently transcribe on something else.
 */
type EngineName = 'scribe_v2' | 'scribe_v1' | 'whisper-1' | 'gpt-4o-mini-transcribe'
const DEFAULT_ENGINE: EngineName = 'scribe_v2'
const ENGINES: Record<EngineName, { keyEnv: string; vendor: 'elevenlabs' | 'openai' }> = {
  'scribe_v2': { keyEnv: 'ELEVENLABS_API_KEY', vendor: 'elevenlabs' },
  'scribe_v1': { keyEnv: 'ELEVENLABS_API_KEY', vendor: 'elevenlabs' },
  'whisper-1': { keyEnv: 'OPENAI_API_KEY', vendor: 'openai' },
  'gpt-4o-mini-transcribe': { keyEnv: 'OPENAI_API_KEY', vendor: 'openai' },
}

/**
 * The nouns this operator actually says. Decoding bias toward them is the single
 * largest measured effect in the whole bench — on ElevenLabs it takes the script
 * from 11.21 % to 1.67 % WER, and on a five-utterance hold-out whose nouns are
 * deliberately ABSENT from this list it still scored 0.00 %, so it helps
 * in-vocabulary and costs nothing out of it.
 *
 * ONE list, two wire formats, because the two vendors disagree about the shape:
 *   - ElevenLabs wants repeated `keyterms` form fields (a JSON array in a single
 *     field is read as one 300-character keyword and 400s)
 *   - OpenAI wants one comma-joined `prompt` string
 *
 * Keep it nouns. Do NOT put instructions here — on the OpenAI path this content
 * comes back verbatim under the conditions described at ECHO_THRESHOLD below.
 * Each term must stay under 50 characters and 5 words (ElevenLabs' limits).
 */
const KEYTERMS = [
  'Supabase', 'n8n', 'UniPile', 'Smartlead', 'PostgREST', 'ClickUp', 'RLS', 'OAuth',
  'Railway', 'edge function', 'worktree', 'carousel', 'hyperframes', 'lead magnet',
  'DM', 'LinkedIn', 'RISE DTC', 'Mattan', 'ivanmanfredi.com', 'QA verdict', 'JWT', 'STT',
]
const VOCAB_PROMPT = `${KEYTERMS.join(', ')}.`

/**
 * ⚠ THE FAILURE THIS GUARD EXISTS TO PREVENT, measured 2026-08-02. It does not
 * apply to the default engine — ElevenLabs returned "" on both silence clips
 * with keyterms attached — but it governs the two OpenAI alternates, and it is
 * the reason they are alternates rather than the default:
 *
 * given three seconds of digital silence and the vocabulary prompt above,
 * gpt-4o-mini-transcribe returns THE ENTIRE PROMPT BACK as if it were speech —
 * on room tone it even returned OpenAI's own template scaffold,
 * `context: ###\n<prompt>\n###`. That string is non-empty, so the
 * `no_speech_detected` check below would pass it straight into the operator's
 * composer as a command they never spoke. Mic opened by accident, room quiet,
 * and the inbox is suddenly holding an instruction naming every live system.
 *
 * The guard is the token overlap between the reply and the prompt's vocabulary.
 * Measured separation over 25 real utterances and 4 near-silence clips:
 *   real speech  0 – 19 %   (max was f19, which genuinely says five of these nouns)
 *   silence      100 %      (both clips, both models)
 * 60 % sits ~3x above the highest real utterance and well under every echo.
 * A real command that tripped this would have to enumerate thirteen of the
 * twenty-two nouns in one breath.
 */
const ECHO_THRESHOLD = 0.6
const VOCAB_TOKENS = [...new Set(
  VOCAB_PROMPT.toLowerCase().replace(/[^a-z0-9'\s]/g, ' ').split(/\s+/).filter((t) => t.length > 1),
)]

function vocabEchoScore(text: string): number {
  const toks = new Set(text.toLowerCase().replace(/[^a-z0-9'\s]/g, ' ').split(/\s+/))
  return VOCAB_TOKENS.filter((t) => toks.has(t)).length / VOCAB_TOKENS.length
}

// What MediaRecorder actually produces (webm/opus in Chrome, mp4/aac in Safari),
// plus wav/ogg/mpeg so the benchmark harness and any future upload path use the
// same endpoint the browser does rather than a second, differently-tested one.
const ALLOWED_MIME = [
  'audio/webm', 'audio/ogg', 'audio/wav', 'audio/x-wav', 'audio/wave',
  'audio/mp4', 'audio/mpeg', 'audio/m4a', 'audio/x-m4a', 'audio/flac',
]
// A voice command is seconds long. 10 MB is ~10 minutes of opus and ~5 minutes
// of 16 kHz PCM — generous for the use case and still a hard ceiling on what one
// request can push at a metered vendor.
const MAX_AUDIO_BYTES = 10 * 1024 * 1024
// Empty/one-frame blobs are a UI bug (mic released before data), not speech.
const MIN_AUDIO_BYTES = 512
// Measured p95 is under 2 s. 30 s is the "the vendor is having a bad day" bound;
// past it the operator should be told, not left holding a spinner.
const VENDOR_TIMEOUT_MS = 30_000

function cors(origin: string | null): Record<string, string> {
  const allowed = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Expose-Headers': 'x-stt-engine, x-stt-ms',
    'Vary': 'Origin',
  }
}

function fail(status: number, code: string, origin: string | null, detail?: string) {
  return new Response(JSON.stringify({ error: code, detail }), {
    status,
    headers: { ...cors(origin), 'Content-Type': 'application/json' },
  })
}

function baseMime(m: string): string {
  return (m || '').split(';')[0].trim().toLowerCase()
}

function extFor(mime: string): string {
  const m = baseMime(mime)
  if (m === 'audio/webm') return 'webm'
  if (m === 'audio/ogg') return 'ogg'
  if (m === 'audio/mp4' || m === 'audio/m4a' || m === 'audio/x-m4a') return 'm4a'
  if (m === 'audio/mpeg') return 'mp3'
  if (m === 'audio/flac') return 'flac'
  return 'wav'
}

async function transcribe(
  engine: EngineName, key: string, bytes: ArrayBuffer, mime: string,
): Promise<string> {
  const filename = `audio.${extFor(mime)}`
  const fd = new FormData()
  fd.append('file', new Blob([bytes], { type: baseMime(mime) }), filename)

  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), VENDOR_TIMEOUT_MS)
  try {
    let res: Response
    if (ENGINES[engine].vendor === 'elevenlabs') {
      fd.append('model_id', engine)
      // Pinned. Auto-detect returned English at only 0.74 probability on these
      // clips; a short command misread as another language is a total loss, and
      // this inbox is English-only.
      fd.append('language_code', 'eng')
      // OFF deliberately. With events on, room tone transcribes as the literal
      // string "[pause]" — non-empty, so it would reach the composer as text.
      // Off, the same clip returns "". Measured 2026-08-02.
      fd.append('tag_audio_events', 'false')
      // Repeated fields, one per term. See KEYTERMS. +20 % on the audio rate,
      // which at this volume is cents a month and buys 11.21 % -> 1.67 % WER.
      for (const k of KEYTERMS) fd.append('keyterms', k)
      res = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
        method: 'POST', headers: { 'xi-api-key': key }, body: fd, signal: ctl.signal,
      })
    } else {
      fd.append('model', engine)
      fd.append('language', 'en')
      fd.append('prompt', VOCAB_PROMPT)
      res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: fd, signal: ctl.signal,
      })
    }
    if (!res.ok) {
      // Vendor error bodies can echo request content; take the status and a short
      // slice for the operator's error card, and log only the status.
      const detail = (await res.text().catch(() => '')).slice(0, 200)
      console.error('vendor rejected', { engine, status: res.status })
      throw new Error(`vendor_${res.status}: ${detail}`)
    }
    const json = await res.json() as { text?: string }
    return typeof json.text === 'string' ? json.text.trim() : ''
  } finally {
    clearTimeout(timer)
  }
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin')
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(origin) })
  if (req.method !== 'POST') return fail(405, 'method_not_allowed', origin)

  // Config first. An unset allowlist must refuse to serve — "no allowlist means
  // everyone" is the exact fail-open that left the upstream container open.
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !ALLOWED_USER_ID) {
    console.error('refusing: incomplete config', {
      url: !!SUPABASE_URL, anon: !!SUPABASE_ANON_KEY, allow: !!ALLOWED_USER_ID,
    })
    return fail(503, 'stt_not_configured', origin)
  }

  const wantEngine = (Deno.env.get('INBOX_STT_ENGINE') || DEFAULT_ENGINE) as EngineName
  const spec = ENGINES[wantEngine]
  if (!spec) {
    console.error('refusing: unknown engine configured', { wantEngine })
    return fail(503, 'stt_engine_unknown', origin, `known: ${Object.keys(ENGINES).join(', ')}`)
  }
  const key = Deno.env.get(spec.keyEnv)
  if (!key) {
    console.error('refusing: engine key missing', { wantEngine, keyEnv: spec.keyEnv })
    return fail(503, 'stt_key_missing', origin)
  }

  const authz = req.headers.get('Authorization') ?? ''
  const jwt = authz.startsWith('Bearer ') ? authz.slice(7).trim() : ''
  if (!jwt) return fail(401, 'unauthenticated', origin)

  // getUser() validates signature and expiry server-side. Never decode the
  // payload manually — that accepts any forged token.
  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } })
  const { data, error } = await sb.auth.getUser(jwt)
  const user = data?.user
  if (error || !user) return fail(401, 'invalid_token', origin)
  if (user.id !== ALLOWED_USER_ID) {
    console.warn('rejected non-allowlisted user', { attempted: user.id })
    return fail(403, 'forbidden_user', origin)
  }

  // ---- body: multipart (what a MediaRecorder Blob + fetch does cleanly) or
  // ---- JSON base64 (for callers that cannot build a FormData). Nothing else.
  const ctype = baseMime(req.headers.get('content-type') ?? '')
  let bytes: ArrayBuffer
  let mime: string
  try {
    if (ctype === 'multipart/form-data') {
      const form = await req.formData()
      const file = form.get('file')
      if (!(file instanceof File)) return fail(400, 'no_audio', origin, 'expected a `file` part')
      mime = baseMime(file.type) || 'audio/webm'
      bytes = await file.arrayBuffer()
    } else if (ctype === 'application/json') {
      const body = await req.json() as { audio_base64?: unknown; mime?: unknown }
      if (typeof body.audio_base64 !== 'string' || !body.audio_base64) {
        return fail(400, 'no_audio', origin, 'expected `audio_base64`')
      }
      mime = baseMime(typeof body.mime === 'string' ? body.mime : 'audio/webm')
      // Base64 inflates by 4/3; bound the string before decoding it.
      if (body.audio_base64.length > MAX_AUDIO_BYTES * 1.4) {
        return fail(413, 'audio_too_large', origin)
      }
      const bin = atob(body.audio_base64)
      const u8 = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i)
      bytes = u8.buffer
    } else {
      return fail(415, 'unsupported_content_type', origin,
        'send multipart/form-data with a `file` part, or application/json with `audio_base64`')
    }
  } catch (e) {
    console.error('body parse failed', { message: e instanceof Error ? e.name : 'unknown' })
    return fail(400, 'bad_body', origin)
  }

  if (!ALLOWED_MIME.includes(mime)) {
    return fail(415, 'unsupported_audio_type', origin, `got ${mime}; allowed: ${ALLOWED_MIME.join(', ')}`)
  }
  if (bytes.byteLength < MIN_AUDIO_BYTES) return fail(400, 'audio_too_short', origin)
  if (bytes.byteLength > MAX_AUDIO_BYTES) return fail(413, 'audio_too_large', origin)

  const t0 = performance.now()
  let text: string
  try {
    text = await transcribe(wantEngine, key, bytes, mime)
  } catch (e) {
    const aborted = e instanceof Error && e.name === 'AbortError'
    // Byte count and type only. The audio itself never reaches a log line.
    console.error('transcription failed', { engine: wantEngine, bytes: bytes.byteLength, mime, aborted })
    return fail(aborted ? 504 : 502, aborted ? 'stt_timeout' : 'stt_upstream_error', origin,
      e instanceof Error ? e.message.slice(0, 200) : undefined)
  }
  const ms = Math.round(performance.now() - t0)

  // Silence is a real outcome and gets its own code, because "" rendered into a
  // composer looks identical to a bug and the operator should be able to tell.
  if (!text) {
    console.warn('empty transcript', { engine: wantEngine, bytes: bytes.byteLength, ms })
    return fail(422, 'no_speech_detected', origin)
  }

  // The other shape silence takes on a prompted model: the prompt, handed back.
  // Same operator-facing meaning as an empty transcript, so it gets the same
  // answer rather than a distinct error the UI would have to learn.
  if (ENGINES[wantEngine].vendor === 'openai') {
    const echo = vocabEchoScore(text)
    if (echo >= ECHO_THRESHOLD) {
      // Score and length only. The text is not logged even here — especially
      // not here, since a false positive would be real dictated speech.
      console.warn('vocabulary echo suppressed', {
        engine: wantEngine, echo: Number(echo.toFixed(2)), chars: text.length, ms,
      })
      return fail(422, 'no_speech_detected', origin)
    }
  }

  return new Response(JSON.stringify({ text, engine: wantEngine, ms }), {
    headers: {
      ...cors(origin),
      'Content-Type': 'application/json',
      'X-Stt-Engine': wantEngine,
      'X-Stt-Ms': String(ms),
    },
  })
})
