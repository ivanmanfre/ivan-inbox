// The came-back tag in the thread head: "came back · 2d" beside the name. A tap says what they came
// back to (today's card line) and offers today's Dismiss (rpc came_back_dismiss, Undo on the receipt).
import { useEffect, useRef, useState } from 'react'
import { Btn } from '../ui/Key'
import type { CameTag } from './signals'

export function CameSignal({ tag, onDismiss }: { tag: CameTag; onDismiss: () => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const box = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('mousedown', onDown); window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey) }
  }, [open])
  return (
    <span className="dm-sigwrap" ref={box}>
      <button type="button" className="dm-sig" title={tag.title} aria-expanded={open} data-verb="came-back-tag" onClick={() => setOpen(o => !o)}>{tag.text}</button>
      {open && (
        <span className="dm-sigpop" role="dialog" aria-label="Came back">
          <span><b>{tag.name.split(' ')[0]} came back.</b> {tag.title}</span>
          <span><Btn verb="came-back-dismiss" disabled={busy} onClick={async () => { setBusy(true); await onDismiss(); setBusy(false); setOpen(false) }}>Dismiss</Btn></span>
        </span>
      )}
    </span>
  )
}
