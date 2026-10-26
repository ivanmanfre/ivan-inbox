import { useState, type KeyboardEvent } from 'react'
import { parseEmailCc } from '../../lib/emailCc'
import { emailPreview, splitEmailForSend } from '../../lib/emailPresentation'
import { buildEmailComposition } from '../../lib/emailCompositionDraft'
import { renderEmailComposition, renderEmailDocument, type EmailComposition, type EmailRichNode } from '../../lib/emailRichText'
import { emailDraftText, splitEmailDraft } from '../../lib/emailSubject'
import { EmailPreview } from './EmailMessage'
import { EmailSignature } from './EmailSignature'
import { RichEmailEditor } from './RichEmailEditor'
import './email.css'

export function EmailCcField({ value, onChange, onBlur, label = 'CC recipients', disabled = false }: { value: string; onChange: (value: string) => void; onBlur: () => void; label?: string; disabled?: boolean }) {
  let error = ''
  try { parseEmailCc(value) } catch (caught) { error = (caught as Error).message }
  return <>
    <label className="dm-email-field"><span className="dm-email-field-name">Cc</span><input aria-label={label} aria-invalid={!!error} inputMode="email" autoComplete="off" value={value} placeholder="Add CC email addresses" disabled={disabled} onChange={event => onChange(event.target.value)} onBlur={onBlur} /></label>
    {error && <p className="dm-email-error" role="alert">{error}</p>}
  </>
}

export function EmailDraftEditor({ value, onChange, label, subjectLabel = 'Email subject', subject: fallbackSubject, from, to, cc, onCcChange, ccLabel = 'CC recipients', onBlur, onKeyDown, transport = 'native', composition, onRichChange, disabled = false }: {
  value: string; onChange: (text: string) => void; label: string; subjectLabel?: string; subject?: string | null
  from: string; to: string | null; cc: string; onCcChange: (cc: string) => void; ccLabel?: string
  onBlur: () => void; onKeyDown?: (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => void
  transport?: 'native' | 'mirror'
  composition?: EmailComposition | null; onRichChange?: (text: string, composition: EmailComposition) => void
  disabled?: boolean
}) {
  const [preview, setPreview] = useState(false)
  // The send parser trims subject whitespace; the input must retain it between keystrokes.
  const directHeader = /^[ \t]*Subject:/i.test(value)
  const split = directHeader ? splitEmailDraft(value) : splitEmailForSend(value, { subject: fallbackSubject, transport })
  const subject = split.subject
  let rich: EmailComposition | null = null
  let rendered: ReturnType<typeof renderEmailComposition> | null = null
  let formattingError = false
  if (onRichChange) {
    try {
      if (composition && composition.source_text !== value) throw new Error('Saved composition source changed')
      rich = buildEmailComposition(value, from, { subject: fallbackSubject, transport, composition })
      rendered = renderEmailComposition(rich)
    } catch { formattingError = true }
  }
  const editingDisabled = disabled || formattingError
  const richBody = rich ? renderEmailDocument(rich.body).text : ''
  const updateBody = (body: EmailRichNode) => {
    if (!rich || !onRichChange) return
    const full = emailDraftText(subject, renderEmailDocument(body).text)
    onRichChange(full, { ...rich, source_text: full, body })
  }
  const updateSignature = (signature: EmailRichNode | null) => {
    if (!rich || !onRichChange) return
    const full = emailDraftText(subject, richBody)
    onRichChange(full, { ...rich, source_text: full, signature })
  }
  const updateSubject = (nextSubject: string) => {
    const full = emailDraftText(nextSubject, rich ? richBody : split.body)
    if (rich && onRichChange) onRichChange(full, { ...rich, source_text: full })
    else onChange(full)
  }
  let ccError = '', recipients: string[] = []
  try { recipients = parseEmailCc(cc) } catch (error) { ccError = (error as Error).message }
  const details = { ...emailPreview(value, { subject, from, to: to ? [to] : [], cc: recipients, transport }), subject, ...(rendered ? { body: rendered.text, html: rendered.html } : {}) }
  return <div className="dm-email-editor">
    <div className="dm-email-toolbar"><span>Email draft</span><button type="button" aria-pressed={preview && !formattingError} disabled={formattingError} onClick={() => { onBlur(); setPreview(!preview) }}>{preview && !formattingError ? 'Edit' : 'Preview'}</button></div>
    {preview && !formattingError ? <EmailPreview details={details} state="Draft" /> : <div className="dm-email-sheet">
      <div className="dm-email-edit-fields">
        <div className="dm-email-field"><span className="dm-email-field-name">From</span><span>{from}</span></div>
        <div className="dm-email-field"><span className="dm-email-field-name">To</span><span>{to || 'Recipient unavailable'}</span></div>
        <EmailCcField value={cc} onChange={onCcChange} onBlur={onBlur} label={ccLabel} disabled={editingDisabled} />
        <label className="dm-email-field dm-email-subject-field"><span className="dm-email-field-name">Subject</span><input aria-label={subjectLabel} autoComplete="off" data-autosave value={subject} placeholder="Add an email subject" disabled={editingDisabled} onChange={event => updateSubject(event.target.value)} onBlur={onBlur} onKeyDown={onKeyDown} /></label>
      </div>
      {formattingError ? <p className="dm-email-error" role="alert">Saved email formatting changed. Refresh email details before editing or sending.</p>
        : rich ? <div onKeyDownCapture={event => { if (onKeyDown && event.key === 'Enter' && (event.metaKey || event.ctrlKey)) onKeyDown(event as unknown as KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) }}>
        <RichEmailEditor value={rich.body} onChange={updateBody} label={label} onBlur={onBlur} disabled={disabled} />
        <EmailSignature signature={rich.signature} from={from} onChange={updateSignature} onBlur={onBlur} disabled={disabled} />
      </div> : <textarea className="dm-email-textarea" aria-label={label} data-autosave value={split.body} rows={7} spellCheck onChange={event => onChange(emailDraftText(subject, event.target.value))} onBlur={onBlur} onKeyDown={onKeyDown} disabled={disabled} />}
    </div>}
    {preview && ccError && <p className="dm-email-error" role="alert">{ccError}</p>}
  </div>
}
