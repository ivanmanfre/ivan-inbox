import { useCallback, useEffect, useRef, useState } from 'react'
import { detectLinks } from '../../../lib/unfurl'
import { useStt } from '../../v2c/chat/useStt'
import { LinkPreview } from './LinkPreview'

type Attachment = { id: string; kind: 'image' | 'pdf'; name: string; url: string }

// Deterministic bar heights from elapsed recording time. useStt (the hook
// this candidate reuses rather than forks, per the brief) hands back only
// state/elapsedMs/note — no raw MediaStream, no analyser data — so there is
// no real audio level to draw. Faking a live waveform from Math.random would
// be inventing a number; this is a named, honest substitute: a bar pattern
// that moves because time is moving, not because the mic heard anything in
// particular. Flagged in NOTES.md.
function levelBars(elapsedMs: number, n = 12): number[] {
  const t = elapsedMs / 140
  return Array.from({ length: n }, (_, i) => {
    const phase = t - i * 0.6
    const v = 0.35 + 0.3 * Math.abs(Math.sin(phase)) + 0.15 * Math.abs(Math.sin(phase * 2.3))
    return Math.max(0.15, Math.min(1, v))
  })
}

export function Composer({ value, onChange, onSend, busy, runningElsewhere, onStop, placeholder }: {
  value: string
  onChange: (v: string) => void
  onSend: (text: string) => void
  busy: boolean
  runningElsewhere: boolean
  onStop: () => void
  placeholder: string
}) {
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const fileRef = useRef<HTMLInputElement>(null)
  const fieldRef = useRef<HTMLTextAreaElement>(null)

  const stt = useStt(t => {
    onChange(value.trim() ? `${value.replace(/\s+$/, '')} ${t}` : t)
    fieldRef.current?.focus()
  })

  const links = detectLinks(value)
  const firstLink = links[0]?.url

  const canSend = value.trim().length > 0 && !busy && !runningElsewhere

  const doSend = useCallback(() => {
    if (!canSend) return
    const lines = [value.trim()]
    for (const a of attachments) lines.push(`[attached: ${a.name}]`)
    onSend(lines.join('\n'))
    setAttachments(prev => {
      for (const a of prev) URL.revokeObjectURL(a.url)
      return []
    })
  }, [canSend, value, attachments, onSend])

  useEffect(() => () => {
    for (const a of attachments) URL.revokeObjectURL(a.url)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onFiles = (files: FileList | null) => {
    if (!files) return
    const next: Attachment[] = []
    for (const f of Array.from(files)) {
      const isPdf = f.type === 'application/pdf'
      const isImg = f.type.startsWith('image/')
      if (!isPdf && !isImg) continue
      next.push({ id: `${f.name}:${f.size}:${f.lastModified}`, kind: isPdf ? 'pdf' : 'image', name: f.name, url: URL.createObjectURL(f) })
    }
    if (next.length) setAttachments(prev => [...prev, ...next])
  }

  const removeAttachment = (id: string) => {
    setAttachments(prev => {
      const found = prev.find(a => a.id === id)
      if (found) URL.revokeObjectURL(found.url)
      return prev.filter(a => a.id !== id)
    })
  }

  return (
    <div className="bb-composer">
      {firstLink && <LinkPreview url={firstLink} />}

      {attachments.length > 0 && (
        <div className="bb-attach-row">
          {attachments.map(a => (
            <div className="bb-attach" key={a.id}>
              {a.kind === 'image'
                ? <img className="bb-attach-thumb" src={a.url} alt="" />
                : <span aria-hidden>▤</span>}
              <span>{a.name}</span>
              <button type="button" className="bb-attach-x" onClick={() => removeAttachment(a.id)} aria-label={`Remove ${a.name}`}>✕</button>
            </div>
          ))}
          <span className="bb-attach-note">attachment stays on this phone for now</span>
        </div>
      )}

      {stt.state !== 'idle' && (
        <div className="bb-voice">
          <div className="bb-bars" aria-hidden>
            {levelBars(stt.elapsedMs).map((v, i) => (
              <span key={i} style={{ height: `${Math.round(v * 20)}px` }} />
            ))}
          </div>
          <span className="bb-voice-t">
            {stt.state === 'recording' ? `Listening… ${Math.floor(stt.elapsedMs / 1000)}s` : 'Transcribing…'}
          </span>
        </div>
      )}
      {stt.note && <span className="bb-voice-t">{stt.note}</span>}

      <div className="bb-composer-row">
        <input
          ref={fileRef} type="file" accept="image/*,application/pdf" multiple hidden
          onChange={e => { onFiles(e.target.files); e.target.value = '' }}
        />
        <button type="button" className="bb-ctl" aria-label="Attach a file" onClick={() => fileRef.current?.click()}>+</button>
        {stt.supported && (
          <button
            type="button"
            className={`bb-ctl bb-mic${stt.state === 'recording' ? ' rec' : ''}`}
            aria-label={stt.state === 'recording' ? 'Stop recording' : 'Dictate'}
            disabled={stt.state === 'transcribing'}
            onClick={stt.toggle}
          >{stt.state === 'transcribing' ? '…' : '🎙'}</button>
        )}
        <textarea
          ref={fieldRef}
          className="bb-field"
          data-ask
          rows={1}
          placeholder={placeholder}
          value={value}
          onChange={e => onChange(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend() }
          }}
        />
        {busy || runningElsewhere ? (
          <button type="button" className="bb-ctl bb-stop-c" data-stop aria-label="Stop" onClick={onStop}>◼</button>
        ) : (
          <button
            type="button" className={`bb-ctl bb-send${canSend ? ' ready' : ''}`}
            data-send aria-label="Send" disabled={!canSend} onClick={doSend}
          >↑</button>
        )}
      </div>
    </div>
  )
}
