// The draft on the tape (mock `.tape`), its email leg (`.df-leg`, Send both), the mirror email
// rider, and the warnings today's card carries (held, email check failed, you already replied).
// Edit turns the tape into the editor; the keys below save or send what is in it.
import { useEffect, useRef, useState } from 'react'
import { emailRowSender, emailSenderLabel, eventTime, holdReason, isFollowUp, messageChannel, type Thread } from '../../lib/inbox'
import { DIcon } from '../ui/icons'
import { Linkified } from '../ui/Linkified'
import { Explain } from './Explain'
import { ago } from './model'
import { dayMonth } from './threadRows'
import type { Edits } from './verbs'

const SCAN_DELIVERY_MODEL = 'rise_dm2_scan_delivery_v1'

export function paras(text: string): string[] {
  return text.split(/^[ \t]*-{3,}[ \t\r]*$|\n\n+/m).map(s => s.trim()).filter(Boolean)
}

function legPipe(t: Thread): string {
  const c = t.companionDraft ? messageChannel(t.companionDraft) : null
  return c === 'email' ? ' + email' : c === 'inmail' ? ' + InMail' : c ? ' + DM' : ''
}

function Grow({ value, onChange, label }: { value: string; onChange: (s: string) => void; label: string }) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 420)}px`
  }, [value])
  return <textarea ref={ref} className="dm-edit" aria-label={label} value={value} onChange={e => onChange(e.target.value)} />
}

export function Draft({ t, edits, setEdits, editing, now, onRetry }: {
  t: Thread; edits: Edits; setEdits: (e: Edits) => void; editing: boolean; now: number; onRetry: () => void
}) {
  const draft = t.draft
  const [showEmail, setShowEmail] = useState(false)
  if (!draft) return null
  const comp = t.companionDraft
  const title = t.draftSnoozedUntil ? `Pushed to ${dayMonth(t.draftSnoozedUntil)}`
    : t.draftStale ? 'AI draft · you already replied'
      : isFollowUp(draft) ? 'AI follow-up · waiting on you' : 'AI draft · waiting on you'
  const email = messageChannel(draft) === 'email'
  const rider = draft.recipient_email && !email && (draft.email_mirror_text || draft.ai_model === SCAN_DELIVERY_MODEL)
  const hold = holdReason(draft)
  return (
    <>
      {t.draftStale && <div className="dm-ban dm-ban-warn"><b><DIcon name="alert" />You already replied after their last message.</b><p>This draft is probably not needed.</p></div>}
      {hold && <div className="dm-ban dm-ban-warn"><b><DIcon name="alert" />{hold}</b></div>}
      {draft.email_stamp_unavailable && <div className="dm-ban dm-ban-warn"><b><DIcon name="alert" />Could not check whether this draft also sends an email.</b><p>Refresh before you approve.</p></div>}
      <div className={`dm-tape${editing ? ' dm-tape-edit' : ''}`}>
        <div className="dm-tm"><span>{title}{legPipe(t)}</span><span>written {ago(eventTime(draft), now)} ago</span></div>
        {email && draft.recipient_email && <p className="dm-meta">Email to {draft.recipient_email} (from {emailRowSender(t.client_id)})</p>}
        {editing
          ? <Grow value={edits.main} onChange={main => setEdits({ ...edits, main })} label="The draft" />
          : paras(edits.main).map((p, i) => <p key={i}><Linkified text={p} /></p>)}
      </div>
      {comp && (
        <div className="dm-leg">
          <div className="dm-tm">
            <span>{messageChannel(comp) === 'email' ? `Email leg${comp.recipient_email ? ` · to ${comp.recipient_email}` : ''}` : 'LinkedIn DM leg'}</span>
            <span>{messageChannel(comp) === 'email' ? `from ${emailRowSender(t.client_id)}` : 'rides with the draft'}</span>
          </div>
          {editing
            ? <Grow value={edits.companion ?? ''} onChange={companion => setEdits({ ...edits, companion })} label="The other leg" />
            : <p><Linkified text={edits.companion ?? ''} /></p>}
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
            {draft.email_mirror_text && <button type="button" className="dm-linkbtn" onClick={() => setShowEmail(v => !v)}>{showEmail || editing ? 'Hide email' : 'Show email'}</button>}
          </div>
          {draft.email_mirror_text && (editing
            ? <Grow value={edits.email ?? ''} onChange={e => setEdits({ ...edits, email: e })} label="The email that goes with it" />
            : showEmail && <p><Linkified text={edits.email ?? ''} /></p>)}
          {draft.email_mirror_text && (showEmail || editing) && (
            <Explain inset messageId={`${draft.id}:email`} messageText={draft.email_mirror_text} editedText={edits.email ?? draft.email_mirror_text}
              evidence={draft.draft_evidence?.email} unavailable={draft.draft_evidence_unavailable} onRetry={onRetry} />
          )}
        </div>
      )}
    </>
  )
}
