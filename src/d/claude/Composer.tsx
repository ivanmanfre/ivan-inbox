import { useEffect, useRef, useState, type ReactNode } from 'react'
import { matchCommands, type Command } from '../../wb/ask/commands'
import { useStt } from '../../exp/v2c/chat/useStt'
import { detectLinks } from '../../lib/unfurl'
import { fileSize } from '../../wb/ask/forms'
import { warsawHm } from '../ui/time'
import { useClaude } from './ClaudeProvider'
import { Heard, Meter } from './Dictation'
import { CIcon } from './icons'
import { LinkCard } from './LinkCard'
import { Slash, runCommand, slashKey } from './Slash'

// The composer, today's behaviour in D's drawing. Enter sends on a keyboard
// (on touch Enter is a new line, the key sends), ⌘↩ always sends, and while
// the `/` list is open both run the highlighted command instead (today's
// interceptSend: "/model haiku" never reaches Claude as text). ⌘D dictates
// (inbox-stt), the clip attaches a photo or a PDF (the file stays on this
// device; the message carries `[attached: name]`), and while a turn runs here
// or elsewhere the round key is Stop. Asking never sends a DM.

type Att = { id: string; name: string; kind: 'image' | 'pdf' | 'pasted'; url: string; size: number }
const FIELD_MAX = 140

/** The message that leaves: the text, then one `[attached: name]` line per file (today's Composer). */
export function outgoing(text: string, atts: { name: string }[]): string {
  return [text.trim(), ...atts.map(a => `[attached: ${a.name}]`)].join('\n')
}

const isTouch = () => typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches

export function Composer({ placeholder, onSend, more, top }: {
  placeholder: string
  onSend: (message: string) => void
  /** The More key, built by the drawer (it owns the runner); handed the composer's own actions. */
  more: (a: { onCommands: () => void; onPaste: () => void }) => ReactNode
  /** Brief 4 (`claude` section): what travels (the context chips) drawn inside the well, above the field. */
  top?: ReactNode
}) {
  const { chat, online, text, setText, savedAt, stop, dictateOnOpen, clearDictateOnOpen } = useClaude()
  const [atts, setAtts] = useState<Att[]>([])
  const [cursor, setCursor] = useState(0)
  const [heard, setHeard] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const field = useRef<HTMLTextAreaElement>(null)
  const files = useRef<HTMLInputElement>(null)
  const stt = useStt(t => {
    setText(text.trim() ? `${text.replace(/\s+$/, '')} ${t}` : t)
    setHeard(t)
    field.current?.focus()
  })
  const cmds = matchCommands(text)
  const running = chat.busy || chat.runningElsewhere
  const canSend = text.trim().length > 0 && !running && online
  const recording = stt.state === 'recording'
  const link = detectLinks(text)[0]?.url

  const toggleRef = useRef(stt.toggle)
  toggleRef.current = stt.toggle
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'd' || e.key === 'D')) { e.preventDefault(); toggleRef.current() }
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [])
  // ⌘D pressed with the drawer closed: the drawer opened for it, so start listening.
  useEffect(() => {
    if (!dictateOnOpen) return
    clearDictateOnOpen()
    if (stt.supported && stt.state === 'idle') toggleRef.current()
  }, [dictateOnOpen, clearDictateOnOpen, stt.supported, stt.state])

  useEffect(() => {
    const el = field.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, FIELD_MAX)}px`
  }, [text])
  useEffect(() => { setCursor(0) }, [text])

  const addFiles = (list: FileList | File[] | null, pasted = false) => {
    if (!list) return
    const next: Att[] = []
    for (const f of Array.from(list)) {
      const pdf = f.type === 'application/pdf'
      const img = f.type.startsWith('image/')
      if (!pdf && !img) continue
      next.push({
        id: `${f.name}:${f.size}:${f.lastModified}`, size: f.size,
        kind: pasted && img ? 'pasted' : pdf ? 'pdf' : 'image',
        name: pasted && img && /^image\.\w+$/i.test(f.name) ? 'Pasted image' : f.name,
        url: URL.createObjectURL(f),
      })
    }
    if (next.length) setAtts(prev => [...prev, ...next.filter(n => !prev.some(p => p.id === n.id))])
  }
  const drop = (id: string) => setAtts(prev => {
    const hit = prev.find(a => a.id === id)
    if (hit) URL.revokeObjectURL(hit.url)
    return prev.filter(a => a.id !== id)
  })
  // Today's paste tile: an image on the clipboard becomes an attachment, text lands in the field.
  const pasteTile = async () => {
    try {
      const clip = navigator.clipboard as Clipboard & { read?: () => Promise<ClipboardItem[]> }
      if (clip.read) {
        const out: File[] = []
        for (const item of await clip.read()) {
          const type = item.types.find(t => t.startsWith('image/'))
          if (type) out.push(new File([await item.getType(type)], `image.${type.split('/')[1] || 'png'}`, { type }))
        }
        if (out.length) { addFiles(out, true); return }
      }
      const t = await navigator.clipboard.readText()
      if (t) setText(text.trim() ? `${text.replace(/\s+$/, '')} ${t}` : t)
    } catch { setNote('Paste was blocked. Long-press the field and paste there.') }
  }

  const pick = (c: Command) => runCommand(c, chat, setText)
  const send = () => {
    // The palette gets first refusal: a highlighted command runs, it never goes out as text.
    if (cmds.length) { pick(cmds[Math.min(cursor, cmds.length - 1)]); return }
    if (!canSend) return
    onSend(outgoing(text, atts))
    for (const a of atts) URL.revokeObjectURL(a.url)
    setAtts([]); setHeard(null); stt.clearClip()
  }
  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); send(); return }
    if (slashKey(e, cmds, cursor, setCursor, pick, () => setText(''))) { e.preventDefault(); return }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && !isTouch()) { e.preventDefault(); send() }
  }

  return (
    <div className="dcl-cmp">
      <Slash text={text} chat={chat} cursor={cursor} pick={pick} />
      {!online && <div className="dcl-off" role="status">Offline{savedAt ? ` · saved ${warsawHm(savedAt)}` : ''}. You can type; nothing leaves until you are back.</div>}
      {note && <div className="dcl-rec" role="status">{note} <button type="button" className="dcl-link" onClick={() => setNote(null)}>Dismiss</button></div>}
      {link && <LinkCard url={link} />}
      {atts.length > 0 && (
        <div className="dcl-atts">
          {atts.map(a => (
            <span key={a.id} className="dcl-att">
              <em>{a.kind === 'pdf' ? 'PDF' : a.kind === 'pasted' ? 'PASTED' : 'IMAGE'}</em>
              <span>{a.name}</span><small>{fileSize(a.size)}</small>
              <button type="button" data-verb="remove-attachment" aria-label={`Remove ${a.name}`} onClick={() => drop(a.id)}><CIcon name="x" /></button>
            </span>
          ))}
          <span className="dcl-dim">The file stays on this device for now; Claude gets its name.</span>
        </div>
      )}
      {recording && (
        <div className="dcl-rec" role="status">
          <Meter ms={stt.elapsedMs} /> Listening {Math.round(stt.elapsedMs / 1000)}s
          <button type="button" className="dcl-link" data-verb="dictate-done" onClick={stt.toggle}>Done</button>
        </div>
      )}
      {stt.state === 'transcribing' && <div className="dcl-rec" role="status">Writing down what you said…</div>}
      {!recording && stt.note && <div className="dcl-rec" role="status">{stt.note}</div>}
      {!recording && <Heard text={heard} clip={stt.clip} onDismiss={() => { setHeard(null); stt.clearClip() }} />}
      <div className="dcl-box">
        {top}
        <textarea
          ref={field} rows={2} value={text} placeholder={placeholder} aria-label="Message to Claude" enterKeyHint={isTouch() ? 'enter' : 'send'}
          onChange={e => setText(e.target.value)} onKeyDown={onKey}
          onPaste={e => {
            const fs = Array.from(e.clipboardData?.files ?? []).filter(f => f.type.startsWith('image/') || f.type === 'application/pdf')
            if (fs.length) { e.preventDefault(); addFiles(fs, true) }
          }}
        />
        <input ref={files} type="file" accept="image/*,application/pdf" multiple hidden onChange={e => { addFiles(e.target.files); e.target.value = '' }} />
        <div className="dcl-row">
          <button type="button" className="dcl-ib" data-verb="attach" aria-label="Attach a photo or file" title="Attach a photo or file" onClick={() => files.current?.click()}><CIcon name="clip" /></button>
          <button type="button" className={`dcl-ib${recording ? ' dcl-rec-on' : ''}`} data-verb="dictate" aria-pressed={recording}
            aria-label={recording ? 'Stop dictating' : 'Dictate (⌘D)'} title="Dictate (⌘D)" disabled={!stt.supported || stt.state === 'transcribing'} onClick={stt.toggle}><CIcon name="mic" /></button>
          {more({ onCommands: () => { setText('/'); field.current?.focus() }, onPaste: () => void pasteTile() })}
          <span className="dcl-hint"><span className="dcl-hint-k">⌘↩ send · / commands</span><span className="dcl-hint-p">asking never sends a DM</span></span>
          {running
            ? <button type="button" className="dcl-go dcl-stop" data-verb="stop" aria-label="Stop Claude" title="Stop" onClick={stop}><CIcon name="stop" /></button>
            : <button type="button" className="dcl-go" data-verb="send" aria-label="Send to Claude" title="Send (⌘↩)" disabled={!canSend && !cmds.length} onClick={send}><CIcon name="up" /></button>}
        </div>
      </div>
    </div>
  )
}
