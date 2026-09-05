/* =========================================================================
   Direction B - S30, the composer.

   Copied from `src/exp/brain/b/skins/b/Composer.tsx`. Every hook, its call
   order, the attachment lifecycle (including both `URL.revokeObjectURL`
   paths), the auto-grow effect, `doSend`'s exact join with its
   `[attached: name]` lines, the keyboard binding (Enter sends, Shift+Enter
   makes a newline) and every string are the source's. Only the view changed.

   MOVE 13. ONE round control that swaps between send, typing and stop: the
   same `IconButton round` in the same seat, accent-filled the moment there is
   something to send, `stop` while a turn is open. The bar and the tray are
   `motion.div layout` on the one spring, so the composer SPRINGS its height as
   its mode changes and no rule animates `height` (refs: Send Button,
   serafimcloud; Family Sign-in Drawer, stackingsu).

   MOVE 14. Attachments are type-badged previews with the remove control ON the
   chip (`Chip` + `onRemove`). The badge is the kind's own mark and a
   `data-kind`; the source knows two kinds and this composer has no paste
   handler, so no third badge is drawn for a path that does not exist (refs:
   Claude Style AI Input, suraj-xd; File Attachment, serafimcloud).

   MOVE 15. Voice: the mic becomes a recording state with the design system's
   `LevelMeter` and a mono timer, and what was heard arrives word by word under
   it. This is wired to the dictation path the source already has and to
   nothing else. `useStt` is BATCH dictation over a broker and it exposes no
   partial transcript and no recorded blob, so there is no partial stream to
   read and no voice note to send: the reveal is the transcript landing, and
   the waveform bubble that a sent note would carry is not drawn, because
   drawing it would mean inventing a recording write (refs: AI Voice Input,
   kokonutd; Voice Dictator, uicapsule; Voice Message Bubble, ruixen).
   ========================================================================= */
import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Button, Chip, Icon, IconButton, LevelMeter, fade, spring } from '../../../ds'
import { detectLinks } from '../../../lib/unfurl'
import { useStt } from '../../../exp/v2c/chat/useStt'
import { LinkPreview } from './LinkPreview'
import { Words } from './AnswerBody'
import { fileSize } from '../../../exp/brain/b/skins/b/forms'

type Attachment = { id: string; kind: 'image' | 'pdf'; name: string; size: number; url: string }

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
  const stopping = busy || runningElsewhere
  const mode = stopping ? 'busy' : recording ? 'recording' : canSend ? 'ready' : 'empty'

  return (
    <div className="ds-composer dirb-ask-comp" data-mode={mode}>
      <AnimatePresence initial={false}>
        {trayOpen && (
          <motion.div
            key="tray" layout transition={spring}
            variants={fade} initial="hidden" animate="show" exit="exit"
            className="ds-composer-tray dirb-ask-tray"
          >
            {firstLink && <LinkPreview url={firstLink} />}

            {attachments.length > 0 && (
              <div className="dirb-ask-chips" data-attach-row>
                {attachments.map(a => (
                  <span key={a.id} className="dirb-ask-att-seat" data-attach data-kind={a.kind}>
                  <Chip
                    className="dirb-ask-att"
                    onRemove={() => removeAttachment(a.id)} removeLabel={`Remove ${a.name}`}
                  >
                    {a.kind === 'image'
                      ? <img className="dirb-ask-att-thumb" src={a.url} alt="" />
                      : <Icon name="doc" size={16} />}
                    <span className="dirb-ask-att-n dirb-truncate">{a.name}</span>
                    <span className="ds-t-mono dirb-dim">{fileSize(a.size)}</span>
                  </Chip>
                  </span>
                ))}
                <span className="dirb-ask-att-note ds-t-meta dirb-dim">attachment stays on this phone for now</span>
              </div>
            )}

            {(recording || transcribing) && (
              <div className="dirb-ask-voice" data-voice={stt.state}>
                {recording ? (
                  <>
                    <LevelMeter elapsed={stt.elapsedMs / 1000} />
                    <span className="dirb-ask-voice-n ds-t-mono">{`Listening. ${Math.floor(stt.elapsedMs / 1000)}s`}</span>
                    <span className="dirb-grow" />
                    <Button size="sm" variant="quiet" data-tap onClick={stt.toggle}>Done</Button>
                  </>
                ) : (
                  <>
                    <Icon name="mic" size={16} />
                    <span className="dirb-ask-voice-t ds-t-meta">Writing down what you said.</span>
                  </>
                )}
              </div>
            )}

            {!recording && !transcribing && heard && (
              <span className="dirb-ask-heard-seat" data-voice="landed">
              <Chip
                className="dirb-ask-heard"
                onRemove={() => setHeard(null)} removeLabel="Dismiss what was heard"
              >
                <span className="ds-t-eyebrow dirb-dim">Heard</span>
                <span className="dirb-ask-heard-t"><Words text={heard} /></span>
              </Chip>
              </span>
            )}

            {stt.note && <span className="dirb-ask-note ds-t-meta dirb-dim">{stt.note}</span>}
          </motion.div>
        )}
      </AnimatePresence>

      <motion.div layout transition={spring} className="ds-composer-bar dirb-ask-bar-row">
        <input
          ref={fileRef} type="file" accept="image/*,application/pdf" multiple hidden
          onChange={e => { onFiles(e.target.files); e.target.value = '' }}
        />
        <IconButton
          icon="attach" label="Attach a file" size="sm" data-tap
          onClick={() => fileRef.current?.click()}
        />
        {stt.supported && (
          <IconButton
            icon={transcribing ? 'loading' : 'mic'}
            label={recording ? 'Stop recording' : 'Dictate'}
            size="sm" active={recording} disabled={transcribing}
            data-mic data-tap onClick={stt.toggle}
          />
        )}
        <textarea
          ref={fieldRef}
          className="ds-composer-input"
          data-ask
          rows={1}
          placeholder={placeholder}
          aria-label={placeholder}
          value={value}
          onChange={e => { onChange(e.target.value); setHeard(null) }}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend() }
          }}
        />
        {stopping ? (
          <IconButton
            icon="stop" label="Stop" variant="accent" round
            data-stop data-tap onClick={onStop}
          />
        ) : (
          <IconButton
            icon="send" label="Send" variant={canSend ? 'accent' : 'solid'} round
            disabled={!canSend} data-send data-tap onClick={doSend}
          />
        )}
      </motion.div>
    </div>
  )
}
