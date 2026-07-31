// The voice state machine from phase1-audit/voice.md Part 2, as a pure reducer.
//
// The audit's central finding about the reference implementation is that its
// `hfStatus` is a DISPLAY enum written by six independent timers racing each
// other: the enum does not gate the timers, the timers set the enum. Here it is
// inverted. There is exactly one state at a time, every timeout is a named
// transition out of a named state, and the state itself forbids the illegal
// moves:
//
//   * SPEAKING has no reachable transition that arms the microphone, so the
//     AEC-less echo bug from audit (b) cannot be reintroduced by a later edit —
//     there is no code path to reintroduce it through.
//   * ERROR carries a typed `reason` plus `retryable`, so the distinct copy from
//     the audit's table is a lookup rather than string literals scattered across
//     a component. The reference collapsed missing-key / dead-mic / OpenAI-down
//     into one "Transcription failed".
//
// No audio is captured in this phase; useVoice drives this reducer from mock
// timers. The reducer is the part that has to be right, and it is testable in
// node.

export type VoiceErrorReason =
  | 'mic-denied'
  | 'no-key-broker'
  | 'stt-network'
  | 'stt-upstream'
  | 'tts-failed'
  | 'unsupported'

export type VoiceState =
  | { s: 'IDLE' }
  | { s: 'ARMING' }
  | { s: 'LISTENING'; level: number }
  | { s: 'PAUSED'; reason: 'no-speech' }
  | { s: 'TRANSCRIBING' }
  | { s: 'SENDING' }
  | { s: 'SPEAKING' }
  | { s: 'ERROR'; reason: VoiceErrorReason; retryable: boolean }

export type VoiceEvent =
  | { e: 'arm' }
  | { e: 'granted' }
  | { e: 'level'; level: number }
  | { e: 'heard-silence' }          // VAD: speech, then silenceMs of quiet
  | { e: 'no-speech'; round: number } // noSpeechMs elapsed with no speech at all
  | { e: 'transcript'; text: string }
  | { e: 'turn-done'; speak: boolean }
  | { e: 'speak-end' }
  | { e: 'skip' }                   // tap to cut playback short
  | { e: 'cancel' }                 // tap the mic off
  | { e: 'resume' }
  | { e: 'fail'; reason: VoiceErrorReason; retryable: boolean }
  | { e: 'dismiss' }

export type VoiceCtx = { handsFree: boolean }

// 3 consecutive empty listens is the reference's give-up threshold
// (ChatArea.tsx:927) and it is right: retrying forever against a dead mic is how
// the reference loops silently on a broken backend.
export const NO_SPEECH_ROUNDS = 3

export const IDLE: VoiceState = { s: 'IDLE' }

export function voiceReduce(state: VoiceState, ev: VoiceEvent, ctx: VoiceCtx): VoiceState {
  // A failure can arrive in any state and always wins — this is the one global
  // transition, and it is why ERROR is a state rather than a side-channel string.
  if (ev.e === 'fail') return { s: 'ERROR', reason: ev.reason, retryable: ev.retryable }
  // Cancel is the operator's own override and is likewise always available,
  // except while Claude is speaking (there, `skip` is the affordance).
  if (ev.e === 'cancel' && state.s !== 'SPEAKING') return IDLE

  switch (state.s) {
    case 'IDLE':
      return ev.e === 'arm' ? { s: 'ARMING' } : state

    case 'ARMING':
      return ev.e === 'granted' ? { s: 'LISTENING', level: 0 } : state

    case 'LISTENING':
      if (ev.e === 'level') return { s: 'LISTENING', level: ev.level }
      if (ev.e === 'heard-silence') return { s: 'TRANSCRIBING' }
      if (ev.e === 'no-speech') {
        return ev.round >= NO_SPEECH_ROUNDS ? { s: 'PAUSED', reason: 'no-speech' } : state
      }
      return state

    case 'PAUSED':
      return ev.e === 'resume' || ev.e === 'arm' ? { s: 'ARMING' } : state

    case 'TRANSCRIBING':
      if (ev.e === 'transcript') {
        // Empty transcript is not an error — it is silence, and hands-free just
        // listens again.
        return ev.text.trim() ? { s: 'SENDING' } : { s: 'LISTENING', level: 0 }
      }
      return state

    case 'SENDING':
      if (ev.e === 'turn-done') {
        if (ev.speak) return { s: 'SPEAKING' }
        return ctx.handsFree ? { s: 'LISTENING', level: 0 } : IDLE
      }
      return state

    case 'SPEAKING':
      // Note what is NOT here: no 'level', no 'granted', no path back into
      // LISTENING except through the end of playback. The mic cannot be armed
      // from this state.
      if (ev.e === 'speak-end' || ev.e === 'skip') {
        return ctx.handsFree ? { s: 'LISTENING', level: 0 } : IDLE
      }
      return state

    case 'ERROR':
      if (ev.e === 'dismiss') return IDLE
      // A retryable failure inside a hands-free session re-arms, but only after
      // the operator has been TOLD (the view shows the reason before this fires).
      if (ev.e === 'resume') return state.retryable ? { s: 'ARMING' } : state
      return state
  }
}

// Short label for the control itself.
export const VOICE_LABEL: Record<VoiceState['s'], string> = {
  IDLE: 'Voice',
  ARMING: 'Starting…',
  LISTENING: 'Listening',
  PAUSED: 'Paused',
  TRANSCRIBING: 'Transcribing',
  SENDING: 'Thinking',
  SPEAKING: 'Speaking',
  ERROR: 'Voice error',
}

// The distinct, actionable copy the reference collapses into one string. Every
// line here is a different remedy, which is the whole point of the reason field.
export const VOICE_COPY: Record<VoiceErrorReason, string> = {
  'mic-denied': 'Mic access is off. Enable it in Settings → Inbox → Microphone.',
  'no-key-broker': 'Voice needs setup — falling back to on-device dictation.',
  'stt-network': "Couldn't reach the transcription service — check your connection and try again.",
  'stt-upstream': 'Transcription service is having trouble right now — try again in a moment.',
  'tts-failed': "Couldn't read that reply aloud.",
  unsupported: "Voice input isn't available in this browser.",
}

// Severity, in the app's existing 3-tier vocabulary. A tts failure loses nothing
// (the text already arrived), so it is attention, not urgent — and 'no-key-broker'
// degrades rather than fails, so it is not red either.
export function voiceSeverity(reason: VoiceErrorReason): 'attention' | 'urgent' {
  return reason === 'tts-failed' || reason === 'no-key-broker' ? 'attention' : 'urgent'
}

// Is the microphone live in this state? Used for the pulse and for the a11y
// label — and asserted in the tests, because "SPEAKING never arms the mic" is a
// property, not a comment.
export function micIsLive(state: VoiceState): boolean {
  return state.s === 'LISTENING'
}
