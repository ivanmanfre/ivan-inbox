import { useCallback, useEffect, useRef, useState } from 'react'
import { emailRowSender, type InboxMessage } from '../../lib/inbox'
import { forwardInboxEmail, forwardRecipient, validForwardRecipient } from '../../lib/emailForward'
import { Sheet } from '../ui/Sheet'
import { Key } from '../ui/Key'
import { Linkified } from '../ui/Linkified'
import { useToast } from '../ui/toast'
import './forwardEmail.css'

export function ForwardEmailSheet({ message, onClose }: { message: InboxMessage; onClose: () => void }) {
  const [to, setTo] = useState(forwardRecipient(message.client_id))
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const sending = useRef(false)
  const request = useRef({ content: '', id: '' })
  const recipient = useRef<HTMLInputElement>(null)
  const close = useCallback(() => { if (!sending.current) onClose() }, [onClose])
  useEffect(() => { recipient.current?.focus() }, [])
  const toast = useToast()
  const send = async () => {
    if (sending.current || !validForwardRecipient(to)) return
    sending.current = true; setBusy(true); setError('')
    const content = JSON.stringify([message.id, to.trim(), note])
    if (request.current.content !== content) request.current = { content, id: crypto.randomUUID() }
    try {
      await forwardInboxEmail(message.id, to, note, request.current.id)
      toast.show({ message: `Forwarded to ${to.trim()}.` })
      onClose()
    } catch (e) { setError(e instanceof Error ? e.message : 'Forwarding failed. Try again.') }
    finally { sending.current = false; setBusy(false) }
  }
  return <Sheet open className="dm-forward-sheet" onClose={close} title="Forward to email" label="Forward email"
    sub={`From ${emailRowSender(message.client_id)}`} foot={<Key primary verb="confirm-forward-email" disabled={busy || !validForwardRecipient(to)} onClick={() => void send()}>{busy ? 'Forwarding…' : 'Forward email'}</Key>}>
    <form className="dm-forward-form" onSubmit={e => e.preventDefault()}>
      <label>Forward to email<input ref={recipient} type="email" required aria-label="Forward to email" autoComplete="email" value={to} disabled={busy} onChange={e => { setTo(e.target.value); setError('') }} /></label>
      <label>Add a note <small>Optional</small><textarea aria-label="Add a note" maxLength={8000} rows={3} value={note} disabled={busy} onChange={e => { setNote(e.target.value); setError('') }} /></label>
      <p className="dm-meta">Includes the original email, links and attachments. Replies go to the original sender.</p>
      <div className="dm-forward-original"><b>Original email</b><small>From {message.recipient_email || message.prospect_email || message.prospect_name}</small><p><Linkified text={message.message_text} /></p></div>
      {error && <p className="dm-warn" role="alert">{error}</p>}
    </form>
  </Sheet>
}
