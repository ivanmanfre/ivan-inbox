import { useState, type KeyboardEvent } from 'react'
import { emailPreview } from '../../lib/emailPresentation'
import { EmailPreview } from './EmailMessage'
import './email.css'

export function EmailComposer({ from, to, subject, value, setValue, busy, disabled, onSend, noSend = false, error, onRetry, onClose, replyToMessageId }: {
  from: string; to: string | null; subject: string; value: string; setValue: (value: string) => void; busy: boolean
  disabled?: string | null; onSend: () => void; noSend?: boolean; error?: string | null; onRetry?: () => void; onClose?: () => void; replyToMessageId?: string | null
}) {
  const [preview, setPreview] = useState(false)
  const off = busy || !!disabled || !to
  const sendKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); if (!off && value.trim()) onSend() }
  }
  return <div className="dm-email-composer">
    <div className="dm-email-toolbar"><span>Reply by email</span><div><button type="button" aria-pressed={preview} onClick={() => setPreview(!preview)}>{preview ? 'Edit' : 'Preview'}</button>{onClose && <button type="button" aria-label="Close email reply" disabled={busy} onClick={onClose}>Close</button>}</div></div>
    {preview ? <EmailPreview details={{ ...emailPreview(`Subject: ${subject}\n\n${value}`, { from, to: to ? [to] : [], replyToMessageId }), subject }} state="Draft" /> : <div className="dm-email-sheet">
      <div className="dm-email-edit-fields">
        <div className="dm-email-field"><span className="dm-email-field-name">From</span><span>{from || 'Sender unavailable'}</span></div>
        <div className="dm-email-field"><span className="dm-email-field-name">To</span><span>{to || (error || disabled ? 'Recipient unavailable' : 'Loading recipient...')}</span></div>
        <div className="dm-email-field dm-email-subject-field"><span className="dm-email-field-name">Subject</span><span>{subject || '(no subject)'}</span></div>
      </div>
      <textarea className="dm-email-textarea" aria-label="Email reply" placeholder="Write your reply" value={value} onChange={event => setValue(event.target.value)} onKeyDown={sendKey} rows={5} disabled={busy || !!disabled} spellCheck />
    </div>}
    {(disabled || error) && <p className="dm-email-error" role={error ? 'alert' : 'note'}>{disabled}{disabled && error && ' '}{error}{onRetry && <button type="button" disabled={busy} onClick={onRetry}>Retry email details</button>}</p>}
    <div className="dm-email-composer-foot"><span>{busy ? 'Sending...' : '⌘↩ or Ctrl+Enter to send'}</span>{!noSend && <button type="button" className="dm-email-send" data-verb="compose-send" disabled={off || !value.trim()} onClick={onSend}>Send email</button>}</div>
  </div>
}
