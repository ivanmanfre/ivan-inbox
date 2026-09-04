import { useCallback, useEffect, useRef, useState } from 'react'
import { detectLinks } from '../../../../../lib/unfurl'
import { useStt } from '../../../../v2c/chat/useStt'
import { LinkPreview } from './LinkPreview'
import { Glyph } from './icons'

type Attachment = { id: string; kind: 'image' | 'pdf'; name: string; url: string; size: number }

/** A file size a reader owns. A chip that names a file and not its weight is
 * half a chip: the weight is the thing that decides whether it goes. */
export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// Deterministic bar heights from elapsed recording time. `useStt` exposes only
// state/elapsedMs/note, so there is no audio level to read and none is faked:
// these bars are a RECORDING indicator and the seconds beside them are the
// number that is true.
function levelBars(elapsedMs: number, n = 14): number[] {
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
  const [heard, setHeard] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const fieldRef = useRef<HTMLTextAreaElement>(null)

  const stt = useStt(t => {
    onChange(value.trim() ? `${value.replace(/\s+$/, '')} ${t}` : t)
    setHeard(t)
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
    setHeard(null)
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
      next.push({
        id: `${f.name}:${f.size}:${f.lastModified}`, kind: isPdf ? 'pdf' : 'image',
        name: f.name, url: URL.createObjectURL(f), size: f.size,
      })
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

  // The bar grows with what is in it rather than scrolling a one-line window
  // under the caret.
  useEffect(() => {
    const el = fieldRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`
  }, [value])

  const recording = stt.state === 'recording'
  const transcribing = stt.state === 'transcribing'

  return (
    <div className="bb-composer bb-a-composer">
      {firstLink && <LinkPreview url={firstLink} />}

      {attachments.length > 0 && (
        <div className="bb-attach-row bb-a-chips">
          {attachments.map(a => (
            <div className="bb-attach bb-a-chip" key={a.id}>
              {a.kind === 'image'
                ? <img className="bb-attach-thumb bb-a-chip-thumb" src={a.url} alt="" />
                : <span className="bb-a-chip-doc"><Glyph name="doc" size={18} /></span>}
              <span className="bb-a-chip-t">
                <span className="bb-a-chip-n">{a.name}</span>
                <span className="bb-a-chip-s">{fileSize(a.size)}</span>
              </span>
              <button
                type="button" className="bb-attach-x bb-a-chip-x"
                onClick={() => removeAttachment(a.id)} aria-label={`Remove ${a.name}`}
              ><Glyph name="x" size={13} /></button>
            </div>
          ))}
          <span className="bb-attach-note bb-a-chip-note">attachment stays on this phone for now</span>
        </div>
      )}

      {(recording || transcribing) && (
        <div className={`bb-voice bb-a-voice${recording ? ' rec' : ''}`} data-voice={stt.state}>
          <div className="bb-bars bb-a-bars" aria-hidden>
            {levelBars(recording ? stt.elapsedMs : 0).map((v, i) => (
              <span key={i} style={{ height: `${Math.round(v * 22)}px` }} />
            ))}
          </div>
          <span className="bb-voice-t bb-a-voice-t">
            {recording ? `Listening. ${Math.floor(stt.elapsedMs / 1000)}s` : 'Writing down what you said.'}
          </span>
          {recording && (
            <button type="button" className="bb-voice-stop bb-a-voice-stop" onClick={stt.toggle}>Done</button>
          )}
        </div>
      )}

      <div className="bb-composer-row bb-a-bar">
        <input
          ref={fileRef} type="file" accept="image/*,application/pdf" multiple hidden
          onChange={e => { onFiles(e.target.files); e.target.value = '' }}
        />
        <button type="button" className="bb-ctl bb-a-ctl" aria-label="Attach a file" onClick={() => fileRef.current?.click()}>
          <Glyph name="plus" />
        </button>
        {stt.supported && (
          <button
            type="button" className={`bb-ctl bb-a-ctl bb-mic${recording ? ' rec' : ''}`} data-mic
            aria-label={recording ? 'Stop recording' : 'Dictate'} disabled={transcribing} onClick={stt.toggle}
          >{transcribing ? '…' : <Glyph name="mic" />}</button>
        )}
        <textarea
          ref={fieldRef} className="bb-field bb-a-field" data-ask rows={1} placeholder={placeholder}
          value={value}
          onChange={e => { onChange(e.target.value); setHeard(null) }}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend() } }}
        />
        {busy || runningElsewhere ? (
          <button type="button" className="bb-ctl bb-a-ctl bb-stop-c" data-stop aria-label="Stop" onClick={onStop}>
            <Glyph name="stop" />
          </button>
        ) : (
          <button
            type="button" className={`bb-ctl bb-a-ctl bb-send${canSend ? ' ready' : ''}`}
            data-send aria-label="Send" disabled={!canSend} onClick={doSend}
          ><Glyph name="send" /></button>
        )}
      </div>

      {/* The transcript, under the field it went into. A receipt at meta size,
          not the same sentence printed twice at prose size. */}
      {!recording && !transcribing && heard && (
        <div className="bb-voice bb-a-heard landed" data-voice="landed">
          <span className="bb-a-heard-l">Heard</span>
          <span className="bb-voice-t bb-a-heard-t">{heard}</span>
          <button
            type="button" className="bb-voice-stop bb-a-heard-x"
            onClick={() => setHeard(null)} aria-label="Dismiss what was heard"
          ><Glyph name="x" size={13} /></button>
        </div>
      )}
      {stt.note && <span className="bb-voice-t bb-a-voice-note">{stt.note}</span>}
    </div>
  )
}
