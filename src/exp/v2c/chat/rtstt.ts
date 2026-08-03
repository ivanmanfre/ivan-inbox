// rtstt — the ElevenLabs scribe_v2_realtime wire protocol, as pure functions.
//
// Everything here was verified against the LIVE endpoint on 2026-08-03
// (scripts/p3-rt-stt-bench.mjs, results in phase3-latency-ledger.md):
//   - client → server frames are {"message_type":"input_audio_chunk",
//     "audio_base_64":…, "commit":bool, "sample_rate":16000}. The earlier
//     probe's {"type":"audio"} shape gets input_error — the field names here
//     are the ones the server actually takes.
//   - server → client: session_started / partial_transcript /
//     committed_transcript (+_with_timestamps) / a family of *error types.
//   - finals with keyterms measured 0.00% WER on the 5-sentence keyterm bench
//     (batch scribe_v2 measured 1.6% on the same clips), so realtime finals
//     ship DIRECTLY — the hybrid interims-plus-batch-final path is not needed.
//   - silence emits no partials and an empty committed text. "" never
//     reaches the composer (same honesty contract as the batch path).
//   - commit_strategy=manual, deliberately. The server-VAD variant returned
//     an EMPTY committed transcript on a clip the manual path transcribed
//     exactly; end-of-utterance stays a client decision.
//
// The hook (useRtStt.ts) owns the socket and the mic; this file owns every
// decision that can be unit-tested without either.

// ONE list, kept in step with KEYTERMS in supabase/functions/inbox-stt/index.ts
// — the single largest measured WER lever (11.21% → 1.67% on batch). The
// realtime API takes them as repeated `keyterms` query params (limit 50 terms
// × 20 chars; longest here is 16).
export const RT_KEYTERMS = [
  'Supabase', 'n8n', 'UniPile', 'Smartlead', 'PostgREST', 'ClickUp', 'RLS', 'OAuth',
  'Railway', 'edge function', 'worktree', 'carousel', 'hyperframes', 'lead magnet',
  'DM', 'LinkedIn', 'RISE DTC', 'Mattan', 'ivanmanfredi.com', 'QA verdict', 'JWT', 'STT',
]

export const RT_SAMPLE_RATE = 16000

/** The WS url for one session. Token is SINGLE-USE — mint per mic press. */
export function rtSocketUrl(token: string): string {
  const keyterms = RT_KEYTERMS.map(k => `&keyterms=${encodeURIComponent(k)}`).join('')
  return 'wss://api.elevenlabs.io/v1/speech-to-text/realtime'
    + `?token=${encodeURIComponent(token)}`
    + '&model_id=scribe_v2_realtime'
    + `&audio_format=pcm_${RT_SAMPLE_RATE}`
    + '&language_code=eng'
    + '&commit_strategy=manual'
    + keyterms
}

/** One client→server audio frame. `commit: true` finalises the utterance. */
export function rtAudioFrame(audioBase64: string, commit: boolean): string {
  return JSON.stringify({
    message_type: 'input_audio_chunk',
    audio_base_64: audioBase64,
    commit,
    sample_rate: RT_SAMPLE_RATE,
  })
}

export type RtEvent =
  | { kind: 'session' }
  | { kind: 'partial'; text: string }
  | { kind: 'committed'; text: string }
  | { kind: 'error'; code: string }
  | { kind: 'ignore' }

/** One server frame → one typed event. Unknown shapes are ignored, never thrown. */
export function parseRtEvent(raw: unknown): RtEvent {
  let msg: Record<string, unknown>
  if (typeof raw === 'string') {
    try { msg = JSON.parse(raw) as Record<string, unknown> } catch { return { kind: 'ignore' } }
  } else if (raw && typeof raw === 'object') {
    msg = raw as Record<string, unknown>
  } else return { kind: 'ignore' }
  const mt = typeof msg.message_type === 'string' ? msg.message_type : ''
  if (mt === 'session_started') return { kind: 'session' }
  if (mt === 'partial_transcript') {
    return { kind: 'partial', text: typeof msg.text === 'string' ? msg.text : '' }
  }
  if (mt === 'committed_transcript' || mt === 'committed_transcript_with_timestamps') {
    return { kind: 'committed', text: typeof msg.text === 'string' ? msg.text : '' }
  }
  // The documented error family: error, auth_error, quota_exceeded,
  // commit_throttled, rate_limited, queue_overflow, resource_exhausted,
  // session_time_limit_exceeded, input_error, chunk_size_exceeded,
  // transcriber_error … all carry "error" in the type. One exception:
  // insufficient_audio_activity is the server saying "that commit had no
  // speech" — that is SILENCE, not a failure, and it must not tear the
  // session down as an error.
  if (mt === 'insufficient_audio_activity') return { kind: 'committed', text: '' }
  if (mt.includes('error') || mt === 'quota_exceeded' || mt === 'rate_limited'
    || mt === 'commit_throttled' || mt === 'queue_overflow' || mt === 'resource_exhausted'
    || mt === 'session_time_limit_exceeded' || mt === 'chunk_size_exceeded') {
    return { kind: 'error', code: mt }
  }
  return { kind: 'ignore' }
}

/**
 * The composer's view of an in-flight dictation: committed segments are
 * STABLE text, the newest partial is a visually-distinct interim tail. This
 * is the merge rule — join with single spaces, never double-space, and an
 * interim that the server has since committed contributes nothing extra.
 */
export function mergeTranscript(base: string, committed: string[], interim: string): {
  stable: string; interim: string
} {
  const stable = [base, ...committed]
    .map(s => s.trim())
    .filter(Boolean)
    .join(' ')
  return { stable, interim: interim.trim() }
}

/** Float32 [-1,1] samples → base64 of little-endian PCM16. */
export function floatToPcm16Base64(samples: Float32Array): string {
  const buf = new ArrayBuffer(samples.length * 2)
  const view = new DataView(buf)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true)
  }
  const u8 = new Uint8Array(buf)
  let bin = ''
  const STEP = 0x8000
  for (let i = 0; i < u8.length; i += STEP) {
    bin += String.fromCharCode(...u8.subarray(i, i + STEP))
  }
  return btoa(bin)
}

/** RMS level of a frame, for the meter and the loop's client-side VAD. */
export function frameLevel(samples: Float32Array): number {
  if (!samples.length) return 0
  let sum = 0
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i]
  return Math.sqrt(sum / samples.length)
}
