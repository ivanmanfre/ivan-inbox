import { useEffect, useRef, useState } from 'react'
import { CLAUDE_MODELS } from '../../lib/claude'
import { RunnerError, fetchSpecs, type GoalSpec } from '../../wb/ask/jobs'
import type { ChatHandle } from '../../exp/v2c/useChat'
import { CIcon } from './icons'
import type { DRunner } from './Runner'

// The composer's "More" key: today's composer overflow in one D menu.
//  - Commands: puts `/` in the field (today's commands tile).
//  - Paste (phone): today's paste tile, an image becomes an attachment.
//  - Model: today's model list with "the last turn ran on…" (AskPane), a pick
//    applies to the next turn only (`chat.setWanted`, never quietly dropped).
//  - Runner: run what is typed, or a goal spec off disk (wb/ask/Runner.tsx).

export const MODEL_OPTIONS: { id: string | null; label: string; note: string }[] = [
  { id: null, label: 'Claude default', note: 'Whatever Claude booted with' },
  ...CLAUDE_MODELS.map(m => ({ id: m.id as string, label: m.label, note: m.note })),
]

/** Today's modelLabel (AskPane): the family name for a dated id, never an invented name. */
export function modelLabel(id: string | null): string {
  if (!id || id === 'container-default') return 'default'
  const exact = MODEL_OPTIONS.find(m => m.id === id)
  if (exact) return exact.label
  return MODEL_OPTIONS.find(m => m.id && id.startsWith(m.id))?.label ?? id
}

export function modelNote(chat: Pick<ChatHandle, 'model' | 'wanted'>): string {
  return chat.model ? `The last turn ran on ${modelLabel(chat.model)}.` : chat.wanted ? `${modelLabel(chat.wanted)} on the next turn.` : 'Claude default.'
}

export function More({ chat, runner, text, onSent, onCommands, onPaste, phone }: {
  chat: ChatHandle
  runner: DRunner
  text: string
  onSent: () => void
  onCommands: () => void
  onPaste?: () => void
  phone: boolean
}) {
  const [open, setOpen] = useState(false)
  const [specs, setSpecs] = useState<GoalSpec[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const box = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!open) return
    let live = true
    setErr(null)
    fetchSpecs().then(s => { if (live) setSpecs(s) }, e => {
      if (live) setErr(e instanceof RunnerError && e.code === 'runner_not_configured' ? 'The runner has no address yet.' : 'The runner is not answering, so its specs cannot be listed.')
    })
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); setOpen(false) } }
    window.addEventListener('mousedown', away)
    window.addEventListener('keydown', esc)
    return () => { live = false; window.removeEventListener('mousedown', away); window.removeEventListener('keydown', esc) }
  }, [open])
  const close = () => setOpen(false)
  const go = (kind: 'prompt' | 'goal', input: string, cwd?: string | null) => {
    close()
    void runner.run(kind, input, cwd).then(ok => { if (ok && kind === 'prompt') onSent() })
  }
  return (
    <span className="dcl-menuw" ref={box}>
      <button type="button" className={`dcl-ib${open ? ' dcl-on' : ''}`} aria-expanded={open} aria-label="More: commands, model, runner" title="More" onClick={() => setOpen(o => !o)}>
        <CIcon name="more" />
      </button>
      {open && (
        <div className="dcl-menu" role="menu">
          <button type="button" role="menuitem" onClick={() => { close(); onCommands() }}>Commands <small>/</small></button>
          {phone && onPaste && <button type="button" role="menuitem" data-verb="paste" onClick={() => { close(); onPaste() }}>Paste</button>}
          <div className="dcl-menu-h">Model</div>
          <div className="dcl-dim" data-model-now>{modelNote(chat)}</div>
          {MODEL_OPTIONS.map(m => (
            <button type="button" role="menuitemradio" aria-checked={chat.wanted === m.id} key={m.id ?? 'default'} data-verb="model"
              onClick={() => { chat.setWanted(m.id); close() }}>
              <span>{chat.wanted === m.id ? '✓ ' : ''}{m.label}</span><small>{m.note}</small>
            </button>
          ))}
          <div className="dcl-dim dcl-help">The pick applies to the next turn only.</div>
          <div className="dcl-menu-h">Runner</div>
          <button type="button" role="menuitem" data-verb="run-job" disabled={!text.trim() || runner.busy} onClick={() => go('prompt', text)}>
            Run what is typed on the runner
          </button>
          {!specs && !err && <div className="dcl-dim">Asking the runner what it can see…</div>}
          {err && <div className="dcl-dim">{err}</div>}
          {specs && specs.length === 0 && <div className="dcl-dim">The runner sees no goal specs on disk.</div>}
          {specs?.map(s => (
            <button type="button" role="menuitem" key={s.path} data-verb="run-goal" onClick={() => go('goal', s.path, s.cwd ?? null)}>
              <span>{s.name || s.path.split('/').pop()}</span>{s.mtime ? <small>{s.mtime.slice(0, 10)}</small> : null}
            </button>
          ))}
          <div className="dcl-dim dcl-help">A job runs on the runner, not in this tab. Its finish lands in the bell.</div>
        </div>
      )}
    </span>
  )
}
