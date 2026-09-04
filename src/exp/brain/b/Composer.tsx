import { useCallback, useEffect, useRef, useState } from 'react'
import { detectLinks } from '../../../lib/unfurl'
import { useStt } from '../../v2c/chat/useStt'
import { LinkPreview } from './LinkPreview'

type Attachment = { id: string; kind: 'image' | 'pdf'; name: string; url: string }

// Deterministic bar heights from elapsed recording time. useStt (the hook this
// candidate reuses rather than forks, per the brief) hands back only
// state/elapsedMs/note — no raw MediaStream, no analyser data — so there is no
// real audio level to read. Faking a live waveform from Math.random would be
// inventing a number. These bars are a RECORDING indicator: they move because
// the recorder is running, they stop when it stops, and the seconds counter
// beside them is the number that is actually true. Written down here and in
// NOTES.md rather than dressed up as a microphone reading.
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
  // The last transcript this composer received, kept so the surface can SAY
  // what it heard rather than silently mutating the field under him. Cleared
  // the moment he types over it or sends.
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

  const recording = stt.state === 'recording'
  const transcribing = stt.state === 'transcribing'

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

      {/* The voice state, drawn rather than implied. Recording: bars plus the
          seconds that are actually elapsing. Transcribing: the bars hold still
          and the line says what is happening. Landed: the words themselves,
          under the field they were just written into. */}
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
            <button type="button" className="bb-voice-stop" onClick={stt.toggle}>Done</button>
          )}
        </div>
      )}
      {!recording && !transcribing && heard && (
        <div className="bb-voice landed" data-voice="landed">
          <span className="bb-voice-t">Heard: {heard}</span>
          <span className="bb-head-sp" />
          <button type="button" className="bb-voice-stop" onClick={() => setHeard(null)} aria-label="Dismiss what was heard">✕</button>
        </div>
      )}
      {stt.note && <span className="bb-voice-t bb-voice-note">{stt.note}</span>}

      <div className="bb-composer-row">
        <input
          ref={fileRef} type="file" accept="image/*,application/pdf" multiple hidden
          onChange={e => { onFiles(e.target.files); e.target.value = '' }}
        />
        <button type="button" className="bb-ctl" aria-label="Attach a file" onClick={() => fileRef.current?.click()}>+</button>
        {stt.supported && (
          <button
            type="button"
            className={`bb-ctl bb-mic${recording ? ' rec' : ''}`}
            data-mic
            aria-label={recording ? 'Stop recording' : 'Dictate'}
            disabled={transcribing}
            onClick={stt.toggle}
          >{transcribing ? '…' : '🎙'}</button>
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
