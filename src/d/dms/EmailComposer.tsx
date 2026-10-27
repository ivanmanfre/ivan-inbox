import { useState, type KeyboardEvent } from 'react'
import { emailPreview } from '../../lib/emailPresentation'
import { buildEmailComposition } from '../../lib/emailCompositionDraft'
import { renderEmailComposition, renderEmailDocument, type EmailComposition, type EmailRichNode } from '../../lib/emailRichText'
import { warsawDayTime } from '../ui/time'
import { EmailPreview } from './EmailMessage'
import { parseEmailCc } from '../../lib/emailCc'
import { EmailCcField } from './EmailDraftEditor'
import { EmailSignature } from './EmailSignature'
import { RichEmailEditor } from './RichEmailEditor'
import './email.css'

type ReplyContext = { from: string; fromName?: string | null; date: string | null; subject?: string | null; body: string; isLatest: boolean; selection: 'latest' | 'specific' }

export function EmailComposer({ from, to, subject, value, setValue, busy, disabled, onSend, noSend = false, error, onRetry, onClose, replyToMessageId, composition, onRichChange, replyContext, onViewOriginal, onReplyLatest, cc = '', onCcChange }: {
  from: string; to: string | null; subject: string; value: string; setValue: (value: string) => void; busy: boolean
  disabled?: string | null; onSend: () => void; noSend?: boolean; error?: string | null; onRetry?: () => void; onClose?: () => void; replyToMessageId?: string | null
  composition?: EmailComposition | null; onRichChange?: (text: string, composition: EmailComposition) => void
  replyContext?: ReplyContext; onViewOriginal?: () => void; onReplyLatest?: () => void
  cc?: string; onCcChange?: (cc: string) => void
}) {
  const [preview, setPreview] = useState(false)
  const [expandedSource, setExpandedSource] = useState(false)
  const sourceText = (body: string) => `Subject: ${subject}\n\n${body}`
  let rich: EmailComposition | null = null
  let rendered: ReturnType<typeof renderEmailComposition> | null = null
  let formattingError = false
  if (onRichChange) {
    try {
      rich = buildEmailComposition(sourceText(value), from, { subject, composition })
      rendered = renderEmailComposition(rich)
    } catch { formattingError = true }
  }
  let ccList: string[] = [], ccInvalid = false
  try { ccList = parseEmailCc(cc) } catch { ccInvalid = true }
  const off = busy || !!disabled || !to || formattingError || ccInvalid
  const hasBody = rich ? !!renderEmailDocument(rich.body).text.trim() : !!value.trim()
  const updateBody = (body: EmailRichNode) => {
    if (!rich || !onRichChange) return
    const text = renderEmailDocument(body).text
    onRichChange(text, { ...rich, source_text: sourceText(text), body })
  }
  const updateSignature = (signature: EmailRichNode | null) => {
    if (!rich || !onRichChange) return
    const text = renderEmailDocument(rich.body).text
    onRichChange(text, { ...rich, source_text: sourceText(text), signature })
  }
  const sendKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); if (!off && hasBody) onSend() }
  }
  return <div className="dm-email-composer">
    <div className="dm-email-toolbar"><span>Reply by email</span><div><button type="button" aria-pressed={preview && !formattingError} disabled={formattingError} onClick={() => setPreview(!preview)}>{preview && !formattingError ? 'Edit' : 'Preview'}</button>{onClose && <button type="button" aria-label="Close email reply" disabled={busy} onClick={onClose}>Close</button>}</div></div>
    {replyContext && <div className="dm-email-reply-context"><div className="dm-email-reply-context-top"><span>Replying to</span><strong>{replyContext.isLatest ? 'Latest received email' : 'Earlier email in this thread'}</strong></div>
      <div className="dm-email-reply-context-meta"><strong>{replyContext.fromName || replyContext.from}</strong>{replyContext.fromName && <span>{replyContext.from}</span>}{replyContext.date && <time dateTime={replyContext.date}>{warsawDayTime(replyContext.date)}</time>}</div>
      <div className="dm-email-reply-context-subject">{(replyContext.subject ?? subject) || '(no subject)'}</div>
      <p data-expanded={expandedSource || undefined}>{expandedSource || replyContext.body.length <= 180 ? replyContext.body : `${replyContext.body.slice(0, 180).trimEnd()}…`}</p>
      <div className="dm-email-reply-context-actions">{replyContext.body.length > 180 && <button type="button" onClick={() => setExpandedSource(!expandedSource)}>{expandedSource ? 'Show less' : 'Show more'}</button>}{onViewOriginal && <button type="button" onClick={onViewOriginal}>View original</button>}{!replyContext.isLatest && onReplyLatest && <button type="button" onClick={onReplyLatest}>Reply to latest</button>}</div>
    </div>}
    {preview && !formattingError ? <EmailPreview details={{ ...emailPreview(`Subject: ${subject}\n\n${value}`, { from, to: to ? [to] : [], cc: ccList, replyToMessageId }), subject, ...(rendered ? { body: rendered.text, html: rendered.html } : {}) }} state="Draft" /> : <div className="dm-email-sheet">
      <div className="dm-email-edit-fields">
        <div className="dm-email-field"><span className="dm-email-field-name">From</span><span>{from || 'Sender unavailable'}</span></div>
        <div className="dm-email-field"><span className="dm-email-field-name">To</span><span>{to || (error || disabled ? 'Recipient unavailable' : 'Loading recipient...')}</span></div>
        {onCcChange && <EmailCcField value={cc} onChange={onCcChange} onBlur={() => {}} label="Email reply CC recipients" disabled={busy || !!disabled || !to} />}
        <div className="dm-email-field dm-email-subject-field"><span className="dm-email-field-name">Subject</span><span>{subject || '(no subject)'}</span></div>
      </div>
      {formattingError ? <p className="dm-email-error" role="alert">Saved email formatting changed. Refresh email details before editing or sending.</p>
        : rich ? <><RichEmailEditor value={rich.body} onChange={updateBody} label="Email reply" disabled={busy || !!disabled} onSendShortcut={() => { if (!off && hasBody) onSend() }} /><EmailSignature signature={rich.signature} from={from} onChange={updateSignature} disabled={busy || !!disabled} /></>
          : <textarea className="dm-email-textarea" aria-label="Email reply" placeholder="Write your reply" value={value} onChange={event => setValue(event.target.value)} onKeyDown={sendKey} rows={5} disabled={busy || !!disabled} spellCheck />}
    </div>}
    {(disabled || error) && <p className="dm-email-error" role={error ? 'alert' : 'note'}>{disabled}{disabled && error && ' '}{error}{onRetry && <button type="button" disabled={busy} onClick={onRetry}>Retry email details</button>}</p>}
    <div className="dm-email-composer-foot"><span>{busy ? 'Sending...' : '⌘↩ or Ctrl+Enter to send'}</span>{!noSend && <button type="button" className="dm-email-send" data-verb="compose-send" disabled={off || !hasBody} onClick={onSend}>Send email</button>}</div>
  </div>
}
