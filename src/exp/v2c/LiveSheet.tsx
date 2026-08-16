import { VOICE_COPY, VOICE_LABEL, type VoiceState } from './chat/voice'
import type { LiveExchange } from './chat/useLive'

// 🔴 RETIRED 2026-08-16 — superseded by VoiceDock.tsx, and NOT mounted anywhere.
// It is kept because it is the spec of what the dock had to carry over
// (VOICE_LABEL/VOICE_COPY, the state-encoding orb, the level-driven shadow, the
// interim line). Do not wire it back: the takeover it implements is the exact
// complaint the dock exists to answer.
//
// The LIVE CONVERSATION takeover. Reuses the app's existing .sheet-scrim /
// .sheet-card grammar (the same choice HandsFreeSheet made) so it inherits
// the sheet keyframes instead of adding new ones, and the existing
// VOICE_LABEL / VOICE_COPY vocabulary so a loop state and a dictation state
// read as the same kind of object. Exit is always one tap (Done, or the
// scrim), on desktop and mobile widths alike.

function orbGlyph(s: VoiceState['s']): string {
  if (s === 'SPEAKING') return '◼'
  if (s === 'ERROR') return '!'
  return '⦿'
}

export function LiveSheet({ state, level, interim, last, turns, busyWork, onClose, onSkip, onResume }: {
  state: VoiceState
  level: number
  interim: string
  last: LiveExchange | null
  turns: number
  /** True while an escalated task is running in the chat pane. */
  busyWork: boolean
  onClose: () => void
  onSkip: () => void
  onResume: () => void
}) {
  const live = state.s === 'LISTENING'
  const tapOrb = () => {
    if (state.s === 'SPEAKING') return onSkip()
    if (state.s === 'PAUSED') return onResume()
    if (state.s === 'ERROR' && state.retryable) return onResume()
  }
  return (
    <div className="sheet-scrim wb-live-scrim" onClick={onClose}>
      <div className="sheet" onClick={e => e.stopPropagation()}>
        <div className="sheet-card wb-live-card">
          <div className="wb-live-ttl">Live</div>
          <div className="wb-live-sub">
            Talk, listen, talk again. Real work gets sent to the workbench and
            summarized back to you. ⌘D pauses the mic.
          </div>
          <button
            type="button"
            className={`wb-live-orb${live ? ' live' : ''}${state.s === 'ERROR' ? ' err' : ''}`}
            style={live
              ? { boxShadow: `0 0 0 ${6 + level * 26}px rgba(16,163,127,${0.08 + level * 0.14})` }
              : undefined}
            onClick={tapOrb}
          >
            {orbGlyph(state.s)}
          </button>
          <div className="wb-live-state">
            {VOICE_LABEL[state.s]}
            {state.s === 'PAUSED' && ' — tap the orb to keep going'}
            {state.s === 'SPEAKING' && ' — tap to skip'}
          </div>
          {state.s === 'ERROR' && <div className="wb-live-err">{VOICE_COPY[state.reason]}</div>}
          {/* The words as he speaks them — same interim register as the composer. */}
          {interim && <div className="wb-live-interim">{interim}</div>}
          {last && (
            <div className="wb-live-last">
              <div className="wb-live-heard">“{last.heard}”</div>
              <div className="wb-live-reply">{last.reply}</div>
            </div>
          )}
          {busyWork && (
            <div className="wb-live-work">
              <span className="wb-live-work-dot" /> working in the chat pane — keep talking
            </div>
          )}
          {turns > 0 && <div className="wb-live-turns">{turns} turn{turns === 1 ? '' : 's'}</div>}
        </div>
        <button className="sheet-btn cancel" onClick={onClose}>Done</button>
      </div>
    </div>
  )
}
