import { describe, expect, it } from 'vitest'
import { interpretSttResponse } from './useStt'

// The response-interpretation contract, pinned against the DEPLOYED fn's error
// table (phase5-voice.md §6). The load-bearing rule: silence is a quiet hint,
// never an error and never an empty insert.

describe('interpretSttResponse', () => {
  it('422 no_speech_detected is silence, not an error', () => {
    expect(interpretSttResponse(422, { error: 'no_speech_detected' }))
      .toEqual({ kind: 'silence' })
  })

  it('a real transcript comes back as text, trimmed', () => {
    expect(interpretSttResponse(200, { text: '  Send Mattan the board link  ', engine: 'scribe_v2' }))
      .toEqual({ kind: 'text', text: 'Send Mattan the board link' })
  })

  it('an empty 200 text is treated as silence — a blank insert is impossible', () => {
    expect(interpretSttResponse(200, { text: '' })).toEqual({ kind: 'silence' })
    expect(interpretSttResponse(200, { text: '   ' })).toEqual({ kind: 'silence' })
    expect(interpretSttResponse(200, {})).toEqual({ kind: 'silence' })
  })

  it('401 names re-auth, 403 names the allowlist', () => {
    expect(interpretSttResponse(401, { error: 'invalid_token' }))
      .toEqual({ kind: 'error', message: 'Your session expired. Sign in again.' })
    expect(interpretSttResponse(403, { error: 'forbidden_user' }))
      .toEqual({ kind: 'error', message: 'This mic is not enabled for this account.' })
  })

  it('audio_too_short reads as retry-shorter-hold, not a failure page', () => {
    const out = interpretSttResponse(400, { error: 'audio_too_short' })
    expect(out.kind).toBe('error')
    if (out.kind === 'error') expect(out.message).toMatch(/hold it a beat/i)
  })

  it('413 / 502 / 503 each carry their own sentence', () => {
    expect(interpretSttResponse(413, { error: 'audio_too_large' }))
      .toEqual({ kind: 'error', message: 'That recording ran too long.' })
    expect(interpretSttResponse(502, { error: 'stt_upstream_error' }))
      .toEqual({ kind: 'error', message: 'Transcription is slow right now. Try again.' })
    expect(interpretSttResponse(503, { error: 'stt_not_configured' }))
      .toEqual({ kind: 'error', message: 'Transcription is not configured server-side.' })
  })

  it('a malformed or missing body never throws', () => {
    expect(interpretSttResponse(500, null).kind).toBe('error')
    expect(interpretSttResponse(500, 'garbage').kind).toBe('error')
    expect(interpretSttResponse(200, null)).toEqual({ kind: 'silence' })
  })
})
