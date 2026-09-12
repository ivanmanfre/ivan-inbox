/* ==========================================================================
   src/wb/ask/Composer.tsx: S30.

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
import { Button, Chip, Composer as DsComposer, IconButton, LevelMeter, type ComposerMode } from '../../ds'
import { detectLinks } from '../../lib/unfurl'
import { useStt } from '../../exp/v2c/chat/useStt'
import { fileSize } from './forms'
import { LinkPreview } from './LinkPreview'
import { VoiceNote } from './VoiceNote'
import './ask.css'

/** Three kinds, because move 14 asks the chip to say WHICH: a file he chose, a
 * document he chose, or something he pasted straight in. */
type AttachKind = 'image' | 'pdf' | 'pasted'
type Attachment = { id: string; kind: AttachKind; name: string; size: number; url: string }

const ATTACH_BADGE: Record<AttachKind, string> = { image: 'IMAGE', pdf: 'PDF', pasted: 'PASTED' }
const ATTACH_ICON: Record<AttachKind, 'image' | 'doc'> = { image: 'image', pdf: 'doc', pasted: 'image' }

/** How tall the field may grow before it starts scrolling under the caret. */
const FIELD_MAX = 120

/**
 * What a HOST can add to this composer without the composer knowing what it is.
 *
 * The docked desktop pane (S15) owns a slash palette; the phone composer (S30)
 * does not and the ledger says so in writing. So the palette is not built in
 * here: the pane passes an overlay to draw above the bar, a keydown filter that
 * gets first refusal on the four palette keys, and a send interceptor so the
 * send BUTTON obeys the palette too — which is the one path that used to send a
 * literal "/model haiku" to the model.
 */
export type ComposerExtras = {
  /** Drawn above the bar, in the same overlay grammar the tray uses. */
  overlay?: React.ReactNode
  /** Return true to swallow the key: the composer then does nothing with it. */
  onKeyDown?: (e: React.KeyboardEvent) => boolean
  /** Return true if the press was handled (a command ran) instead of sending. */
  interceptSend?: () => boolean
}

/**
 * The chord that sends regardless of what plain Enter is doing right now.
 *
 * Plain Enter already sends (the design system's own `Composer` reads it off
 * the textarea, `!e.shiftKey`), and a host's palette can swallow plain Enter
 * for its own purpose (picking a highlighted item). Cmd/Ctrl+Enter is the
 * operator overriding that: it must send even when the palette is open, so
 * it is checked in the WRAPPER, in capture phase, ahead of the field. Pure so
 * the decision is unit-testable without a DOM.
 */
export function isSendChord(e: { key: string; metaKey: boolean; ctrlKey: boolean }): boolean {
  return e.key === 'Enter' && (e.metaKey || e.ctrlKey)
}

export function Composer({ value, onChange, onSend, busy, runningElsewhere, onStop, placeholder, extras, runner }: {
  value: string
  onChange: (v: string) => void
  onSend: (text: string) => void
  busy: boolean
  runningElsewhere: boolean
  onStop: () => void
  placeholder: string
  extras?: ComposerExtras
  /** The "Run on the runner" strip, drawn on its own line above the bar.
   * A node rather than a built-in control for the same reason `extras` is one:
   * the composer draws what it is handed and knows nothing about jobs. */
  runner?: React.ReactNode
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
    if (extras?.interceptSend?.()) return
    if (!canSend) return
    const lines = [value.trim()]
    for (const a of attachments) lines.push(`[attached: ${a.name}]`)
    onSend(lines.join('\n'))
    setHeard(null)
    setAttachments(prev => {
      for (const a of prev) URL.revokeObjectURL(a.url)
      return []
    })
  }, [canSend, value, attachments, onSend, extras])

  useEffect(() => () => {
    for (const a of attachments) URL.revokeObjectURL(a.url)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onFiles = (files: FileList | null, pasted = false) => {
    if (!files) return
    const next: Attachment[] = []
    for (const f of Array.from(files)) {
      const isPdf = f.type === 'application/pdf'
      const isImg = f.type.startsWith('image/')
      if (!isPdf && !isImg) continue
      next.push({
        id: `${f.name}:${f.size}:${f.lastModified}`,
        kind: pasted && isImg ? 'pasted' : isPdf ? 'pdf' : 'image',
        // A pasted image arrives from the clipboard with no name of its own;
        // the chip says what it is rather than printing the browser's
        // "image.png" as though he had chosen a file called that.
        name: pasted && isImg && /^image\.\w+$/i.test(f.name) ? 'Pasted image' : f.name,
        size: f.size,
        url: URL.createObjectURL(f),
      })
    }
    if (next.length) setAttachments(prev => [...prev, ...next])
  }

  /** Move 14's third kind. An image on the clipboard becomes an attachment
   * instead of nothing at all; pasted TEXT is left alone, because a paste into
   * a text field is already the thing it means. */
  const onPaste = (e: React.ClipboardEvent) => {
    const files = e.clipboardData?.files
    if (!files || files.length === 0) return
    const images = Array.from(files).filter(f => f.type.startsWith('image/') || f.type === 'application/pdf')
    if (!images.length) return
    e.preventDefault()
    const dt = new DataTransfer()
    for (const f of images) dt.items.add(f)
    onFiles(dt.files, true)
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
  const trayOpen = !!firstLink || attachments.length > 0 || recording || transcribing || !!heard || !!stt.clip || !!stt.note

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
                icon={ATTACH_ICON[a.kind]}
                onRemove={() => removeAttachment(a.id)}
                removeLabel={`Remove ${a.name}`}
              >
                {/* Move 14: the chip says WHAT it is, then what it is called,
                    then how big it is. The badge is the type, not a colour. */}
                <span className="a-brain-badge">{ATTACH_BADGE[a.kind]}</span>
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
        {/* Move 15's third beat. What landed is a CARD, not a chip: the
            transcript is a sentence and a chip is a label. Beside it sits the
            recording itself — playable, its real length, and a waveform
            decoded out of that very audio. Nothing here is drawn from a clock.

            It is a HEARD note rather than a sent one because this app has no
            path that sends audio: dictation drafts, the operator sends (the
            ledger says so in `useStt`'s own header). A bubble claiming a voice
            note went to Claude would be a claim the transport does not hold. */}
        {!recording && !transcribing && (heard || stt.clip) && (
          <div className="a-brain-heard" data-voice="landed">
            {stt.clip && <VoiceNote clip={stt.clip} />}
            {heard && (
              <div className="a-brain-heard-t">
                <span className="a-dim">Heard</span>
                <span>{heard}</span>
              </div>
            )}
            <IconButton
              icon="close" size="sm" label="Dismiss what was heard"
              onClick={() => { setHeard(null); stt.clearClip() }}
            />
          </div>
        )}
        {stt.note && <span className="a-brain-note">{stt.note}</span>}
      </div>
    )
    : undefined

  return (
    /* `data-ask` marks the ask composer for anything outside it that has to
       find it: the deep-link probe, and the seat that focuses it after a
       dictation. The design system owns the field, so the mark rides the
       wrapper the same way the focus does. */
    <div
      ref={wrapRef} data-ask className="a-brain-composer"
      // Capture, so the host's palette gets the four keys BEFORE the design
      // system's textarea reads Enter as send. The palette gets first refusal;
      // only once it declines does Cmd/Ctrl+Enter get to force a send here,
      // ahead of the field, so it works even while the palette owns plain
      // Enter for its own selection.
      onKeyDownCapture={e => {
        if (extras?.onKeyDown?.(e)) { e.preventDefault(); e.stopPropagation(); return }
        if (isSendChord(e)) { e.preventDefault(); e.stopPropagation(); doSend() }
      }}
    >
      <input
        ref={fileRef} type="file" accept="image/*,application/pdf" multiple hidden
        onChange={e => { onFiles(e.target.files); e.target.value = '' }}
      />
      {extras?.overlay}
      {runner}
      <span className="a-brain-paste" onPaste={onPaste}>
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
      </span>
    </div>
  )
}
