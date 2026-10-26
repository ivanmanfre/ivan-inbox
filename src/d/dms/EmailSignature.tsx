import { useState } from 'react'
import { defaultEmailSignature, plainEmailDocument, renderEmailDocument, type EmailRichNode } from '../../lib/emailRichText'
import { RichEmailEditor } from './RichEmailEditor'

export function EmailSignature({ signature, from, onChange, onBlur, disabled = false }: {
  signature: EmailRichNode | null; from: string; onChange: (signature: EmailRichNode | null) => void; onBlur?: () => void; disabled?: boolean
}) {
  const [editing, setEditing] = useState(false)
  const defaultSignature = defaultEmailSignature(from)
  const html = signature ? renderEmailDocument(signature).html : null
  return <div className="dm-rich-email-signature">
    <div className="dm-rich-email-signature-head"><span>Signature</span><div>
      {!signature && <button type="button" disabled={disabled} onClick={() => { setEditing(true); onChange(plainEmailDocument('')) }}>Add signature</button>}
      {signature && <button type="button" disabled={disabled} onClick={() => setEditing(!editing)}>{editing ? 'Done editing signature' : 'Edit signature'}</button>}
      {signature && <button type="button" disabled={disabled} onClick={() => { setEditing(false); onChange(null) }}>Remove signature</button>}
      {defaultSignature && <button type="button" disabled={disabled} onClick={() => { setEditing(false); onChange(defaultSignature) }}>Reset signature</button>}
    </div></div>
    {signature ? editing
      ? <RichEmailEditor value={signature} onChange={onChange} onBlur={onBlur} label="Email signature" disabled={disabled} compact />
      : <div className="dm-rich-email-signature-preview" dangerouslySetInnerHTML={{ __html: html ?? '' }} />
      : <p className="dm-rich-email-signature-empty">No signature</p>}
  </div>
}
