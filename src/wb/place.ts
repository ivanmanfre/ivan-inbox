
// WHERE AN ANCHORED POPOVER GOES. The view that used this arithmetic was the
// workbench's own `CalPopover`, deleted in Phase 3 W6 with the sheet that
// styled it; the design-system Popover in `src/ds` renders the two live
// callers (the calendar day chip and the pre-read note). The GEOMETRY is what
// they still read, so it moved here whole, comment and all.
//
// It exists because a native `title` is not one.
//
// What it replaces: `ContentCalendar.tsx` passed `title={tip}` to the chip's
// face. A native title cannot be styled, waits about a second before it opens,
// is unreachable by keyboard, and the browser puts it where the browser likes,
// which is what Ivan saw when the tooltip landed nowhere near the cell it was
// describing.
//
// NO NEW DEPENDENCY. The app has exactly three and keeps three. Positioning is
// `getBoundingClientRect` plus arithmetic, rendered through `createPortal` from
// react-dom, which is already one of the three. CSS anchor positioning was the
// other candidate and is not used: `anchor-name` is Chrome 125+ with no Safari
// or Firefox support at the time of writing, so it would have been a fallback
// path plus this path, which is two implementations of one thing.
//
// THE ONE RULE THAT IS NOT ABOUT TASTE: the popover must never cover the cell
// it describes. It is positioned against the AVOID rect (the day cell), not
// against the chip, so it lands outside the cell rather than on top of the
// eleven other things in it. Vertical placement flips when there is no room
// below; horizontal placement clamps to the viewport, which is the case that
// breaks at the right edge and is why every edge is in the evidence.

const GUTTER = 8

export type Placed = { top: number; left: number; side: 'below' | 'above' }

/**
 * Where the panel goes, given what it is anchored to and what it must not
 * cover. Exported and pure so the edge cases are testable without a browser:
 * the four corners are arithmetic, not a screenshot.
 */
export function place(
  anchor: { left: number; right: number; top: number; bottom: number },
  avoid: { left: number; right: number; top: number; bottom: number },
  size: { w: number; h: number },
  vp: { w: number; h: number },
): Placed {
  // BELOW THE CELL FIRST. Reading order runs down the month, so a panel under
  // the day it belongs to is the one that does not make the eye jump back.
  let side: 'below' | 'above' = 'below'
  let top = avoid.bottom + GUTTER
  if (top + size.h > vp.h - GUTTER) {
    const above = avoid.top - GUTTER - size.h
    // Flip only if flipping actually buys room. On a short viewport neither
    // side fits and the panel is clamped into view rather than being pushed
    // off the bottom, because a tooltip you cannot read is worse than one
    // sitting closer to its cell than the gutter would like.
    if (above >= GUTTER) { side = 'above'; top = above }
    else top = Math.max(GUTTER, vp.h - GUTTER - size.h)
  }
  // Aligned to the CHIP horizontally, because that is the thing being pointed
  // at, then clamped. The clamp is the right-edge fix: without it a panel on a
  // Saturday cell runs past the viewport and the text is unreachable.
  let left = anchor.left
  if (left + size.w > vp.w - GUTTER) left = vp.w - GUTTER - size.w
  if (left < GUTTER) left = GUTTER
  return { top, left, side }
}
