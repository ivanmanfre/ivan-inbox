import { useCallback, useEffect, useRef, useState } from 'react'
import { detectLinks } from '../../../../../lib/unfurl'
import { useStt } from '../../../../v2c/chat/useStt'
import { LinkPreview } from './LinkPreview'
import { fileSize } from './forms'

type Attachment = { id: string; kind: 'image' | 'pdf'; name: string; size: number; url: string }

// Deterministic bar heights from elapsed recording time. `useStt` hands back
// state/elapsedMs/note and no MediaStream, so there is no audio level to read
// and drawing one from Math.random would be inventing a number. These bars are
// a RECORDING indicator: they move because the recorder is running, and the
// seconds beside them are the number that is actually true.
function levelBars(elapsedMs: number, n = 14): number[] {
  const t = elapsedMs / 140
  return Array.from({ length: n }, (_, i) => {
    const phase = t - i * 0.6
    const v = 0.35 + 0.3 * Math.abs(Math.sin(phase)) + 0.15 * Math.abs(Math.sin(phase * 2.3))
    return Math.max(0.15, Math.min(1, v))
  })
}

function MicGlyph() {
  return (
    <svg className="bb-glyph" viewBox="0 0 20 20" aria-hidden="true">
      <rect x="7.4" y="2.6" width="5.2" height="9.2" rx="2.6" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M4.6 9.6a5.4 5.4 0 0 0 10.8 0M10 15v2.4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

/** A drawn page, so a PDF chip carries a mark of its own kind rather than a
 * character borrowed from a box-drawing set. */
function PdfGlyph() {
  return (
    <svg className="bbf-filemark" viewBox="0 0 18 18" aria-hidden="true">
      <path d="M4 1.6h6l4 4v10.8H4z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M10 1.6v4h4" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M6.5 10h5M6.5 12.6h5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}

/**
 * The composer as a floating bar above the tab bar, with the media tray
 * opening UPWARD out of it. A media chip carries a thumbnail, the file's name
 * AND its size; a link card crops its thumbnail to a fixed 16:9 (skin.css) so
 * a wide still is never letterboxed inside a card that could have cropped it.
 */
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
        id: `${f.name}:${f.size}:${f.lastModified}`,
        kind: isPdf ? 'pdf' : 'image', name: f.name, size: f.size, url: URL.createObjectURL(f),
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

  // The field grows with what is in it rather than scrolling a one-line window
  // under the caret.
  useEffect(() => {
    const el = fieldRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`
  }, [value])

  const recording = stt.state === 'recording'
  const transcribing = stt.state === 'transcribing'
  const trayOpen = !!firstLink || attachments.length > 0 || recording || transcribing || !!heard || !!stt.note

  return (
    <div className="bb-composer bbf-composer">
      {trayOpen && (
        <div className="bbf-tray">
          {firstLink && <LinkPreview url={firstLink} />}

          {attachments.length > 0 && (
            <div className="bb-attach-row bbf-chips">
              {attachments.map(a => (
                <div className="bb-attach bbf-chip" key={a.id}>
                  {a.kind === 'image'
                    ? <img className="bb-attach-thumb bbf-thumb" src={a.url} alt="" />
                    : <span className="bbf-thumb bbf-thumb-pdf" aria-hidden><PdfGlyph /></span>}
                  <span className="bbf-chip-t">
                    <span className="bbf-chip-n">{a.name}</span>
                    <span className="bbf-chip-s">{fileSize(a.size)}</span>
                  </span>
                  <button
                    type="button" className="bb-attach-x bbf-chip-x" data-tap
                    onClick={() => removeAttachment(a.id)} aria-label={`Remove ${a.name}`}
                  >✕</button>
                </div>
              ))}
              <span className="bb-attach-note">attachment stays on this phone for now</span>
            </div>
          )}

          {(recording || transcribing) && (
            <div className={`bb-voice${recording ? ' rec' : ''}`} data-voice={stt.state}>
              <div className="bb-bars" aria-hidden>
                {levelBars(recording ? stt.elapsedMs : 0).map((v, i) => (
                  <span key={i} style={{ height: `${Math.round(v * 22)}px` }} />
                ))}
              </div>
              <span className="bb-voice-t">
                {recording ? `Listening. ${Math.floor(stt.elapsedMs / 1000)}s` : 'Writing down what you said.'}
              </span>
              {recording && (
                <button type="button" className="bb-voice-stop" data-tap onClick={stt.toggle}>Done</button>
              )}
            </div>
          )}
          {!recording && !transcribing && heard && (
            <div className="bb-voice landed bbf-heard" data-voice="landed">
              <span className="bb-voice-t bbf-heard-t">
                <span className="bbf-heard-l">Heard</span>
                {heard}
              </span>
              <button
                type="button" className="bb-voice-stop bbf-heard-x" data-tap
                onClick={() => setHeard(null)} aria-label="Dismiss what was heard"
              >✕</button>
            </div>
          )}
          {stt.note && <span className="bb-voice-t bb-voice-note">{stt.note}</span>}
        </div>
      )}

      <div className="bb-composer-row bbf-bar">
        <input
          ref={fileRef} type="file" accept="image/*,application/pdf" multiple hidden
          onChange={e => { onFiles(e.target.files); e.target.value = '' }}
        />
        <button type="button" className="bb-ctl" data-tap aria-label="Attach a file" onClick={() => fileRef.current?.click()}>+</button>
        {stt.supported && (
          <button
            type="button"
            className={`bb-ctl bb-mic${recording ? ' rec' : ''}`}
            data-mic data-tap
            aria-label={recording ? 'Stop recording' : 'Dictate'}
            disabled={transcribing}
            onClick={stt.toggle}
          >{transcribing ? '…' : <MicGlyph />}</button>
        )}
        <textarea
          ref={fieldRef}
          className="bb-field"
          data-ask
          rows={1}
          placeholder={placeholder}
          value={value}
          onChange={e => { onChange(e.target.value); setHeard(null) }}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend() }
          }}
        />
        {busy || runningElsewhere ? (
          <button type="button" className="bb-ctl bb-stop-c" data-stop data-tap aria-label="Stop" onClick={onStop}>◼</button>
        ) : (
          <button
            type="button" className={`bb-ctl bb-send${canSend ? ' ready' : ''}`}
            data-send data-tap aria-label="Send" disabled={!canSend} onClick={doSend}
          >↑</button>
        )}
      </div>
    </div>
  )
}
