import { isDeep, toggleDeep, type Subject } from '../../exp/v2c/chat/paneContext'
import { clearClaudeHandoff } from '../ui/claudeHandoff'
import { useClaude } from './ClaudeProvider'
import { CIcon } from './icons'
import { chipLabel, subjectMeta } from './model'

// What rides with the next message: the person the DMs page handed over, as
// ONE chip with an always-visible remove, and one switch between names only
// (the default) and the whole conversation. Nothing is sent by attaching.

export function Context({ subject }: { subject: Subject | null }) {
  const { see, setSee } = useClaude()
  if (!subject) return null
  const m = subjectMeta(subject)
  const deep = isDeep(see, subject.key)
  return (
    <div className="dcl-ctx" data-subject={subject.key}>
      <span className="dcl-chip">
        <span className="dcl-chip-t">{chipLabel(m)}</span>
        <button type="button" data-verb="remove-subject" aria-label={`Remove ${m.name}, Claude stops seeing this conversation`} onClick={() => { setSee({ off: [], deep: [] }); clearClaudeHandoff() }}>
          <CIcon name="x" />
        </button>
      </span>
      {subject.full && (
        <button type="button" className={`dcl-seg${deep ? ' dcl-on' : ''}`} data-verb="attach-full" aria-pressed={deep}
          onClick={() => setSee(toggleDeep(see, subject.key))}>
          {deep ? `Whole conversation (${subject.bodies ?? 0})` : 'Names only'}
        </button>
      )}
    </div>
  )
}
