import { useCallback, useEffect, useId, useState } from 'react'
import { CalPopover } from './CalPopover'
import { splitPreRead } from './chat/preread'

// THE PRE-READ, MADE READABLE. Ivan, 2026-08-22: "when you add this sum up …
// I cannot see what is summing up. Maybe add a bubble, like a hover thing."
//
// The line was never missing. `ASK` (chat/preread.ts) buys up to 140 characters
// in three parts, and `.snip` is a single `white-space:nowrap` row inside a
// windowed list, so what arrives on screen is four words and an ellipsis.
//
// THE ROW DOES NOT MOVE. `useRowWindow` maps a scroll offset onto a fixed
// ROW_H, so a note that grew to three lines would desynchronise every scroll
// position in the list. The one-line note stays exactly the line it was; this
// is additive, and everything it adds is out of flow in a portal.
//
// NO SECOND CALL. This renders text `usePreRead` already fetched and cached.
// There is no fetch in this file, no effect that could start one, and the hook's
// in-flight refusal and session cap are untouched.
//
// ANCHORED TO ITS OWN ROW, which is the whole reason `CalPopover` is imported
// rather than reinvented. The calendar tooltip shipped once as a native `title`
// and the browser parked it away from the cell it described; Ivan reported it.
// That file already owns the flip-when-there-is-no-room-below and the
// clamp-at-the-edges arithmetic, and it portals into `.wb` so the tokens and
// the three-class selectors still reach the panel. `avoidEl` is the ROW: a
// bubble that covers the conversation it is summarising is the calendar defect
// with a different anchor.

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
      {/* ONE `.snip` ELEMENT, exactly as InboxScreen renders it without this
          prop, so the density tokens and the `ch` measure cap keyed on
          `.r .snip` still reach it and the box is the same box.
          NO `title`: a native tooltip racing this one, on its own delay and in
          the browser's chosen corner, is the thing being replaced. */}
      <div
        ref={setEl}
        className="snip snip-note wb-prn"
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
      >{line}</div>

      {open && (
        <CalPopover
          id={id}
          role="tooltip"
          anchorEl={el}
          avoidEl={el?.closest('.r') as HTMLElement | null}
          onDismiss={close}
        >
          <div className="wb-prb">
            <div className="wb-prb-h">
              <span className="wb-prb-who">{name}</span>
              {waited && <span className="wb-prb-w">{waited}</span>}
            </div>
            {parts
              ? parts.map(p => (
                <div className="wb-prb-p" key={p.label}>
                  <div className="wb-prb-k">{p.label}</div>
                  <div className={`wb-prb-v${p.stated ? '' : ' wb-prb-q'}`}>{p.text}</div>
                </div>
              ))
              // NOT THREE PARTS. Whatever came back is printed whole rather
              // than dropped: a two-part answer, or an error string, still says
              // something, and a bubble that shows nothing is the bug again.
              : <div className="wb-prb-one">{line}</div>}
          </div>
        </CalPopover>
      )}
    </>
  )
}
