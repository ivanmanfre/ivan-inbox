import { VOICE_COPY, VOICE_LABEL, type VoiceErrorReason, type VoiceState } from './chat/voice'
import type { LiveExchange } from './chat/useRealtime'

// The LIVE CONVERSATION dock — what replaced LiveSheet's modal takeover.
//
// WHY IT CHANGED. LiveSheet was a `sheet-scrim` + `sheet-card`: talking COVERED
// the app. That is Ivan's complaint stated precisely — "not as easy to use as
// VS Code" — because VS Code's whole value is that you watch the work happen
// while you direct it, and a scrim makes the work invisible at exactly the
// moment you are asking for it. Here the transcript keeps streaming above the
// dock while the conversation runs, so an escalated task is visible landing.
//
// WHAT CARRIED OVER, deliberately: the VOICE_LABEL / VOICE_COPY vocabulary (a
// loop state and a dictation state read as the same kind of object), the orb
// whose glyph encodes state, the level-driven box-shadow computed inline (zero
// keyframes), and the interim line showing words as they are spoken.
//
// 🔴 THE ORB IS THE PAUSE CONTROL. The sheet's own copy said "⌘D pauses the
// mic" — a keyboard shortcut as the entire control surface for pause, which on
// a phone means pause does not exist. ⌘D still works; it is no longer the only
// way in.

function orbGlyph(state: VoiceState): string {
  switch (state.s) {
    case 'SPEAKING': return '◼'   // stop talking = skip
    case 'PAUSED': return '▶'
    case 'ERROR': return state.retryable ? '↻' : '!'
    case 'ARMING': return '···'
    default: return '⦿'
  }
}

/** What tapping the orb does right now, in the words of the thing it does. */
function orbHint(state: VoiceState): string {
  switch (state.s) {
    case 'SPEAKING': return 'tap to skip'
    case 'LISTENING': return 'tap to pause'
    case 'PAUSED': return 'tap to pick it back up'
    case 'ERROR': return state.retryable ? 'tap to try again' : ''
    // True since the pre-session buffer landed: audio is taped from the mic
    // grant and replayed the moment the channel opens, so speaking during
    // ARMING is no longer speaking into a void.
    case 'ARMING': return 'connecting — keep talking, nothing is lost'
    default: return ''
  }
}

// VOICE_COPY is shared with the DICTATION path, and two of its lines describe a
// remedy that does not exist in a live conversation: 'no-key-broker' promises a
// fallback "to on-device dictation" (there is none here — the loop is the
// broker or nothing), and both network lines call this "dictation". Same
// vocabulary, corrected remedy; everything else falls through to VOICE_COPY.
const LIVE_COPY: Partial<Record<VoiceErrorReason, string>> = {
  'no-key-broker': 'Could not start a session. Check the connection and try again.',
  'stt-network': 'Lost the connection to the voice session.',
  'stt-upstream': 'The voice session failed upstream. Try again in a moment.',
}

function errCopy(state: Extract<VoiceState, { s: 'ERROR' }>): string {
  return LIVE_COPY[state.reason] ?? VOICE_COPY[state.reason]
}

function orbLabel(state: VoiceState): string {
  switch (state.s) {
    case 'SPEAKING': return 'Skip the reply'
    case 'LISTENING': return 'Pause the microphone'
    case 'PAUSED': return 'Resume the microphone'
    case 'ERROR': return 'Retry'
    default: return 'Live conversation'
  }
}

/**
 * What the session has cost so far. Sub-cent spends read as "<1c" rather than
 * "$0.00" — a rounded zero is the one number that would teach him the wrong
 * thing about a per-minute lane.
 */
function money(usd: number): string {
  if (usd <= 0) return ''
  if (usd < 0.01) return '<1c'
  return `$${usd.toFixed(2)}`
}

export function VoiceDock({ state, level, interim, last, turns, cost, busyWork, onEnd, onSkip, onPause, onResume }: {
  state: VoiceState
  level: number
  interim: string
  last: LiveExchange | null
  turns: number
  /** USD spent on this session so far — phase 6, the lane bills per minute. */
  cost: number
  /** True while an escalated task is running in the transcript above. */
  busyWork: boolean
  onEnd: () => void
  onSkip: () => void
  onPause: () => void
  onResume: () => void
}) {
  const live = state.s === 'LISTENING'
  const tapOrb = () => {
    if (state.s === 'SPEAKING') return onSkip()
    if (state.s === 'LISTENING') return onPause()
    if (state.s === 'PAUSED') return onResume()
    if (state.s === 'ERROR' && state.retryable) return onResume()
  }

  // The tape: what he just said, what it said back, and the words currently
  // arriving. Clamped rather than growing — the transcript above is the record,
  // this is only the last beat.
  const showTape = !!(interim || last?.heard || last?.reply)

  return (
    <div className="vd" role="region" aria-label="Live conversation">
      {busyWork && (
        <div className="vd-work">
          <span className="vd-work-dot" />
          working above — keep talking
        </div>
      )}

      {showTape && (
        <div className="vd-tape">
          {last?.heard && <div className="vd-heard">“{last.heard}”</div>}
          {last?.reply && <div className="vd-reply">{last.reply}</div>}
          {interim && <div className="vd-interim">{interim}</div>}
        </div>
      )}

      <div className="vd-row">
        <button
          type="button"
          className={`vd-orb${live ? ' live' : ''}${state.s === 'SPEAKING' ? ' talking' : ''}${state.s === 'ERROR' ? ' err' : ''}`}
          // Inline, recomputed per frame from the mic level: the ring is the
          // honest answer to "is it hearing me", and it costs no keyframes.
          style={live
            // Spread is capped at 11px because the dock's own padding is 12px:
            // a bigger ring gets CLIPPED by the pane edge, which reads as a
            // rendering bug rather than a level meter (seen at 390 first pass).
            ? { boxShadow: `0 0 0 ${3 + level * 8}px rgba(16,163,127,${0.07 + level * 0.13})` }
            : undefined}
          onClick={tapOrb}
          aria-label={orbLabel(state)}
        >
          {orbGlyph(state)}
        </button>

        <div className="vd-txt">
          <div className="vd-state">
            {VOICE_LABEL[state.s]}
            {turns > 0 && <span className="vd-turns">{turns} turn{turns === 1 ? '' : 's'}</span>}
            {money(cost) && <span className="vd-cost" title="Estimated spend on this voice session">{money(cost)}</span>}
          </div>
          <div className={`vd-hint${state.s === 'ERROR' ? ' err' : ''}`}>
            {state.s === 'ERROR' ? errCopy(state) : orbHint(state)}
          </div>
        </div>

        <button type="button" className="vd-end" onClick={onEnd}>End</button>
      </div>
    </div>
  )
}
