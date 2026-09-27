import { useState } from 'react'
import { buildSeeBlock, isDeep, isOff, offAll, onAll, toggleDeep, toggleOff, type Subject } from '../../exp/v2c/chat/paneContext'
import { useClaude } from './ClaudeProvider'
import { CIcon } from './icons'
import { chipLabel, subjectMeta } from './model'

// What rides with the next message (today's See strip, wb/ask/See.tsx): one
// chip per thing on screen, each with an always-visible × that detaches it and
// an "Attach" that brings it back; one switch between names only and the full
// text for the first subject that has text; and "What travels", which prints
// the exact block the next send carries. One line: it scrolls, never wraps.

export function subjectWords(s: Subject): string {
  return s.kind === 'thread' ? chipLabel(subjectMeta(s)) : s.label
}

export function Context({ subjects }: { subjects: Subject[] }) {
  const { see, setSee } = useClaude()
  const [peek, setPeek] = useState(false)
  if (subjects.length === 0) return null
  const deepable = subjects.find(s => s.full && !isOff(see, s.key)) ?? null
  const deep = deepable ? isDeep(see, deepable.key) : false
  const block = buildSeeBlock(subjects, see)
  const allOff = subjects.every(s => isOff(see, s.key))
  return (
    <div className="dcl-ctxw">
      <div className="dcl-ctx">
        {subjects.map(s => isOff(see, s.key)
          ? (
            <button type="button" key={s.key} className="dcl-seg dcl-offchip" data-verb="attach-subject" onClick={() => setSee(toggleOff(see, s.key))}>
              Attach {s.label}
            </button>
          )
          : (
            <span key={s.key} className={`dcl-chip${s.kind === 'lane' ? ' dcl-chip-q' : ''}`} data-subject={s.key}>
              <span className="dcl-chip-t">{subjectWords(s)}{isDeep(see, s.key) && s.full ? ' · full text' : ''}</span>
              <button type="button" data-verb="remove-subject" aria-label={`Detach ${s.label}; Claude stops seeing it`} onClick={() => setSee(toggleOff(see, s.key))}>
                <CIcon name="x" />
              </button>
            </span>
          ))}
      </div>
      <div className="dcl-ctx-k">
        {deepable && (
          <button type="button" className={`dcl-link${deep ? ' dcl-on' : ''}`} data-verb="attach-full" aria-pressed={deep}
            onClick={() => setSee(toggleDeep(see, deepable.key))}>
            {deep ? 'Back to names only' : `Attach full text (${deepable.bodies ?? 0})`}
          </button>
        )}
        <button type="button" className="dcl-link" data-verb="peek" aria-expanded={peek} onClick={() => setPeek(p => !p)}>What travels</button>
      </div>
      {peek && (
        <div className="dcl-peek" role="dialog" aria-label="What travels with the next message">
          <pre>{block ?? 'Nothing is attached. Claude sees only what you type.'}</pre>
          <div className="dcl-peek-k">
            {allOff
              ? <button type="button" className="dcl-link" data-verb="attach-all" onClick={() => setSee(onAll(see, subjects))}>Attach again</button>
              : <button type="button" className="dcl-link" data-verb="detach-all" onClick={() => setSee(offAll(see, subjects))}>Detach all</button>}
            <button type="button" className="dcl-link" onClick={() => setPeek(false)}>Close</button>
          </div>
        </div>
      )}
    </div>
  )
}
