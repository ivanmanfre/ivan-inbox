import { parseEmailCc } from '../../lib/emailCc'
// The draft on the tape (mock `.tape`), its email leg (`.df-leg`, Send both), the mirror email
// rider, and the warnings today's card carries (held, email check failed, you already replied).
// The tape IS the editor: typing saves (useAutosave); Send sends what is in it.
import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react'
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

function Grow({ value, onChange, label, onBlur, max = 240, onKeyDown }: { value: string; onChange: (s: string) => void; label: string; onBlur?: () => void; max?: number; onKeyDown?: (e: KeyboardEvent<HTMLTextAreaElement>) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight + 2, max)}px`
  }, [value, max])
  return <textarea ref={ref} className="dm-edit" data-autosave aria-label={label} value={value} rows={2} spellCheck onBlur={onBlur} onChange={e => onChange(e.target.value)} onKeyDown={onKeyDown} />
}

function Cc({ value, onChange, onBlur, label = 'CC recipients' }: { value: string; onChange: (value: string) => void; onBlur: () => void; label?: string }) {
  let error = ''
  try { parseEmailCc(value) } catch (e) { error = (e as Error).message }
  return <div className="dm-email-cc"><label>CC <input aria-label={label} aria-invalid={!!error} type="text" inputMode="email" autoComplete="off" value={value} placeholder="Add CC email addresses" onChange={e => onChange(e.target.value)} onBlur={onBlur} /></label>{error && <p role="alert">{error}</p>}</div>
}

const SAVE_WORD: Record<SaveState, string> = { idle: '', saving: 'Saving…', saved: 'Saved', failed: 'Not saved' }

/** The draft is the last bubble of the conversation, on our side, and it IS the editor (Ivan 09-27:
 *  "I want the direct editing capabilities"): type in it, it saves itself (useAutosave). Its email
 *  leg and the mirror email edit the same way. */
export function Draft({ t, edits, setEdits, save, onBlur, onRetrySave, now, onRetry, v4 = false, strips, foot, onSend }: {
  t: Thread; edits: Edits; setEdits: (e: Edits) => void; save: SaveState; onBlur: () => void; onRetrySave: () => void; now: number; onRetry: () => void
  /** Brief 4: one card, the editor (SPEC-dms §2.4.5): caveats attached as strips, Why in the foot. */
  v4?: boolean; strips?: ReactNode; foot?: ReactNode
  /** Brief 4: ⌘↩ in the draft runs the SAME send (its confirm always opens first). */
  onSend?: () => void
}) {
  const draft = t.draft
  if (!draft) return null
  const comp = t.companionDraft
  const title = t.draftSnoozedUntil ? `Later: back ${dayMonth(t.draftSnoozedUntil)}`
    : t.draftStale ? 'AI draft · you already replied'
      : isFollowUp(draft) ? 'AI follow-up' : 'AI draft'
  const email = messageChannel(draft) === 'email'
  const rider = draft.recipient_email && !email && (draft.email_mirror_text || draft.ai_model === SCAN_DELIVERY_MODEL)
  const hold = holdReason(draft)
  if (v4) {
    const sendKey = onSend ? (e: KeyboardEvent<HTMLTextAreaElement>) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); onSend() } } : undefined
    const caveats = t.draftStale || hold || draft.email_stamp_unavailable || strips
    return (
      <div className={`dx-card${t.draftStale ? ' dx-card-stale' : ''}`}>
        <div className="dx-card-h">
          <span className="dx-card-t"><b className="dm-b-dl">Draft</b> {title}{legPipe(t)} · {ago(eventTime(draft), now)} ago</span>
          <span className="dx-card-pen" aria-hidden="true">✎</span>
          <span key={save} className={`dm-save dm-save-${save}`} role="status" aria-live="polite">
            {SAVE_WORD[save]}{save === 'failed' && <> · <button type="button" className="dm-linkbtn" data-verb="autosave-retry" onClick={onRetrySave}>Retry</button></>}
          </span>
        </div>
        {caveats && <div className="dx-strips">
          {t.draftStale && <div className="dm-ban dm-ban-warn"><b><DIcon name="alert" />You already replied after their last message.</b><p>This draft is probably not needed.</p></div>}
          {hold && <div className="dm-ban dm-ban-warn"><b><DIcon name="alert" />{hold}</b></div>}
          {draft.email_stamp_unavailable && <div className="dm-ban dm-ban-warn"><b><DIcon name="alert" />Could not check whether this draft also sends an email.</b><p>Refresh before you approve.</p></div>}
          {strips}
        </div>}
        <div className="dm-b-draft dm-tape dx-card-b" data-draft={draft.id}
          onClick={e => { if (!(e.target as HTMLElement).closest('textarea,input,button,a')) e.currentTarget.querySelector<HTMLTextAreaElement>('textarea.dm-edit')?.focus() }}>
          {email && draft.recipient_email && <p className="dm-meta">Email to {draft.recipient_email} (from {emailRowSender(t.client_id)})</p>}
          {email && draft.recipient_email && <Cc value={edits.cc ?? ''} onChange={cc => setEdits({ ...edits, cc })} onBlur={onBlur} />}
          <Grow value={edits.main} onChange={main => setEdits({ ...edits, main })} onBlur={onBlur} label="The draft" onKeyDown={sendKey} />
        </div>
        {comp && (
          <div className="dm-leg dx-leg">
            <div className="dm-tm">
              <span>{messageChannel(comp) === 'email' ? `Email leg${comp.recipient_email ? ` · to ${comp.recipient_email}` : ''}` : 'LinkedIn DM leg'}</span>
              <span>{messageChannel(comp) === 'email' ? `from ${emailRowSender(t.client_id)}` : 'rides with the draft'}</span>
            </div>
            {messageChannel(comp) === 'email' && comp.recipient_email && <Cc value={edits.companionCc ?? ''} onChange={companionCc => setEdits({ ...edits, companionCc })} onBlur={onBlur} label="Email leg CC recipients" />}
            <Grow value={edits.companion ?? ''} onChange={companion => setEdits({ ...edits, companion })} onBlur={onBlur} label="The other leg" max={360} onKeyDown={sendKey} />
            <Explain inset v4 messageId={comp.id} messageText={comp.message_text} editedText={edits.companion ?? comp.message_text}
              evidence={comp.draft_evidence} unavailable={comp.draft_evidence_unavailable} onRetry={onRetry} />
          </div>
        )}
        {rider && (
          <div className="dm-leg dm-leg-rider dx-leg">
            <b className="dm-email-title">Email draft</b>
            <p className="dm-email-envelope">To: {draft.recipient_email} · From: {emailRowSender(t.client_id)}</p>
            <div className="dm-tm">
              <span>{draft.email_mirror_text && !emailSenderLabel(t.client_id)
                ? `This email does not send from your seat, only the DM goes. Copy it into Gmail to ${draft.recipient_email} if you want it sent.`
                : draft.email_mirror_text ? `Approving also sends this email to ${draft.recipient_email}${emailSenderLabel(t.client_id)}`
                  : `Approving also emails the scan link to ${draft.recipient_email}${emailSenderLabel(t.client_id)}. The sender writes that email itself.`}</span>
            </div>
            <Cc value={edits.cc ?? ''} onChange={cc => setEdits({ ...edits, cc })} onBlur={onBlur} />
            {draft.email_mirror_text && <>
              <Grow value={edits.email ?? ''} onChange={e => setEdits({ ...edits, email: e })} onBlur={onBlur} label="The email that goes with it" max={360} onKeyDown={sendKey} />
              <Explain inset v4 messageId={`${draft.id}:email`} messageText={draft.email_mirror_text} editedText={edits.email ?? draft.email_mirror_text}
                evidence={draft.draft_evidence?.email} unavailable={draft.draft_evidence_unavailable} onRetry={onRetry} />
            </>}
          </div>
        )}
        {foot != null && <div className="dx-card-f">{foot}</div>}
      </div>
    )
  }
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
        {email && draft.recipient_email && <Cc value={edits.cc ?? ''} onChange={cc => setEdits({ ...edits, cc })} onBlur={onBlur} />}
        <Grow value={edits.main} onChange={main => setEdits({ ...edits, main })} onBlur={onBlur} label="The draft" />
      </div>
      {comp && (
        <div className="dm-leg">
          <div className="dm-tm">
            <span>{messageChannel(comp) === 'email' ? `Email leg${comp.recipient_email ? ` · to ${comp.recipient_email}` : ''}` : 'LinkedIn DM leg'}</span>
            <span>{messageChannel(comp) === 'email' ? `from ${emailRowSender(t.client_id)}` : 'rides with the draft'}</span>
          </div>
          {messageChannel(comp) === 'email' && comp.recipient_email && <Cc value={edits.companionCc ?? ''} onChange={companionCc => setEdits({ ...edits, companionCc })} onBlur={onBlur} label="Email leg CC recipients" />}
          <Grow value={edits.companion ?? ''} onChange={companion => setEdits({ ...edits, companion })} onBlur={onBlur} label="The other leg" max={360} />
          <Explain inset messageId={comp.id} messageText={comp.message_text} editedText={edits.companion ?? comp.message_text}
            evidence={comp.draft_evidence} unavailable={comp.draft_evidence_unavailable} onRetry={onRetry} />
        </div>
      )}
      {rider && (
        <div className="dm-leg dm-leg-rider">
          <b className="dm-email-title">Email draft</b>
          <p className="dm-email-envelope">To: {draft.recipient_email} · From: {emailRowSender(t.client_id)}</p>
          <div className="dm-tm">
            <span>{draft.email_mirror_text && !emailSenderLabel(t.client_id)
              ? `This email does not send from your seat, only the DM goes. Copy it into Gmail to ${draft.recipient_email} if you want it sent.`
              : draft.email_mirror_text ? `Approving also sends this email to ${draft.recipient_email}${emailSenderLabel(t.client_id)}`
                : `Approving also emails the scan link to ${draft.recipient_email}${emailSenderLabel(t.client_id)}. The sender writes that email itself.`}</span>
          </div>
          <Cc value={edits.cc ?? ''} onChange={cc => setEdits({ ...edits, cc })} onBlur={onBlur} />
          {draft.email_mirror_text && <>
            <Grow value={edits.email ?? ''} onChange={e => setEdits({ ...edits, email: e })} onBlur={onBlur} label="The email that goes with it" max={360} />
            <Explain inset messageId={`${draft.id}:email`} messageText={draft.email_mirror_text} editedText={edits.email ?? draft.email_mirror_text}
              evidence={draft.draft_evidence?.email} unavailable={draft.draft_evidence_unavailable} onRetry={onRetry} />
          </>}
        </div>
      )}
    </>
  )
}
