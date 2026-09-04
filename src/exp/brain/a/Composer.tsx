// Composer.tsx — the Ask place's own composer. Reuses useStt (server-side
// dictation, the cleared-gate mic) by importing it rather than forking
// ChatPane's copy. Adds what ChatPane does not carry: a link preview as you
// type, and a client-side-only attachment chip (image thumbnail or PDF chip;
// nothing uploads this run).
import { useCallback, useEffect, useRef, useState } from 'react'
import { useStt } from '../../v2c/chat/useStt'
import { detectLinks } from '../../../lib/unfurl'
import { LinkPreviewCard } from './LinkPreviewCard'

export type PendingAttachment = { file: File; url: string; kind: 'image' | 'pdf' }

function attachmentNote(a: PendingAttachment): string {
  return `[Attached: ${a.file.name} — attachment stays on this phone for now]`
}

// A handful of bars whose heights pulse deterministically off elapsed time —
// useStt exposes recording state and an elapsed clock, not a live amplitude
// stream, so this is an honest "you are being recorded" beat rather than a
// real waveform. Documented as a scope cut in NOTES.md.
function LevelBars({ elapsedMs }: { elapsedMs: number }) {
  const bars = [0, 1, 2, 3, 4]
  return (
    <span className="ba-levelmeter" aria-hidden="true">
      {bars.map(i => {
        const h = 30 + Math.abs(Math.sin(elapsedMs / 180 + i * 1.3)) * 70
        return <span key={i} className="ba-level-bar" style={{ height: `${h}%` }} />
      })}
    </span>
  )
}

export function Composer({ busy, onSend, onAbort, placeholder }: {
  busy: boolean
  onSend: (text: string) => void
  onAbort: () => void
  placeholder: string
}) {
  const [text, setText] = useState('')
  const [attachment, setAttachment] = useState<PendingAttachment | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const stt = useStt(t => setText(prev => (prev.trim() ? `${prev.replace(/\s+$/, '')} ${t}` : t)))

  // Revoke the object URL when the attachment is replaced or the composer unmounts.
  useEffect(() => () => { if (attachment) URL.revokeObjectURL(attachment.url) }, [attachment])

  const pickFile = useCallback((f: File | undefined) => {
    if (!f) return
    const kind: PendingAttachment['kind'] = f.type === 'application/pdf' ? 'pdf' : 'image'
    if (kind === 'image' && !f.type.startsWith('image/')) return
    setAttachment(prev => {
      if (prev) URL.revokeObjectURL(prev.url)
      return { file: f, url: URL.createObjectURL(f), kind }
    })
  }, [])

  const links = detectLinks(text)
  const firstLink = links[0]?.url

  const send = useCallback(() => {
    const body = text.trim()
    if (!body && !attachment) return
    const full = attachment ? `${body ? `${body}\n\n` : ''}${attachmentNote(attachment)}` : body
    onSend(full)
    setText('')
    if (attachment) { URL.revokeObjectURL(attachment.url); setAttachment(null) }
  }, [text, attachment, onSend])

  return (
    <div className="ba-composer-wrap">
      {firstLink && <LinkPreviewCard url={firstLink} />}
      {attachment && (
        <div className="ba-attach-row">
          {attachment.kind === 'image' ? (
            <div className="ba-attach-thumb" style={{ backgroundImage: `url(${attachment.url})` }} />
          ) : (
            <div className="ba-attach-pdf">PDF</div>
          )}
          <div className="ba-attach-info">
            <div className="ba-attach-name">{attachment.file.name}</div>
            <div className="ba-attach-note">Attachment stays on this phone for now</div>
          </div>
          <button
            type="button" className="ba-attach-x" aria-label="Remove attachment"
            onClick={() => { URL.revokeObjectURL(attachment.url); setAttachment(null) }}
          >✕</button>
        </div>
      )}
      {stt.state === 'recording' && (
        <div className="ba-voicebar">
          <LevelBars elapsedMs={stt.elapsedMs} />
          <span className="ba-voice-t">{Math.floor(stt.elapsedMs / 1000)}s · listening</span>
        </div>
      )}
      {stt.state === 'transcribing' && (
        <div className="ba-voicebar"><span className="ba-voice-t">Transcribing…</span></div>
      )}
      {stt.note && stt.state === 'idle' && <div className="ba-voicenote">{stt.note}</div>}
      <div className="ba-composer">
        <input
          ref={fileRef} type="file" accept="image/*,application/pdf" hidden
          onChange={e => { pickFile(e.target.files?.[0]); e.target.value = '' }}
        />
        <button
          type="button" className="ba-clip" aria-label="Attach a file"
          onClick={() => fileRef.current?.click()}
        >📎</button>
        {stt.supported && (
          <button
            type="button" className={`ba-mic${stt.state !== 'idle' ? ` ${stt.state}` : ''}`}
            onClick={stt.toggle} disabled={stt.state === 'transcribing'}
            aria-label={stt.state === 'recording' ? 'Stop dictating' : 'Dictate'}
          >{stt.state === 'recording' ? '■' : '🎙'}</button>
        )}
        <input
          data-ask
          className="ba-field"
          placeholder={placeholder}
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
        />
        {busy ? (
          <button type="button" data-stop className="ba-send stop" onClick={onAbort} aria-label="Stop">◼</button>
        ) : (
          <button
            type="button" data-send className="ba-send"
            onClick={send}
            disabled={!text.trim() && !attachment}
          >↑</button>
        )}
      </div>
    </div>
  )
}
