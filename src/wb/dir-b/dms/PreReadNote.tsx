import { useCallback, useEffect, useId, useState } from 'react'
import { CalPopover } from '../../../exp/v2c/CalPopover'
import { splitPreRead } from '../../../exp/v2c/chat/preread'
import { Divider } from '../../../ds'
import './dms.css'

// THE PRE-READ, MADE READABLE. Ivan, 2026-08-22: "when you add this sum up …
// I cannot see what is summing up. Maybe add a bubble, like a hover thing."
//
// Direction B copy of src/exp/v2c/PreReadNote.tsx. Every rule the original
// carries is carried here: the row does not move (the window maps a scroll
// offset onto exact item heights), there is no second call (this renders text
// `usePreRead` already fetched), and the panel is anchored to THIS row through
// CalPopover, which owns the flip-and-clamp arithmetic and portals into `.wb`.
// `avoidEl` is still the row, found by `.r` — which is why the Direction B card
// keeps that class.
//
// What changed is only the paint: the one line is the card's `.dirb-quote`
// instead of `.snip`, and the panel is set in the design system's type roles.

/** How long they have been waiting, in words. Null days = not waiting on him. */
function waitedPhrase(days: number | null): string | null {
  if (days === null) return null
  if (days === 0) return 'Waiting since today'
  return `Waiting ${days} day${days === 1 ? '' : 's'}`
}

export function PreReadNote({ line, name, days }: {
  line: string
  name: string
  days: number | null
}) {
  // HOVER *AND* FOCUS *AND* TAP, because each one is somebody's only way in.
  const [mode, setMode] = useState<'off' | 'hover' | 'pinned'>('off')
  const [el, setEl] = useState<HTMLElement | null>(null)
  const id = `pre-${useId()}`
  const open = mode !== 'off'
  const close = useCallback(() => setMode('off'), [])
  const toggle = useCallback(() => setMode(m => (m === 'pinned' ? 'off' : 'pinned')), [])

  // LIGHT DISMISS for the pinned state only. Installed AFTER the click that
  // pinned it, so it cannot close what just opened.
  useEffect(() => {
    if (mode !== 'pinned') return
    const down = (e: Event) => {
      const t = e.target as Node | null
      if (t && (el?.contains(t) || document.getElementById(id)?.contains(t))) return
      setMode('off')
    }
    document.addEventListener('pointerdown', down, true)
    return () => document.removeEventListener('pointerdown', down, true)
  }, [mode, el, id])

  const parts = splitPreRead(line)
  const waited = waitedPhrase(days)

  return (
    <>
      <div
        ref={setEl}
        className="dirb-quote dirb-truncate ds-t-body"
        role="button"
        tabIndex={0}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onMouseEnter={() => setMode(m => (m === 'pinned' ? m : 'hover'))}
        onMouseLeave={() => setMode(m => (m === 'hover' ? 'off' : m))}
        onFocus={() => setMode(m => (m === 'pinned' ? m : 'hover'))}
        onBlur={close}
        // The card opens the conversation on click. A tap on the summary opens
        // the SUMMARY, which is the only affordance a phone has here.
        onClick={e => { e.stopPropagation(); toggle() }}
        onKeyDown={e => {
          if (e.key !== 'Enter' && e.key !== ' ') return
          e.preventDefault(); e.stopPropagation(); toggle()
        }}
      >{line}</div>

      {open && (
        <CalPopover
          id={id}
          role="tooltip"
          anchorEl={el}
          avoidEl={el?.closest('.r') as HTMLElement | null}
          onDismiss={close}
        >
          <div className="dirb-stack">
            <div className="dirb-spread">
              <span className="ds-t-title">{name}</span>
              {waited && <span className="ds-t-mono dirb-dim">{waited}</span>}
            </div>
            <Divider />
            {parts
              ? parts.map(p => (
                <div className="dirb-col" key={p.label}>
                  <div className="ds-t-eyebrow dirb-dim">{p.label}</div>
                  <div className={p.stated ? 'ds-t-body' : 'ds-t-body dirb-quiet'}>{p.text}</div>
                </div>
              ))
              // NOT THREE PARTS. Whatever came back is printed whole rather
              // than dropped: a two-part answer, or an error string, still says
              // something, and a bubble that shows nothing is the bug again.
              : <div className="ds-t-body">{line}</div>}
          </div>
        </CalPopover>
      )}
    </>
  )
}
