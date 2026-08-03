import { describe, expect, it } from 'vitest'
import {
  floatToPcm16Base64, frameLevel, mergeTranscript, parseRtEvent, rtAudioFrame,
  rtSocketUrl, RT_KEYTERMS,
} from './rtstt'

// The wire protocol these tests pin was verified against the LIVE endpoint
// (scripts/p3-rt-stt-bench.mjs, 2026-08-03): the field names are the ones the
// server accepted, and the shapes below are the ones it actually sent.

describe('rtSocketUrl', () => {
  it('carries the token, the realtime model, PCM16k, manual commit, and every keyterm', () => {
    const url = rtSocketUrl('sutkn_abc')
    expect(url).toContain('wss://api.elevenlabs.io/v1/speech-to-text/realtime')
    expect(url).toContain('token=sutkn_abc')
    expect(url).toContain('model_id=scribe_v2_realtime')
    expect(url).toContain('audio_format=pcm_16000')
    // Manual, deliberately: the server-VAD variant returned an EMPTY final on
    // the bench clip; end-of-utterance stays a client decision.
    expect(url).toContain('commit_strategy=manual')
    for (const k of RT_KEYTERMS) expect(url).toContain(`keyterms=${encodeURIComponent(k)}`)
  })

  it('keyterms fit the realtime limit (50 terms × 20 chars)', () => {
    expect(RT_KEYTERMS.length).toBeLessThanOrEqual(50)
    for (const k of RT_KEYTERMS) expect(k.length).toBeLessThanOrEqual(20)
  })
})

describe('rtAudioFrame', () => {
  it('is the documented input_audio_chunk shape — not the probe-era {"type":"audio"}', () => {
    const frame = JSON.parse(rtAudioFrame('QUJD', false))
    expect(frame).toEqual({
      message_type: 'input_audio_chunk',
      audio_base_64: 'QUJD',
      commit: false,
      sample_rate: 16000,
    })
  })

  it('commit:true finalises the utterance', () => {
    expect(JSON.parse(rtAudioFrame('', true)).commit).toBe(true)
  })
})

describe('parseRtEvent', () => {
  it('maps the three live frame types', () => {
    expect(parseRtEvent(JSON.stringify({ message_type: 'session_started', session_id: 'x' })))
      .toEqual({ kind: 'session' })
    expect(parseRtEvent(JSON.stringify({ message_type: 'partial_transcript', text: 'check the' })))
      .toEqual({ kind: 'partial', text: 'check the' })
    expect(parseRtEvent(JSON.stringify({ message_type: 'committed_transcript', text: 'Check the queue.' })))
      .toEqual({ kind: 'committed', text: 'Check the queue.' })
    expect(parseRtEvent(JSON.stringify({ message_type: 'committed_transcript_with_timestamps', text: 'Hi', words: [] })))
      .toEqual({ kind: 'committed', text: 'Hi' })
  })

  it('insufficient_audio_activity is SILENCE (empty commit), never an error', () => {
    expect(parseRtEvent(JSON.stringify({ message_type: 'insufficient_audio_activity' })))
      .toEqual({ kind: 'committed', text: '' })
  })

  it('the documented error family maps to typed errors', () => {
    for (const code of ['input_error', 'auth_error', 'quota_exceeded', 'rate_limited',
      'commit_throttled', 'session_time_limit_exceeded', 'transcriber_error', 'chunk_size_exceeded']) {
      expect(parseRtEvent(JSON.stringify({ message_type: code, error: 'x' })))
        .toEqual({ kind: 'error', code })
    }
  })

  it('garbage and unknown shapes are ignored, never thrown', () => {
    expect(parseRtEvent('not json')).toEqual({ kind: 'ignore' })
    expect(parseRtEvent(JSON.stringify({ message_type: 'something_new' }))).toEqual({ kind: 'ignore' })
    expect(parseRtEvent(null)).toEqual({ kind: 'ignore' })
    expect(parseRtEvent(42)).toEqual({ kind: 'ignore' })
  })
})

describe('mergeTranscript — committed is stable, interim is a tail', () => {
  it('joins base and committed segments with single spaces', () => {
    expect(mergeTranscript('already typed', ['first segment.', 'second.'], 'and now'))
      .toEqual({ stable: 'already typed first segment. second.', interim: 'and now' })
  })

  it('never double-spaces and drops empty segments', () => {
    expect(mergeTranscript('  ', ['', '  a  ', ''], '  b  '))
      .toEqual({ stable: 'a', interim: 'b' })
  })

  it('silence contributes nothing — the composer is unchanged', () => {
    expect(mergeTranscript('typed', [], '')).toEqual({ stable: 'typed', interim: '' })
  })
})

describe('floatToPcm16Base64', () => {
  it('encodes little-endian PCM16 with correct clamping', () => {
    const b64 = floatToPcm16Base64(new Float32Array([0, 1, -1, 2, -2]))
    const bin = atob(b64)
    const view = new DataView(Uint8Array.from(bin, c => c.charCodeAt(0)).buffer)
    expect(view.getInt16(0, true)).toBe(0)
    expect(view.getInt16(2, true)).toBe(0x7FFF)
    expect(view.getInt16(4, true)).toBe(-0x8000)
    expect(view.getInt16(6, true)).toBe(0x7FFF)  // clamped
    expect(view.getInt16(8, true)).toBe(-0x8000) // clamped
  })

  it('round-trips a 100ms frame at the send size', () => {
    const samples = new Float32Array(1600).fill(0.5)
    const b64 = floatToPcm16Base64(samples)
    expect(atob(b64).length).toBe(3200)
  })
})

describe('frameLevel', () => {
  it('is 0 for silence and rises with amplitude', () => {
    expect(frameLevel(new Float32Array(160))).toBe(0)
    const quiet = frameLevel(new Float32Array(160).fill(0.01))
    const loud = frameLevel(new Float32Array(160).fill(0.5))
    expect(quiet).toBeGreaterThan(0)
    expect(loud).toBeGreaterThan(quiet)
    expect(frameLevel(new Float32Array(0))).toBe(0)
  })
})
