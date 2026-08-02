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
// Capture is now REAL and on-device (webkitSpeechRecognition in, speechSynthesis
// out — see the second half of this file and useVoice.ts). The reducer did not
// change to make that work, which was the point of having one: the events that
// drive it went from timers to a live recogniser without a new state.
// 3 consecutive empty listens is the reference's give-up threshold
// (ChatArea.tsx:927) and it is right: retrying forever against a dead mic is how
// the reference loops silently on a broken backend.
export const NO_SPEECH_ROUNDS = 3;
export const IDLE = { s: 'IDLE' };
export function voiceReduce(state, ev, ctx) {
    // A failure can arrive in any state and always wins — this is the one global
    // transition, and it is why ERROR is a state rather than a side-channel string.
    if (ev.e === 'fail')
        return { s: 'ERROR', reason: ev.reason, retryable: ev.retryable };
    // Cancel is the operator's own override and is likewise always available,
    // except while Claude is speaking (there, `skip` is the affordance).
    if (ev.e === 'cancel' && state.s !== 'SPEAKING')
        return IDLE;
    switch (state.s) {
        case 'IDLE':
            return ev.e === 'arm' ? { s: 'ARMING' } : state;
        case 'ARMING':
            return ev.e === 'granted' ? { s: 'LISTENING', level: 0 } : state;
        case 'LISTENING':
            if (ev.e === 'level')
                return { s: 'LISTENING', level: ev.level };
            if (ev.e === 'heard-silence')
                return { s: 'TRANSCRIBING' };
            if (ev.e === 'no-speech') {
                return ev.round >= NO_SPEECH_ROUNDS ? { s: 'PAUSED', reason: 'no-speech' } : state;
            }
            return state;
        case 'PAUSED':
            return ev.e === 'resume' || ev.e === 'arm' ? { s: 'ARMING' } : state;
        case 'TRANSCRIBING':
            if (ev.e === 'transcript') {
                // Empty transcript is not an error — it is silence, and hands-free just
                // listens again.
                return ev.text.trim() ? { s: 'SENDING' } : { s: 'LISTENING', level: 0 };
            }
            return state;
        case 'SENDING':
            if (ev.e === 'turn-done') {
                if (ev.speak)
                    return { s: 'SPEAKING' };
                return ctx.handsFree ? { s: 'LISTENING', level: 0 } : IDLE;
            }
            return state;
        case 'SPEAKING':
            // Note what is NOT here: no 'level', no 'granted', no path back into
            // LISTENING except through the end of playback. The mic cannot be armed
            // from this state.
            if (ev.e === 'speak-end' || ev.e === 'skip') {
                return ctx.handsFree ? { s: 'LISTENING', level: 0 } : IDLE;
            }
            return state;
        case 'ERROR':
            if (ev.e === 'dismiss')
                return IDLE;
            // A retryable failure inside a hands-free session re-arms, but only after
            // the operator has been TOLD (the view shows the reason before this fires).
            if (ev.e === 'resume')
                return state.retryable ? { s: 'ARMING' } : state;
            return state;
    }
}
// Short label for the control itself.
export const VOICE_LABEL = {
    IDLE: 'Voice',
    ARMING: 'Starting…',
    LISTENING: 'Listening',
    PAUSED: 'Paused',
    TRANSCRIBING: 'Transcribing',
    SENDING: 'Thinking',
    SPEAKING: 'Speaking',
    ERROR: 'Voice error',
};
// The distinct, actionable copy the reference collapses into one string. Every
// line here is a different remedy, which is the whole point of the reason field.
export const VOICE_COPY = {
    'mic-denied': 'Mic access is off. Enable it in Settings → Inbox → Microphone.',
    // A refused permission and an absent microphone need different remedies, and the
    // reference collapsed both into "Transcription failed".
    'no-mic': 'No microphone was found on this device.',
    'no-key-broker': 'Voice needs setup — falling back to on-device dictation.',
    // Recognition is on-device, but the browser's engine still calls home on most
    // platforms, so "network" is a real and separate failure from a dead mic.
    'stt-network': "Dictation lost its connection — check your network and try again.",
    'stt-upstream': "The browser's dictation engine failed. Try again in a moment.",
    'tts-failed': "Couldn't read that reply aloud.",
    unsupported: "Voice input isn't available in this browser.",
};
// Severity, in the app's existing 3-tier vocabulary. A tts failure loses nothing
// (the text already arrived), so it is attention, not urgent — and 'no-key-broker'
// degrades rather than fails, so it is not red either.
export function voiceSeverity(reason) {
    return reason === 'tts-failed' || reason === 'no-key-broker' ? 'attention' : 'urgent';
}
// Speech synthesis has to be primed inside a real user gesture on iOS, and it has
// to happen SYNCHRONOUSLY — after any await the gesture is spent and the utterance
// is silently dropped. Called from the mic button's pointerdown, before any state
// transition, and it lives here so the ordering has a single documented home.
export function unlockAudio() {
    if (!ttsSupported())
        return;
    try {
        window.speechSynthesis.resume();
        const u = new SpeechSynthesisUtterance('');
        u.volume = 0;
        window.speechSynthesis.speak(u);
    }
    catch { /* a browser that refuses the prime will simply not speak */ }
}
// Is the microphone live in this state? Used for the pulse and for the a11y
// label — and asserted in the tests, because "SPEAKING never arms the mic" is a
// property, not a comment.
export function micIsLive(state) {
    return state.s === 'LISTENING';
}
export function recognitionCtor() {
    if (typeof window === 'undefined')
        return null;
    const w = window;
    return (w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null);
}
export function sttSupported() {
    return recognitionCtor() !== null;
}
export function ttsSupported() {
    return typeof window !== 'undefined' && 'speechSynthesis' in window;
}
/**
 * SpeechRecognition error string → our typed reason. Each one has a different
 * remedy, which is the entire point of carrying a reason rather than a boolean.
 * `no-speech` is deliberately NOT an error: it is silence, and the machine has a
 * PAUSED state for it.
 */
export function sttErrorReason(code) {
    switch (code) {
        case 'no-speech': return 'no-speech';
        case 'not-allowed':
        case 'service-not-allowed':
            // A refused permission will not un-refuse itself on retry.
            return { reason: 'mic-denied', retryable: false };
        case 'audio-capture': return { reason: 'no-mic', retryable: false };
        case 'network': return { reason: 'stt-network', retryable: true };
        case 'language-not-supported': return { reason: 'unsupported', retryable: false };
        default: return { reason: 'stt-upstream', retryable: true };
    }
}
/**
 * What a reply sounds like. Reading a fenced SQL block or a table of backticks
 * aloud is worse than saying nothing, so the markup comes off and code blocks are
 * announced rather than recited. Pure, so it is tested rather than trusted.
 */
export function speakableText(md, maxChars = 700) {
    const out = md
        // Fenced blocks: say that there is one, do not read it.
        .replace(/```[\s\S]*?```/g, ' — there is a code block on screen. ')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/^#{1,6}\s*/gm, '')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/\*([^*]+)\*/g, '$1')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/^\s*[-*]\s+/gm, '')
        .replace(/\s+/g, ' ')
        .trim();
    if (out.length <= maxChars)
        return out;
    // Cut at a sentence end rather than mid-word.
    const cut = out.slice(0, maxChars);
    const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '));
    return `${stop > maxChars * 0.5 ? cut.slice(0, stop + 1) : cut}…`;
}
