// The pane's hardware keys and the free-typed composer.
// HOLD TO SEND: a press opens the confirm (keyboard and a plain tap always reach it); holding the
// key 0.6 s is the confirm itself, as the mock's "Send · hold" says. Discard always asks first.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Key } from '../ui/Key'

const HOLD_MS = 600

export function HoldKey({ children, sub = 'hold', verb, disabled, onPress, onHold }: {
  children: ReactNode; sub?: ReactNode; verb: string; disabled?: boolean; onPress: () => void; onHold: () => void
}) {
  const timer = useRef<number | null>(null)
  const held = useRef(false)
  const [pressing, setPressing] = useState(false)
  const stop = () => { if (timer.current !== null) { window.clearTimeout(timer.current); timer.current = null } setPressing(false) }
  useEffect(() => stop, [])
  return (
    <Key primary verb={verb} sub={sub} disabled={disabled} className={pressing ? 'dm-holding' : undefined}
      onPointerDown={e => {
        if (disabled || e.button !== 0) return
        held.current = false
        setPressing(true)
        timer.current = window.setTimeout(() => { timer.current = null; held.current = true; setPressing(false); onHold() }, HOLD_MS)
      }}
      onPointerUp={stop} onPointerLeave={stop} onPointerCancel={stop}
      onClick={() => { if (held.current) { held.current = false; return } onPress() }}
    >{children}</Key>
  )
}

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
export function Composer({ to, from, big, disabled, note, value, setValue, onSend, onHoldSend, busy }: {
  to: string; from: string; big: boolean; disabled?: string | null; note?: string
  value: string; setValue: (s: string) => void; onSend: () => void; onHoldSend: () => void; busy: boolean
}) {
  const dict = useDictate(s => setValue((value ? value + ' ' : '') + s.trim()))
  const [focus, setFocus] = useState(false)
  if (disabled) return <div className="dm-comp dm-comp-off" role="note">{disabled}</div>
  const grown = big || focus || value.length > 0
  return (
    <div className={`dm-comp${grown ? ' dm-comp-big' : ''}`}>
      <textarea
        aria-label={`Write to ${to} yourself`}
        placeholder={big ? `Write to ${to} as ${from}…` : `Or write it yourself to ${to}…`}
        value={value} rows={grown ? 4 : 1}
        onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); onSend() } }}
      />
      <div className="dm-comp-r">
        {dict.can && <button type="button" className={`dm-ib${dict.on ? ' dm-on' : ''}`} aria-label={dict.on ? 'Stop dictating' : 'Dictate'} onClick={dict.toggle}><Mic /></button>}
        {grown && <em>{note ?? `Sends from ${from === 'you' ? 'your' : `${from}'s`} LinkedIn · ⌘↩ or hold Send`}</em>}
        {value.trim() && (
          <HoldKey verb="compose-send" disabled={busy} onPress={onSend} onHold={onHoldSend}>Send</HoldKey>
        )}
      </div>
    </div>
  )
}
