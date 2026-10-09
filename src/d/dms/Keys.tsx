// The pane's free-typed composer.
// SEND ALWAYS ASKS: a press (or ⌘↩) opens the same confirm today's thread shows. There is no
// hold-to-send: today has no path that sends without the confirm, so D has none either.
import { useRef, useState } from 'react'
import { Key } from '../ui/Key'

export function Mic() {
  return <svg viewBox="0 0 24 24" className="d-ico" aria-hidden="true"><path d="M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zM6 11a6 6 0 0 0 12 0M12 17v4" /></svg>
}

type SpeechCtor = new () => { lang: string; interimResults: boolean; continuous: boolean; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onend: (() => void) | null; start: () => void; stop: () => void }

/** Dictation, where the browser has it. No key is drawn where it does not. */
function useDictate(onText: (s: string) => void) {
  const W = typeof window === 'undefined' ? null : (window as unknown as { SpeechRecognition?: SpeechCtor; webkitSpeechRecognition?: SpeechCtor })
  const Ctor = W?.SpeechRecognition ?? W?.webkitSpeechRecognition ?? null
  const [on, setOn] = useState(false)
  const rec = useRef<InstanceType<SpeechCtor> | null>(null)
  const toggle = () => {
    if (!Ctor) return
    if (on) { rec.current?.stop(); return }
    const r = new Ctor()
    r.lang = 'en-US'; r.interimResults = false; r.continuous = true
    r.onresult = e => { const last = e.results[e.results.length - 1]; if (last?.[0]) onText(last[0].transcript) }
    r.onend = () => setOn(false)
    rec.current = r; r.start(); setOn(true)
  }
  return { can: Boolean(Ctor), on, toggle }
}

/** "Or write it yourself to X…" (small under the keys) or the big box on no-draft / owner / waiting. */
export function Composer({ to, from, big, disabled, note, value, setValue, onSend, busy, noSend = false, sendLabel = 'Send' }: {
  to: string; from: string; big: boolean; disabled?: string | null; note?: string
  /** No draft: the key row's Send sends this box, so the box draws no Send of its own. */
  noSend?: boolean
  sendLabel?: string
  value: string; setValue: (s: string) => void; onSend: () => void; busy: boolean
}) {
  const dict = useDictate(s => setValue((value ? value + ' ' : '') + s.trim()))
  const [focus, setFocus] = useState(false)
  if (disabled) return <div className="dm-comp dm-comp-off" role="note">{disabled}</div>
  const grown = big || focus || value.length > 0
  return (
    <div className={`dm-comp${grown ? ' dm-comp-big' : ''}`}>
      <textarea
        aria-label={`Write to ${to} yourself`}
        placeholder={big || noSend ? `Write to ${to} as ${from}…` : `Or write it yourself to ${to}…`}
        value={value} rows={grown ? 4 : 1}
        onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); if (!busy && value.trim()) onSend() } }}
      />
      <div className="dm-comp-r">
        {dict.can && <button type="button" className={`dm-ib${dict.on ? ' dm-on' : ''}`} aria-label={dict.on ? 'Stop dictating' : 'Dictate'} onClick={dict.toggle}><Mic /></button>}
        {grown && <em className={note ? undefined : 'dm-comp-hint'}>{note ?? `Sends from ${from === 'you' ? 'your' : `${from}'s`} LinkedIn · ⌘↩ or Send, it asks first`}</em>}
        {value.trim() && !noSend && (
          <Key primary verb="compose-send" aria-label={sendLabel} disabled={busy} onClick={onSend}>{sendLabel}</Key>
        )}
      </div>
    </div>
  )
}
