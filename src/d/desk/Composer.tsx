// The desk's composer: text, a photo (camera or library on the iPhone), voice
// through the server-side inbox-stt broker (the transcript lands in the field and
// Ivan sends it, the standing dictation rule), and links pasted as text (the
// backend decides what a link is). Every key is 44 px.
import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useStt } from '../../exp/v2c/chat/useStt'
import { CIcon } from '../claude/icons'
import { uploadDeskPhoto } from './api'
import type { DeskAttachment } from './model'

export function DeskComposer({ busy, onSend }: {
  busy: boolean
  onSend: (text: string, opts?: { attachments?: DeskAttachment[]; voice?: boolean }) => void
}) {
  const [text, setText] = useState('')
  const [photos, setPhotos] = useState<DeskAttachment[]>([])
  const [uploading, setUploading] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const voiced = useRef(false)
  const field = useRef<HTMLTextAreaElement>(null)
  const file = useRef<HTMLInputElement>(null)
  const stt = useStt(t => {
    voiced.current = true
    setText(prev => (prev.trim() ? `${prev.trim()} ${t}` : t))
    field.current?.focus()
  })
  const recording = stt.state === 'recording'

  // Autosize: one line to six, measured, so the list above never jumps by a guess.
  useLayoutEffect(() => {
    const el = field.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 6 * 21 + 18)}px`
  }, [text])

  const canSend = !busy && !uploading && (text.trim().length > 0 || photos.length > 0)
  const send = () => {
    if (!canSend) return
    onSend(text, { attachments: photos.length ? photos : undefined, voice: voiced.current || undefined })
    setText(''); setPhotos([]); setNote(null); voiced.current = false; stt.clearClip()
  }
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send() }
  }
  const pick = async (f: File | undefined) => {
    if (!f) return
    setUploading(true); setNote(null)
    try {
      const url = await uploadDeskPhoto(f)
      setPhotos(p => [...p, { kind: 'photo', url, name: f.name }])
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'The photo did not upload.')
    } finally {
      setUploading(false)
      if (file.current) file.current.value = ''
    }
  }

  return (
    <div className="dk-comp" data-desk-composer>
      {(recording || stt.state === 'transcribing' || stt.note || note) && (
        <div className="dk-comp-note" role="status">
          {recording ? `Listening ${Math.round(stt.elapsedMs / 1000)}s` : stt.state === 'transcribing' ? 'Writing down what you said' : note ?? stt.note}
        </div>
      )}
      {photos.length > 0 && (
        <div className="dk-comp-ph">
          {photos.map(p => (
            <span key={p.url} className="dk-comp-thumb">
              <img src={p.url} alt="" width={56} height={56} />
              <button type="button" aria-label="Remove photo" onClick={() => setPhotos(ps => ps.filter(x => x.url !== p.url))}><CIcon name="x" /></button>
            </span>
          ))}
        </div>
      )}
      <div className="dk-comp-row">
        <button type="button" className="dk-key" aria-label="Add a photo" disabled={uploading} onClick={() => file.current?.click()}>
          {uploading ? <span className="dk-spin" aria-hidden="true" /> : <CIcon name="clip" />}
        </button>
        <input ref={file} type="file" accept="image/*" hidden onChange={e => void pick(e.target.files?.[0])} data-desk-photo />
        <textarea
          ref={field} rows={1} value={text} onChange={e => setText(e.target.value)} onKeyDown={onKey}
          placeholder="Ask, or paste a link" aria-label="Message the desk" enterKeyHint="send"
        />
        {stt.supported && (
          <button type="button" className={`dk-key${recording ? ' dk-rec' : ''}`} aria-label={recording ? 'Stop and write it down' : 'Talk'}
            disabled={stt.state === 'transcribing'} onClick={stt.toggle}>
            <CIcon name={recording ? 'stop' : 'mic'} />
          </button>
        )}
        <button type="button" className="dk-key dk-send" aria-label="Send" disabled={!canSend} onClick={send}><CIcon name="up" /></button>
      </div>
    </div>
  )
}
