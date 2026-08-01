import { micIsLive, unlockAudio, VOICE_COPY, VOICE_LABEL, voiceSeverity, type VoiceState } from './chat/voice'

// The voice affordance. Real UI, real state machine, mock capture.
//
// Craft notes that are load-bearing rather than decorative:
//  * The pulse is an inline box-shadow recomputed from the mic level, NOT a
//    keyframe — the app has six keyframes and this adds zero.
//  * The level meter is the visual encoding on this surface: eight bars driven by
//    the same level value, so "is it hearing me" is answered without words.
//  * The button is user-select:none and a dedicated hit target, because a hold
//    gesture over selectable text gets eaten by iOS Safari's long-press menu.
//  * unlockAudio() belongs in the pointerdown handler synchronously, before any
//    await — marked at the call site so a later edit cannot quietly move it.

function Meter({ level, on }: { level: number; on: boolean }) {
  const bars = 8
  return (
    <span className="wb-meter" aria-hidden>
      {Array.from({ length: bars }).map((_, i) => {
        const threshold = (i + 1) / bars
        const lit = on && level >= threshold * 0.82
        return (
          <span
            key={i}
            className={`wb-meter-b${lit ? ' lit' : ''}`}
            style={{ height: `${5 + i * 1.7}px` }}
          />
        )
      })}
    </span>
  )
}

export function VoiceControl({ state, onArm, onCancel, onResume, onSkip, onDismiss, onHandsFree, handsFree }: {
  state: VoiceState
  onArm: () => void
  onCancel: () => void
  onResume: () => void
  onSkip: () => void
  onDismiss: () => void
  onHandsFree: () => void
  handsFree: boolean
}) {
  const live = micIsLive(state)
  const level = state.s === 'LISTENING' ? state.level : 0
  const busy = state.s !== 'IDLE' && state.s !== 'ERROR'

  const tap = () => {
    if (state.s === 'IDLE') return onArm()
    if (state.s === 'PAUSED') return onResume()
    if (state.s === 'SPEAKING') return onSkip()
    if (state.s === 'ERROR') return state.retryable ? onResume() : onDismiss()
    return onCancel()
  }

  return (
    <button
      type="button"
      className={`wb-mic${live ? ' live' : ''}${busy ? ' busy' : ''}${state.s === 'ERROR' ? ' err' : ''}`}
      style={live ? { boxShadow: `0 0 0 ${2 + level * 9}px rgba(16,163,127,${0.1 + level * 0.16})` } : undefined}
      // iOS drops a speechSynthesis utterance that was not primed inside a real
      // gesture, and the prime must run SYNCHRONOUSLY — after an await the gesture
      // is already spent. pointerdown, before any state transition, is the only
      // place this works, which is why it is not inside the state machine.
      onPointerDown={unlockAudio}
      onClick={tap}
      onContextMenu={e => { e.preventDefault(); onHandsFree() }}
      aria-label={live ? 'Listening — tap to stop' : VOICE_LABEL[state.s]}
      title={handsFree ? 'Hands-free is on' : 'Tap to talk · long-press for hands-free'}
    >
      {/* Geometric glyph, not an emoji: every icon in this app is one
          (TabBar.tsx:9-30), and a colour emoji beside ☼ ◉ ✦ ↑ ◈ reads as a
          different icon set. */}
      {state.s === 'ERROR' ? '!' : state.s === 'SPEAKING' ? '◼' : '⦿'}
      {live && <Meter level={level} on />}
    </button>
  )
}

// The state strip above the composer. One line, one state, one remedy — this is
// where the audit's "distinct, actionable failure copy" table actually lands.
export function VoiceStrip({ state, onDismiss, onResume, onHandsFree, handsFree }: {
  state: VoiceState
  onDismiss: () => void
  onResume: () => void
  onHandsFree: () => void
  handsFree: boolean
}) {
  if (state.s === 'IDLE') return null
  if (state.s === 'ERROR') {
    const sev = voiceSeverity(state.reason)
    return (
      <div className={`wb-vstrip ${sev}`}>
        <span className="wb-vs-dot" />
        <span className="wb-vs-t">{VOICE_COPY[state.reason]}</span>
        {state.retryable
          ? <button className="wb-retry" onClick={onResume}>Try again</button>
          : <button className="wb-retry ghost" onClick={onDismiss}>Dismiss</button>}
      </div>
    )
  }
  const level = state.s === 'LISTENING' ? state.level : 0
  return (
    <div className={`wb-vstrip live s-${state.s.toLowerCase()}`}>
      <Meter level={level} on={state.s === 'LISTENING'} />
      <span className="wb-vs-t">
        {VOICE_LABEL[state.s]}
        {state.s === 'PAUSED' && ' — didn’t catch anything, tap the mic to try again'}
        {state.s === 'SPEAKING' && ' — tap to skip'}
      </span>
      <button className={`wb-hf${handsFree ? ' on' : ''}`} onClick={onHandsFree}>
        {handsFree ? 'Hands-free on' : 'Hands-free'}
      </button>
    </div>
  )
}

// Hands-free takeover. Reuses the app's existing .sheet-scrim / .sheet-card
// language rather than the reference's bespoke full-bleed blur, so it inherits
// the four sheet keyframes instead of adding a seventh.
export function HandsFreeSheet({ state, onClose, onArm, onSkip }: {
  state: VoiceState
  onClose: () => void
  onArm: () => void
  onSkip: () => void
}) {
  const level = state.s === 'LISTENING' ? state.level : 0
  return (
    <div className="sheet-scrim wb-hf-scrim" onClick={onClose}>
      <div className="sheet" onClick={e => e.stopPropagation()}>
        <div className="sheet-card wb-hf-card">
          <div className="wb-hf-ttl">Hands-free</div>
          <div className="wb-hf-sub">
            Ask, listen, ask again. The mic is never open while Claude is speaking.
          </div>
          <button
            type="button"
            className={`wb-hf-orb${micIsLive(state) ? ' live' : ''}`}
            style={micIsLive(state)
              ? { boxShadow: `0 0 0 ${6 + level * 26}px rgba(16,163,127,${0.08 + level * 0.14})` }
              : undefined}
            onClick={state.s === 'SPEAKING' ? onSkip : onArm}
          >
            {state.s === 'SPEAKING' ? '◼' : '⦿'}
          </button>
          <div className="wb-hf-state">{VOICE_LABEL[state.s]}</div>
          {state.s === 'ERROR' && <div className="wb-hf-err">{VOICE_COPY[state.reason]}</div>}
          <Meter level={level} on={micIsLive(state)} />
        </div>
        <button className="sheet-btn cancel" onClick={onClose}>Done</button>
      </div>
    </div>
  )
}
