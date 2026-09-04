// Composer.tsx - the Ask place's own composer. Reuses useStt (server-side
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
  return `[Attached: ${a.file.name}. Attachment stays on this phone for now.]`
}

// Seven bars whose heights move off the elapsed clock - useStt exposes
// recording state and an elapsed clock, not a live amplitude stream, so this
// is an honest "the microphone is open" beat rather than a real waveform
// dressed up as one. Documented as a scope cut in NOTES.md.
function LevelBars({ elapsedMs }: { elapsedMs: number }) {
  const bars = [0, 1, 2, 3, 4, 5, 6]
  return (
    <span className="ba-levelmeter" aria-hidden="true">
      {bars.map(i => {
        const h = 25 + Math.abs(Math.sin(elapsedMs / 170 + i * 0.9)) * 75
        return <span key={i} className="ba-level-bar" style={{ height: `${h}%` }} />
      })}
    </span>
  )
}

// Drawn glyphs, not emoji: this surface's whole icon vocabulary is
// monochrome geometry (the tab bar, the sources mark), and a colour emoji
// paperclip sitting next to it reads as a different app's control.
function ClipGlyph() {
  return (
    <svg className="ba-glyph" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M13.5 5.5v7.2a3.5 3.5 0 1 1-7 0V5.8a2.2 2.2 0 1 1 4.4 0v6.9a1 1 0 1 1-2 0V6.3"
        fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

function MicGlyph() {
  return (
    <svg className="ba-glyph" viewBox="0 0 20 20" aria-hidden="true">
      <rect x="7.4" y="2.6" width="5.2" height="9.2" rx="2.6"
        fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M4.6 9.6a5.4 5.4 0 0 0 10.8 0M10 15v2.4"
        fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

/** "0:07" - the recording clock, so the elapsed time is a reading not a guess. */
function clock(ms: number): string {
  const total = Math.floor(ms / 1000)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
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
  // The transcript is held as well as inserted, so the composer can SHOW what
  // landed rather than leaving the field to be read as typing.
  const [heard, setHeard] = useState<string | null>(null)
  const stt = useStt(t => {
    setHeard(t)
    setText(prev => (prev.trim() ? `${prev.replace(/\s+$/, '')} ${t}` : t))
  })

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
    setHeard(null)
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
        <div className="ba-voicebar" data-voice="recording">
          <LevelBars elapsedMs={stt.elapsedMs} />
          <span className="ba-voice-t">{clock(stt.elapsedMs)} listening</span>
          <span className="ba-voice-live">Tap the square to stop and drop it in the message.</span>
        </div>
      )}
      {stt.state === 'transcribing' && (
        <div className="ba-voicebar" data-voice="transcribing">
          <LevelBars elapsedMs={0} />
          <span className="ba-voice-t">Writing it down</span>
          <span className="ba-voice-live">{clock(stt.elapsedMs)} recorded</span>
        </div>
      )}
      {stt.state === 'idle' && heard && !stt.note && (
        <div className="ba-voicebar" data-voice="landed">
          <span className="ba-voice-t">Heard</span>
          <span className="ba-voice-live">{heard}</span>
        </div>
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
        ><ClipGlyph /></button>
        {stt.supported && (
          <button
            type="button" className={`ba-mic${stt.state !== 'idle' ? ` ${stt.state}` : ''}`}
            onClick={stt.toggle} disabled={stt.state === 'transcribing'}
            aria-label={stt.state === 'recording' ? 'Stop dictating' : 'Dictate'}
          >{stt.state === 'recording' ? '■' : <MicGlyph />}</button>
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
