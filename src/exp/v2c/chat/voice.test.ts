import { describe, expect, it } from 'vitest'
import {
  IDLE, micIsLive, NO_SPEECH_ROUNDS, voiceReduce, voiceSeverity,
  type VoiceEvent, type VoiceState,
} from './voice'

const hf = { handsFree: true }
const once = { handsFree: false }

function run(from: VoiceState, evs: VoiceEvent[], ctx = once): VoiceState {
  return evs.reduce((s, e) => voiceReduce(s, e, ctx), from)
}

const ALL: VoiceState[] = [
  { s: 'IDLE' }, { s: 'ARMING' }, { s: 'LISTENING', level: 0.2 },
  { s: 'PAUSED', reason: 'no-speech' }, { s: 'TRANSCRIBING' }, { s: 'SENDING' },
  { s: 'SPEAKING' }, { s: 'ERROR', reason: 'stt-network', retryable: true },
]

describe('the happy path', () => {
  it('walks IDLE → ARMING → LISTENING → TRANSCRIBING → SENDING → SPEAKING → IDLE', () => {
    const s1 = voiceReduce(IDLE, { e: 'arm' }, once)
    expect(s1.s).toBe('ARMING')
    const s2 = voiceReduce(s1, { e: 'granted' }, once)
    expect(s2.s).toBe('LISTENING')
    const s3 = voiceReduce(s2, { e: 'heard-silence' }, once)
    expect(s3.s).toBe('TRANSCRIBING')
    const s4 = voiceReduce(s3, { e: 'transcript', text: 'why is the pill clipped' }, once)
    expect(s4.s).toBe('SENDING')
    const s5 = voiceReduce(s4, { e: 'turn-done', speak: true }, once)
    expect(s5.s).toBe('SPEAKING')
    expect(voiceReduce(s5, { e: 'speak-end' }, once)).toEqual(IDLE)
  })

  it('loops back to LISTENING instead of IDLE when hands-free is on', () => {
    expect(voiceReduce({ s: 'SPEAKING' }, { e: 'speak-end' }, hf).s).toBe('LISTENING')
    expect(voiceReduce({ s: 'SENDING' }, { e: 'turn-done', speak: false }, hf).s).toBe('LISTENING')
  })

  it('treats an empty transcript as silence, not as an error', () => {
    expect(voiceReduce({ s: 'TRANSCRIBING' }, { e: 'transcript', text: '   ' }, once).s)
      .toBe('LISTENING')
  })
})

describe('SPEAKING structurally forbids the microphone', () => {
  // Audit (b): the reference prevents echo-into-the-mic with an abort plus a
  // generation counter. Here it is unreachable by construction.
  it('has no event that arms the mic from SPEAKING', () => {
    const attempts: VoiceEvent[] = [
      { e: 'arm' }, { e: 'granted' }, { e: 'level', level: 0.9 },
      { e: 'heard-silence' }, { e: 'resume' }, { e: 'no-speech', round: 9 },
      { e: 'cancel' },
    ]
    for (const ev of attempts) {
      expect(voiceReduce({ s: 'SPEAKING' }, ev, hf).s).toBe('SPEAKING')
    }
    expect(micIsLive({ s: 'SPEAKING' })).toBe(false)
    expect(micIsLive({ s: 'LISTENING', level: 0 })).toBe(true)
  })

  it('lets the operator skip playback, which is the real barge-in surface', () => {
    expect(voiceReduce({ s: 'SPEAKING' }, { e: 'skip' }, hf).s).toBe('LISTENING')
    expect(voiceReduce({ s: 'SPEAKING' }, { e: 'skip' }, once).s).toBe('IDLE')
  })
})

describe('ERROR is a state, from anywhere', () => {
  it('wins from every state and keeps its reason and retryability', () => {
    for (const from of ALL) {
      const s = voiceReduce(from, { e: 'fail', reason: 'mic-denied', retryable: false }, hf)
      expect(s).toEqual({ s: 'ERROR', reason: 'mic-denied', retryable: false })
    }
  })

  it('re-arms on resume only when the failure was retryable', () => {
    expect(voiceReduce({ s: 'ERROR', reason: 'stt-network', retryable: true }, { e: 'resume' }, hf).s)
      .toBe('ARMING')
    expect(voiceReduce({ s: 'ERROR', reason: 'mic-denied', retryable: false }, { e: 'resume' }, hf).s)
      .toBe('ERROR')
    expect(voiceReduce({ s: 'ERROR', reason: 'mic-denied', retryable: false }, { e: 'dismiss' }, hf))
      .toEqual(IDLE)
  })

  it('keeps a lost reply out of the urgent tier', () => {
    expect(voiceSeverity('tts-failed')).toBe('attention')
    expect(voiceSeverity('no-key-broker')).toBe('attention')
    expect(voiceSeverity('mic-denied')).toBe('urgent')
  })
})

describe('no-speech gives up rather than looping forever', () => {
  it('stays listening below the round threshold and pauses at it', () => {
    const listening: VoiceState = { s: 'LISTENING', level: 0 }
    expect(voiceReduce(listening, { e: 'no-speech', round: 1 }, hf).s).toBe('LISTENING')
    expect(voiceReduce(listening, { e: 'no-speech', round: NO_SPEECH_ROUNDS }, hf))
      .toEqual({ s: 'PAUSED', reason: 'no-speech' })
  })

  it('resumes from PAUSED on an explicit tap only', () => {
    const paused: VoiceState = { s: 'PAUSED', reason: 'no-speech' }
    expect(voiceReduce(paused, { e: 'level', level: 0.5 }, hf)).toEqual(paused)
    expect(voiceReduce(paused, { e: 'resume' }, hf).s).toBe('ARMING')
  })
})

describe('cancel', () => {
  it('returns to IDLE from any live state except playback', () => {
    expect(run({ s: 'LISTENING', level: 0.3 }, [{ e: 'cancel' }])).toEqual(IDLE)
    expect(run({ s: 'TRANSCRIBING' }, [{ e: 'cancel' }])).toEqual(IDLE)
    expect(voiceReduce({ s: 'SPEAKING' }, { e: 'cancel' }, hf).s).toBe('SPEAKING')
  })
})
