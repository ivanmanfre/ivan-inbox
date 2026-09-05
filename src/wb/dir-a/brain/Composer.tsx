/* ==========================================================================
   src/wb/dir-a/brain/Composer.tsx: S30.

   03-DIRECTION moves 13 to 16, on the design system's own `Composer`: the one
   round control that swaps between send and stop, the bar springing its height
   as the mode changes, attachments as type-badged chips with a remove mark in
   the tray, and a pasted URL as a nested inset card with the prose first.

   Every hook the old composer carried is kept: the attachment list and its
   object-URL revokes, the dictation handle, the "heard" line, the live link
   detection, the auto-growing field and the send that joins the text with one
   `[attached: name]` line per file.
   ========================================================================== */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Chip, Composer as DsComposer, LevelMeter, type ComposerMode } from '../../../ds'
import { detectLinks } from '../../../lib/unfurl'
import { useStt } from '../../../exp/v2c/chat/useStt'
import { fileSize } from '../../../exp/brain/b/skins/b/forms'
import { LinkPreview } from './LinkPreview'
import './brain.css'

type Attachment = { id: string; kind: 'image' | 'pdf'; name: string; size: number; url: string }

/** How tall the field may grow before it starts scrolling under the caret. */
const FIELD_MAX = 120

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
  // The design system owns the field, so the seat that has to focus it and
  // grow it reaches it through the wrapper rather than through a ref the
  // primitive does not hand out.
  const wrapRef = useRef<HTMLDivElement>(null)
  const field = () => wrapRef.current?.querySelector('textarea') ?? null

  const stt = useStt(t => {
    onChange(value.trim() ? `${value.replace(/\s+$/, '')} ${t}` : t)
    setHeard(t)
    field()?.focus()
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
    const el = field()
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, FIELD_MAX)}px`
  }, [value])

  const recording = stt.state === 'recording'
  const transcribing = stt.state === 'transcribing'
  const trayOpen = !!firstLink || attachments.length > 0 || recording || transcribing || !!heard || !!stt.note

  const mode: ComposerMode = busy || runningElsewhere
    ? 'busy'
    : recording ? 'recording' : value.trim().length > 0 ? 'ready' : 'empty'

  const tray = trayOpen
    ? (
      <div className="a-brain-tray">
        {firstLink && <LinkPreview url={firstLink} />}

        {attachments.length > 0 && (
          <div className="a-brain-chips">
            {attachments.map(a => (
              <Chip
                key={a.id}
                icon={a.kind === 'image' ? 'image' : 'doc'}
                onRemove={() => removeAttachment(a.id)}
                removeLabel={`Remove ${a.name}`}
              >
                <span className="a-nowrap">{a.name}</span>
                <span className="a-mono a-dim">{fileSize(a.size)}</span>
              </Chip>
            ))}
          </div>
        )}

        {(recording || transcribing) && (
          <div className="a-brain-voice" data-voice={stt.state}>
            {recording && <LevelMeter elapsed={stt.elapsedMs / 1000} />}
            <span className="a-brain-voice-t">
              {recording ? `Listening. ${Math.floor(stt.elapsedMs / 1000)}s` : 'Writing down what you said.'}
            </span>
            {recording && (
              <Button variant="quiet" size="sm" onClick={stt.toggle}>Done</Button>
            )}
          </div>
        )}
        {!recording && !transcribing && heard && (
          <div className="a-brain-chips" data-voice="landed">
            <Chip icon="mic" onRemove={() => setHeard(null)} removeLabel="Dismiss what was heard">
              <span className="a-dim">Heard</span>
              <span className="a-nowrap">{heard}</span>
            </Chip>
          </div>
        )}
        {stt.note && <span className="a-brain-note">{stt.note}</span>}
      </div>
    )
    : undefined

  return (
    <div ref={wrapRef} className="a-brain-composer">
      <input
        ref={fileRef} type="file" accept="image/*,application/pdf" multiple hidden
        onChange={e => { onFiles(e.target.files); e.target.value = '' }}
      />
      <DsComposer
        value={value}
        onChange={v => { onChange(v); setHeard(null) }}
        onSend={doSend}
        onStop={onStop}
        onAttach={() => fileRef.current?.click()}
        onDictate={stt.supported ? () => { if (!transcribing) stt.toggle() } : undefined}
        placeholder={placeholder}
        mode={mode}
        tray={tray}
        note={attachments.length > 0 ? 'attachment stays on this phone for now' : undefined}
      />
    </div>
  )
}
