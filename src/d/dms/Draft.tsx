// The draft on the tape (mock `.tape`), its email leg (`.df-leg`, Send both), the mirror email
// rider, and the warnings today's card carries (held, email check failed, you already replied).
// The tape IS the editor: typing saves (useAutosave); Send sends what is in it.
import { useEffect, useRef, useState } from 'react'
import { emailRowSender, emailSenderLabel, eventTime, holdReason, isFollowUp, messageChannel, type Thread } from '../../lib/inbox'
import { DIcon } from '../ui/icons'
import { Explain } from './Explain'
import { ago } from './model'
import { dayMonth } from './threadRows'
import type { Edits } from './verbs'
import type { SaveState } from './useAutosave'

const SCAN_DELIVERY_MODEL = 'rise_dm2_scan_delivery_v1'

export function paras(text: string): string[] {
  return text.split(/^[ \t]*-{3,}[ \t\r]*$|\n\n+/m).map(s => s.trim()).filter(Boolean)
}

function legPipe(t: Thread): string {
  const c = t.companionDraft ? messageChannel(t.companionDraft) : null
  return c === 'email' ? ' + email' : c === 'inmail' ? ' + InMail' : c ? ' + DM' : ''
}

function Grow({ value, onChange, label, onBlur, max = 240 }: { value: string; onChange: (s: string) => void; label: string; onBlur?: () => void; max?: number }) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight + 2, max)}px`
  }, [value, max])
  return <textarea ref={ref} className="dm-edit" aria-label={label} value={value} rows={2} spellCheck onBlur={onBlur} onChange={e => onChange(e.target.value)} />
}

const SAVE_WORD: Record<SaveState, string> = { idle: '', saving: 'Saving…', saved: 'Saved', failed: 'Not saved' }

/** The draft is the last bubble of the conversation, on our side, and it IS the editor (Ivan 09-27:
 *  "I want the direct editing capabilities"): type in it, it saves itself (useAutosave). Its email
 *  leg and the mirror email edit the same way. */
export function Draft({ t, edits, setEdits, save, onBlur, onRetrySave, now, onRetry }: {
  t: Thread; edits: Edits; setEdits: (e: Edits) => void; save: SaveState; onBlur: () => void; onRetrySave: () => void; now: number; onRetry: () => void
}) {
  const draft = t.draft
  const [showEmail, setShowEmail] = useState(false)
  if (!draft) return null
  const comp = t.companionDraft
  const title = t.draftSnoozedUntil ? `Later: back ${dayMonth(t.draftSnoozedUntil)}`
    : t.draftStale ? 'AI draft · you already replied'
      : isFollowUp(draft) ? 'AI follow-up' : 'AI draft'
  const email = messageChannel(draft) === 'email'
  const rider = draft.recipient_email && !email && (draft.email_mirror_text || draft.ai_model === SCAN_DELIVERY_MODEL)
  const hold = holdReason(draft)
  return (
    <>
      {t.draftStale && <div className="dm-ban dm-ban-warn"><b><DIcon name="alert" />You already replied after their last message.</b><p>This draft is probably not needed.</p></div>}
      {hold && <div className="dm-ban dm-ban-warn"><b><DIcon name="alert" />{hold}</b></div>}
      {draft.email_stamp_unavailable && <div className="dm-ban dm-ban-warn"><b><DIcon name="alert" />Could not check whether this draft also sends an email.</b><p>Refresh before you approve.</p></div>}
      <div className="dm-b dm-b-out dm-b-draft dm-tape" data-draft={draft.id}>
        <div className="dm-tm">
          <span><b className="dm-b-dl">Draft</b> {title}{legPipe(t)} · {ago(eventTime(draft), now)} ago</span>
          <span className={`dm-save dm-save-${save}`} role="status" aria-live="polite">
            {SAVE_WORD[save]}{save === 'failed' && <> · <button type="button" className="dm-linkbtn" data-verb="autosave-retry" onClick={onRetrySave}>Retry</button></>}
          </span>
        </div>
        {email && draft.recipient_email && <p className="dm-meta">Email to {draft.recipient_email} (from {emailRowSender(t.client_id)})</p>}
        <Grow value={edits.main} onChange={main => setEdits({ ...edits, main })} onBlur={onBlur} label="The draft" />
      </div>
      {comp && (
        <div className="dm-leg">
          <div className="dm-tm">
            <span>{messageChannel(comp) === 'email' ? `Email leg${comp.recipient_email ? ` · to ${comp.recipient_email}` : ''}` : 'LinkedIn DM leg'}</span>
            <span>{messageChannel(comp) === 'email' ? `from ${emailRowSender(t.client_id)}` : 'rides with the draft'}</span>
          </div>
          <Grow value={edits.companion ?? ''} onChange={companion => setEdits({ ...edits, companion })} onBlur={onBlur} label="The other leg" max={360} />
          <Explain inset messageId={comp.id} messageText={comp.message_text} editedText={edits.companion ?? comp.message_text}
            evidence={comp.draft_evidence} unavailable={comp.draft_evidence_unavailable} onRetry={onRetry} />
        </div>
      )}
      {rider && (
        <div className="dm-leg dm-leg-rider">
          <div className="dm-tm">
            <span>{draft.email_mirror_text && !emailSenderLabel(t.client_id)
              ? `This email does not send from your seat, only the DM goes. Copy it into Gmail to ${draft.recipient_email} if you want it sent.`
              : draft.email_mirror_text ? `Approving also sends this email to ${draft.recipient_email}${emailSenderLabel(t.client_id)}`
                : `Approving also emails the scan link to ${draft.recipient_email}${emailSenderLabel(t.client_id)}. The sender writes that email itself.`}</span>
            {draft.email_mirror_text && <button type="button" className="dm-linkbtn" data-verb="show-email" onClick={() => setShowEmail(v => !v)}>{showEmail ? 'Hide email' : 'Show email'}</button>}
          </div>
          {draft.email_mirror_text && showEmail && <>
            <Grow value={edits.email ?? ''} onChange={e => setEdits({ ...edits, email: e })} onBlur={onBlur} label="The email that goes with it" max={360} />
            <Explain inset messageId={`${draft.id}:email`} messageText={draft.email_mirror_text} editedText={edits.email ?? draft.email_mirror_text}
              evidence={draft.draft_evidence?.email} unavailable={draft.draft_evidence_unavailable} onRetry={onRetry} />
          </>}
        </div>
      )}
    </>
  )
}
