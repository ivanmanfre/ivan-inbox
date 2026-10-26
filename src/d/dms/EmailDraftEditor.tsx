import { useState, type KeyboardEvent } from 'react'
import { parseEmailCc } from '../../lib/emailCc'
import { emailPreview, splitEmailForSend } from '../../lib/emailPresentation'
import { emailDraftText } from '../../lib/emailSubject'
import { EmailPreview } from './EmailMessage'
import './email.css'

export function EmailCcField({ value, onChange, onBlur, label = 'CC recipients' }: { value: string; onChange: (value: string) => void; onBlur: () => void; label?: string }) {
  let error = ''
  try { parseEmailCc(value) } catch (caught) { error = (caught as Error).message }
  return <>
    <label className="dm-email-field"><span className="dm-email-field-name">Cc</span><input aria-label={label} aria-invalid={!!error} inputMode="email" autoComplete="off" value={value} placeholder="Add CC email addresses" onChange={event => onChange(event.target.value)} onBlur={onBlur} /></label>
    {error && <p className="dm-email-error" role="alert">{error}</p>}
  </>
}

export function EmailDraftEditor({ value, onChange, label, subjectLabel = 'Email subject', subject: fallbackSubject, from, to, cc, onCcChange, ccLabel = 'CC recipients', onBlur, onKeyDown, transport = 'native' }: {
  value: string; onChange: (text: string) => void; label: string; subjectLabel?: string; subject?: string | null
  from: string; to: string | null; cc: string; onCcChange: (cc: string) => void; ccLabel?: string
  onBlur: () => void; onKeyDown?: (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => void
  transport?: 'native' | 'mirror'
}) {
  const [preview, setPreview] = useState(false)
  const split = splitEmailForSend(value, { subject: fallbackSubject, transport })
  const subject = split.subject
  let ccError = '', recipients: string[] = []
  try { recipients = parseEmailCc(cc) } catch (error) { ccError = (error as Error).message }
  const details = { ...emailPreview(value, { subject, from, to: to ? [to] : [], cc: recipients, transport }), subject }
  return <div className="dm-email-editor">
    <div className="dm-email-toolbar"><span>Email draft</span><button type="button" aria-pressed={preview} onClick={() => { onBlur(); setPreview(!preview) }}>{preview ? 'Edit' : 'Preview'}</button></div>
    {preview ? <EmailPreview details={details} state="Draft" /> : <div className="dm-email-sheet">
      <div className="dm-email-edit-fields">
        <div className="dm-email-field"><span className="dm-email-field-name">From</span><span>{from}</span></div>
        <div className="dm-email-field"><span className="dm-email-field-name">To</span><span>{to || 'Recipient unavailable'}</span></div>
        <EmailCcField value={cc} onChange={onCcChange} onBlur={onBlur} label={ccLabel} />
        <label className="dm-email-field dm-email-subject-field"><span className="dm-email-field-name">Subject</span><input aria-label={subjectLabel} autoComplete="off" data-autosave value={subject} placeholder="Add an email subject" onChange={event => onChange(emailDraftText(event.target.value, split.body))} onBlur={onBlur} onKeyDown={onKeyDown} /></label>
      </div>
      <textarea className="dm-email-textarea" aria-label={label} data-autosave value={split.body} rows={7} spellCheck onChange={event => onChange(emailDraftText(subject, event.target.value))} onBlur={onBlur} onKeyDown={onKeyDown} />
    </div>}
    {preview && ccError && <p className="dm-email-error" role="alert">{ccError}</p>}
  </div>
}
