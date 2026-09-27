import { useEffect, useRef, useState, type ReactNode } from 'react'
import { matchCommands, type Command } from '../../wb/ask/commands'
import { useStt } from '../../exp/v2c/chat/useStt'
import { warsawHm } from '../ui/time'
import { useClaude } from './ClaudeProvider'
import { CIcon } from './icons'
import { Slash, runCommand, slashKey } from './Slash'

// The composer. Today's behaviour, D's drawing: Enter or ⌘↩ sends, Shift+Enter
// is a new line, ⌘D dictates (today's `inbox-stt`), the clip attaches a photo
// or a PDF (today: the file stays on this device and the message carries an
// `[attached: name]` line per file), `/` opens today's commands, and while a
// turn runs the round key is Stop. Asking never sends a DM.

type Att = { id: string; name: string; kind: 'image' | 'pdf' | 'pasted'; url: string }

const FIELD_MAX = 140

/** The message that leaves: the text, then one `[attached: name]` line per file (today's Composer). */
export function outgoing(text: string, atts: { name: string }[]): string {
  return [text.trim(), ...atts.map(a => `[attached: ${a.name}]`)].join('\n')
}

export function Composer({ placeholder, onSend, lead }: {
  placeholder: string
  /** Hands the finished message to the drawer, which adds what is attached. */
  onSend: (message: string) => void
  /** Extra keys at the left of the row (the runner menu). */
  lead?: ReactNode
}) {
  const { chat, online, text, setText, savedAt } = useClaude()
  const [atts, setAtts] = useState<Att[]>([])
  const [cursor, setCursor] = useState(0)
  const field = useRef<HTMLTextAreaElement>(null)
  const files = useRef<HTMLInputElement>(null)
  const stt = useStt(t => {
    setText(text.trim() ? `${text.replace(/\s+$/, '')} ${t}` : t)
    field.current?.focus()
  })
  const cmds = matchCommands(text)
  const blocked = chat.busy || chat.runningElsewhere || !online
  const canSend = text.trim().length > 0 && !blocked
  const recording = stt.state === 'recording'

  // ⌘D dictates while the drawer is open (the frame binds only ⌘K and ⌘J).
  const toggleRef = useRef(stt.toggle)
  toggleRef.current = stt.toggle
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'd' || e.key === 'D')) { e.preventDefault(); toggleRef.current() }
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [])

  // The field grows with what is in it.
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
        id: `${f.name}:${f.size}:${f.lastModified}`,
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

  const send = () => {
    if (!canSend) return
    onSend(outgoing(text, atts))
    for (const a of atts) URL.revokeObjectURL(a.url)
    setAtts([])
  }
  const pick = (c: Command) => runCommand(c, chat, setText)

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); send(); return }
    if (slashKey(e, cmds, cursor, setCursor, pick, () => setText(''))) { e.preventDefault(); return }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send() }
  }

  return (
    <div className="dcl-cmp">
      <Slash text={text} chat={chat} cursor={cursor} pick={pick} />
      {!online && <div className="dcl-off" role="status">Offline{savedAt ? ` · saved ${warsawHm(savedAt)}` : ''}. You can type; nothing leaves until you are back.</div>}
      {atts.length > 0 && (
        <div className="dcl-atts">
          {atts.map(a => (
            <span key={a.id} className="dcl-att">
              <em>{a.kind === 'pdf' ? 'PDF' : a.kind === 'pasted' ? 'PASTED' : 'IMAGE'}</em>
              <span>{a.name}</span>
              <button type="button" data-verb="remove-attachment" aria-label={`Remove ${a.name}`} onClick={() => drop(a.id)}><CIcon name="x" /></button>
            </span>
          ))}
          <span className="dcl-dim">The file stays on this device for now; Claude gets its name.</span>
        </div>
      )}
      {(recording || stt.state === 'transcribing' || stt.note) && (
        <div className="dcl-rec" role="status">
          {recording ? `Listening ${Math.round(stt.elapsedMs / 1000)}s · press the mic or ⌘D to stop` : stt.state === 'transcribing' ? 'Writing down what you said…' : stt.note}
        </div>
      )}
      <div className="dcl-box">
        <textarea
          ref={field} rows={2} value={text} placeholder={placeholder} aria-label="Message to Claude"
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
          {lead}
          <span className="dcl-hint">⌘↩ send · / commands · never sends a DM</span>
          {chat.busy
            ? <button type="button" className="dcl-go dcl-stop" data-verb="stop" aria-label="Stop Claude" title="Stop" onClick={chat.abort}><CIcon name="stop" /></button>
            : <button type="button" className="dcl-go" data-verb="send" aria-label="Send to Claude" title="Send (⌘↩)" disabled={!canSend} onClick={send}><CIcon name="up" /></button>}
        </div>
      </div>
    </div>
  )
}
