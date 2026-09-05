/* ==========================================================================
   src/wb/dir-a/dms/PreReadNote.tsx — S02-23, the pre-read made readable.

   Every behaviour of the original survives: hover AND focus AND tap-pin, the
   light dismiss installed only for the pinned state, Escape, the flip-and-clamp
   placement (imported from CalPopover, which owns that arithmetic and has the
   edge cases under test), and the promise the row does not move — the note is
   still ONE line inside a fixed-height row, and everything the bubble adds is
   out of flow in a portal.

   NO SECOND CALL. This renders text `usePreRead` already fetched and cached.
   There is no fetch in this file and no effect that could start one.
   ========================================================================== */
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { place, type Placed } from '../../../exp/v2c/CalPopover'
import { splitPreRead } from '../../../exp/v2c/chat/preread'
import './dms.css'

/** How long they have been waiting, in words. Null days = not waiting on him. */
function waitedPhrase(days: number | null): string | null {
  if (days === null) return null
  if (days === 0) return 'Waiting since today'
  return `Waiting ${days} day${days === 1 ? '' : 's'}`
}

/* The panel. Portalled to the workbench root for the same reason CalPopover
   portals there: it must escape the row's `overflow:hidden` and it must land in
   the subtree the tokens are declared on. The placement is measured against the
   ROW, never the line, so the bubble cannot cover the conversation it sums up. */
function Bubble({ id, anchorEl, avoidEl, onDismiss, children }: {
  id: string
  anchorEl: HTMLElement | null
  avoidEl: HTMLElement | null
  onDismiss: () => void
  children: React.ReactNode
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState<Placed | null>(null)
  const [shown, setShown] = useState(false)

  const measure = useCallback(() => {
    const el = ref.current
    if (!el || !anchorEl) return
    const a = anchorEl.getBoundingClientRect()
    const v = (avoidEl ?? anchorEl).getBoundingClientRect()
    const r = el.getBoundingClientRect()
    setPos(place(a, v, { w: r.width, h: r.height }, { w: window.innerWidth, h: window.innerHeight }))
  }, [anchorEl, avoidEl])

  // Measured at opacity 0, told to show on the next frame, so the fade runs from
  // the right place rather than from the top-left corner of the viewport.
  useLayoutEffect(() => {
    measure()
    const f = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(f)
  }, [measure])

  useEffect(() => {
    const on = () => measure()
    // `true` on scroll: the list scrolls inside a pane, not on the window, and a
    // non-capturing window listener never hears that.
    window.addEventListener('scroll', on, true)
    window.addEventListener('resize', on)
    return () => {
      window.removeEventListener('scroll', on, true)
      window.removeEventListener('resize', on)
    }
  }, [measure])

  // Escape, on the document: a tooltip opened by hover has no focus to hang a
  // handler on and the key still has to work.
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onDismiss() } }
    document.addEventListener('keydown', k, true)
    return () => document.removeEventListener('keydown', k, true)
  }, [onDismiss])

  if (!anchorEl) return null
  const host = anchorEl.closest('.wb') ?? anchorEl.closest('.a-root') ?? document.body
  return createPortal(
    <div
      ref={ref}
      id={id}
      role="tooltip"
      className="a-dms-pop"
      data-side={pos?.side ?? 'below'}
      data-in={shown && pos ? '' : undefined}
      style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}
    >{children}</div>,
    host,
  )
}

export function PreReadNote({ line, name, days }: {
  line: string
  name: string
  days: number | null
}) {
  // HOVER *AND* FOCUS *AND* TAP, because each one is somebody's only way in.
  //   · 'hover'  — the pointer is on it, or the caret is. Closes when it leaves.
  //   · 'pinned' — clicked or Entered. Survives the pointer leaving, which is
  //                what makes this reachable at 390px where hover does not
  //                exist at all.
  const [mode, setMode] = useState<'off' | 'hover' | 'pinned'>('off')
  const [el, setEl] = useState<HTMLElement | null>(null)
  const id = `pre-${useId()}`
  const open = mode !== 'off'
  const close = useCallback(() => setMode('off'), [])
  const toggle = useCallback(() => setMode(m => (m === 'pinned' ? 'off' : 'pinned')), [])

  // LIGHT DISMISS for the pinned state only. Blur handles it wherever a click
  // focuses a tabindex element (Chrome), and Safari is the browser where it
  // does not, which is the one this app is used on. The listener is installed
  // AFTER the click that pinned it, so it cannot close what just opened.
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
      {/* ONE line, the line the row already had. NO native `title`: a tooltip
          racing this one, on its own delay and in the browser's chosen corner,
          is the thing being replaced. */}
      <span
        ref={setEl}
        className="a-dms-note"
        role="button"
        tabIndex={0}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onMouseEnter={() => setMode(m => (m === 'pinned' ? m : 'hover'))}
        onMouseLeave={() => setMode(m => (m === 'hover' ? 'off' : m))}
        onFocus={() => setMode(m => (m === 'pinned' ? m : 'hover'))}
        onBlur={close}
        // The row opens the conversation on click. A tap on the summary opens
        // the SUMMARY, which is the only affordance a phone has here.
        onClick={e => { e.stopPropagation(); toggle() }}
        onKeyDown={e => {
          if (e.key !== 'Enter' && e.key !== ' ') return
          e.preventDefault(); e.stopPropagation(); toggle()
        }}
      >{line}</span>

      {open && (
        <Bubble
          id={id}
          anchorEl={el}
          avoidEl={el?.closest('.a-dms-rowhost') as HTMLElement | null}
          onDismiss={close}
        >
          <div className="a-dms-pop-h">
            <span className="a-title-t">{name}</span>
            {waited && <span className="a-mono a-dim">{waited}</span>}
          </div>
          {parts
            ? parts.map(p => (
              <div className="a-dms-pop-p" key={p.label}>
                <span className="a-eyebrow">{p.label}</span>
                <span className={p.stated ? 'a-body-t' : 'a-body-t a-dim'}>{p.text}</span>
              </div>
            ))
            // NOT THREE PARTS. Whatever came back is printed whole rather than
            // dropped: a two-part answer, or an error string, still says
            // something, and a bubble that shows nothing is the bug again.
            : <span className="a-body-t">{line}</span>}
        </Bubble>
      )}
    </>
  )
}
