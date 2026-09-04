import { useCallback, useEffect, useRef, useState } from 'react'
import { detectLinks } from '../../../lib/unfurl'
import { useStt } from '../../v2c/chat/useStt'
import type { ChatHandle } from '../../v2c/useChat'
import { LinkPreviewCard } from './LinkPreviewCard'

type Attachment = { name: string; kind: 'image' | 'pdf'; url: string }

/**
 * The one composer, docked at the bottom of the stream on the phone and inside
 * the desktop pane, the thesis's "always docked" half. Text, dictation, one
 * client-side attachment, and the link preview that also freezes into the sent
 * turn once it lands.
 */
export function Composer({ chat, about, onStop, busy }: {
  chat: ChatHandle
  about?: string | null
  onStop: () => void
  busy: boolean
}) {
  const [text, setText] = useState('')
  const [attachment, setAttachment] = useState<Attachment | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const fieldRef = useRef<HTMLInputElement>(null)

  const stt = useStt(t => {
    setText(prev => (prev.trim() ? `${prev.replace(/\s+$/, '')} ${t}` : t))
    fieldRef.current?.focus()
  })

  const links = detectLinks(text)

  const pickFile = useCallback((f: File) => {
    const kind: Attachment['kind'] = f.type === 'application/pdf' ? 'pdf' : 'image'
    const url = URL.createObjectURL(f)
    setAttachment(prev => {
      if (prev) URL.revokeObjectURL(prev.url)
      return { name: f.name, kind, url }
    })
  }, [])

  useEffect(() => () => { if (attachment) URL.revokeObjectURL(attachment.url) }, [attachment])

  const clearAttachment = useCallback(() => {
    setAttachment(a => { if (a) URL.revokeObjectURL(a.url); return null })
  }, [])

  const send = useCallback(() => {
    if (busy) return
    const body = text.trim()
    if (!body && !attachment) return
    // The file itself never leaves this phone this run, the send names it in
    // plain words instead of pretending a byte moved.
    const withAttachment = attachment
      ? `${body}${body ? '\n\n' : ''}(attached: ${attachment.name}, stays on this phone for now)`
      : body
    setText('')
    clearAttachment()
    void chat.send(withAttachment, about ?? undefined)
  }, [busy, text, attachment, chat, about, clearAttachment])

  return (
    <div className="brc-composer">
      {links.length > 0 && (
        <div className="brc-composer-preview">
          {links.slice(0, 1).map(l => <LinkPreviewCard key={l.url} url={l.url} />)}
        </div>
      )}
      {attachment && (
        <div className="brc-attach">
          {attachment.kind === 'image'
            ? <img className="brc-attach-thumb" src={attachment.url} alt="" />
            : <span className="brc-attach-pdf">PDF</span>}
          <span className="brc-attach-n">{attachment.name}</span>
          <span className="brc-attach-note">attachment stays on this phone for now</span>
          <button type="button" className="brc-attach-x" onClick={clearAttachment} aria-label="Remove attachment">✕</button>
        </div>
      )}
      {stt.state === 'recording' && (
        <div className="brc-voice">
          <span className="brc-voice-bars" aria-hidden="true">
            <i /><i /><i /><i /><i />
          </span>
          <span className="brc-voice-t">Listening… {Math.floor(stt.elapsedMs / 1000)}s</span>
        </div>
      )}
      {stt.state === 'transcribing' && (
        <div className="brc-voice"><span className="brc-voice-t">Transcribing…</span></div>
      )}
      {stt.note && stt.state === 'idle' && <div className="brc-voice-note">{stt.note}</div>}
      <div className="brc-row">
        <input
          ref={fileRef} type="file" accept="image/*,application/pdf" hidden
          onChange={e => { const f = e.target.files?.[0]; if (f) pickFile(f); e.target.value = '' }}
        />
        <button
          type="button" className="brc-tool" onClick={() => fileRef.current?.click()}
          aria-label="Attach a file" title="Attach"
        >📎</button>
        {stt.supported && (
          <button
            type="button" className={`brc-tool brc-mic${stt.state !== 'idle' ? ' on' : ''}`}
            onClick={stt.toggle} disabled={stt.state === 'transcribing'}
            aria-label={stt.state === 'recording' ? 'Stop dictating' : 'Dictate'}
          >🎙</button>
        )}
        <input
          ref={fieldRef} data-ask className="brc-field" value={text}
          placeholder={about ? `Ask about ${about}…` : 'Ask Claude…'}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
        />
        {busy ? (
          <button type="button" className="brc-send brc-stop" data-stop onClick={onStop} aria-label="Stop">◼</button>
        ) : (
          <button
            type="button" className="brc-send" data-send onClick={send}
            disabled={!text.trim() && !attachment} aria-label="Send"
          >↑</button>
        )}
      </div>
    </div>
  )
}
