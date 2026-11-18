// The desk's composer: text, a photo (camera or library on the iPhone), voice
// through the server-side inbox-stt broker (the transcript lands in the field and
// Ivan sends it, the standing dictation rule), and links pasted as text (the
// backend decides what a link is). Every key is 44 px.
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useStt } from '../../exp/v2c/chat/useStt'
import { CIcon } from '../claude/icons'
import { uploadDeskPhoto } from './api'
import type { DeskAttachment } from './model'

export function DeskComposer({ busy, onSend, prefill }: {
  busy: boolean
  onSend: (text: string, opts?: { attachments?: DeskAttachment[]; voice?: boolean }) => void
  /** "Edit and send": this text goes into the field (each new n once); Send stays Ivan's own tap. */
  prefill?: { text: string; n: number } | null
}) {
  const [text, setText] = useState('')
  // Picked photos stay on the device (a local preview) until Send; nothing is uploaded before that.
  const [photos, setPhotos] = useState<{ id: string; file: File; preview: string }[]>([])
  const [uploading, setUploading] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const voiced = useRef(false)
  // Every edit (typing or dictation) bumps the revision; an upload that finishes clears the field and
  // the voice mark only if nothing was edited since its Send (Sol desk-ui r3 #6).
  const rev = useRef(0)
  const edit = (fn: (prev: string) => string) => { rev.current++; setText(fn) }
  const field = useRef<HTMLTextAreaElement>(null)
  const file = useRef<HTMLInputElement>(null)
  const stt = useStt(t => {
    voiced.current = true
    edit(prev => (prev.trim() ? `${prev.trim()} ${t}` : t))
    field.current?.focus()
  })
  const recording = stt.state === 'recording'
  // Each new prefill (a new n) replaces the field once; it never sends.
  const applied = useRef(0)
  useEffect(() => {
    if (!prefill || prefill.n === applied.current) return
    applied.current = prefill.n
    rev.current++
    setText(prefill.text)
    voiced.current = false
    field.current?.focus()
  }, [prefill])

  // Autosize: one line to six, measured, so the list above never jumps by a guess.
  useLayoutEffect(() => {
    const el = field.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 6 * 21 + 18)}px`
  }, [text])

  // Free every preview the composer still holds when it goes away.
  const held = useRef(photos)
  held.current = photos
  useEffect(() => () => { held.current.forEach(p => URL.revokeObjectURL(p.preview)) }, [])

  const canSend = !busy && !uploading && (text.trim().length > 0 || photos.length > 0)
  const send = async () => {
    if (!canSend) return
    // What THIS tap sends. Anything typed, dictated or picked while the photos upload is a new draft
    // and stays in the composer (Sol desk-ui r2 #7).
    const sentText = text
    const sentVoice = voiced.current
    const sentPhotos = photos
    const sentRev = rev.current
    let attachments: DeskAttachment[] | undefined
    if (sentPhotos.length) {
      setUploading(true); setNote(null)
      try {
        attachments = []
        for (const p of sentPhotos) attachments.push({ kind: 'photo', url: await uploadDeskPhoto(p.file) })
      } catch (e) {
        // Nothing was sent: the text and the photos stay for another try.
        setNote(e instanceof Error ? e.message : 'The photo did not upload.')
        setUploading(false)
        return
      }
      setUploading(false)
    }
    onSend(sentText, { attachments, voice: sentVoice || undefined })
    sentPhotos.forEach(p => URL.revokeObjectURL(p.preview))
    const gone = new Set(sentPhotos.map(p => p.id))
    setPhotos(ps => ps.filter(p => !gone.has(p.id)))
    setNote(null)
    if (rev.current === sentRev) { setText(''); voiced.current = false; stt.clearClip() }
  }
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send() }
  }
  const pick = (f: File | undefined) => {
    if (file.current) file.current.value = ''
    if (!f) return
    if (!/^image\//.test(f.type)) { setNote('That file is not an image. Pick a JPG, PNG or WebP.'); return }
    if (f.size > 15 * 1024 * 1024) { setNote('That image is over 15 MB. Pick a smaller one.'); return }
    setNote(null)
    setPhotos(p => [...p, { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, file: f, preview: URL.createObjectURL(f) }])
  }
  const remove = (id: string) => setPhotos(ps => {
    const gone = ps.find(x => x.id === id)
    if (gone) URL.revokeObjectURL(gone.preview)
    return ps.filter(x => x.id !== id)
  })

  return (
    <div className="dk-comp" data-desk-composer>
      {(recording || stt.state === 'transcribing' || stt.note || note || uploading) && (
        <div className="dk-comp-note" role="status">
          {recording ? `Listening ${Math.round(stt.elapsedMs / 1000)}s` : stt.state === 'transcribing' ? 'Writing down what you said' : uploading ? 'Sending your photo' : note ?? stt.note}
        </div>
      )}
      {photos.length > 0 && (
        <div className="dk-comp-ph">
          {photos.map(p => (
            <span key={p.id} className="dk-comp-thumb">
              <img src={p.preview} alt="" width={56} height={56} />
              <button type="button" aria-label="Remove photo" disabled={uploading} onClick={() => remove(p.id)}><CIcon name="x" /></button>
            </span>
          ))}
        </div>
      )}
      <div className="dk-comp-row">
        <button type="button" className="dk-key" aria-label="Add a photo" disabled={uploading} onClick={() => file.current?.click()}>
          {uploading ? <span className="dk-spin" aria-hidden="true" /> : <CIcon name="clip" />}
        </button>
        <input ref={file} type="file" accept="image/*" hidden onChange={e => pick(e.target.files?.[0])} data-desk-photo />
        <textarea
          ref={field} rows={1} value={text} onChange={e => { const v = e.target.value; edit(() => v) }} onKeyDown={onKey}
          placeholder="Ask, or paste a link" aria-label="Message the desk" enterKeyHint="send"
        />
        {stt.supported && (
          <button type="button" className={`dk-key${recording ? ' dk-rec' : ''}`} aria-label={recording ? 'Stop and write it down' : 'Talk'}
            disabled={stt.state === 'transcribing'} onClick={stt.toggle}>
            <CIcon name={recording ? 'stop' : 'mic'} />
          </button>
        )}
        <button type="button" className="dk-key dk-send" aria-label="Send" disabled={!canSend} onClick={() => void send()}><CIcon name="up" /></button>
      </div>
    </div>
  )
}
