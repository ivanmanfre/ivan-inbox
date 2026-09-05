/* ==========================================================================
   src/wb/ask/parts.tsx: the small pieces the brain surfaces share.

   Copied from `src/exp/brain/b/skins/b/*` and rebuilt on `src/ds` + `../kit`.
   Every string here already existed on the old surface; nothing new is said.
   ========================================================================== */
import { useRef, useState } from 'react'
import { Chip } from '../../ds'
import { FAMILY_LANE } from '../../exp/brain/b/families'
import { JOB_LABEL } from '../../exp/v2c/layout'
import './ask.css'

export const clock = (iso: string): string =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })

export function TenantChip({ tenant }: { tenant: string | null }) {
  if (!tenant) return null
  const label = /rise/i.test(tenant) ? 'RISE' : /arch/i.test(tenant) ? 'ARCH' : /ivan/i.test(tenant) ? 'Mine' : tenant
  return <Chip tone="quiet">{label}</Chip>
}

export function laneLabel(family: string): string | null {
  const lane = FAMILY_LANE[family as keyof typeof FAMILY_LANE]
  return lane ? JOB_LABEL[lane] : null
}

/** The severity mark: a filled square (needs you), a solid bar (an error), a
 * hollow ring (information). Shape carries it; colour only agrees, so the row
 * still reads severity in greyscale. Drawn, never a glyph. */
export function Mark({ shape }: { shape: 'square' | 'bar' | 'dot' }) {
  return <span className="a-brain-mark" data-shape={shape}><i /></span>
}

/** A row that is running right now says so in mono, with the kit's sweep under
 * the label, and settles flat the instant the word stops saying it. */
export function isRunningWord(word: string): boolean {
  return /^running\b/i.test(word.trim())
}

// ---------------------------------------------------------------------------
// Swipe to dismiss. The row follows the finger with its transition suppressed
// and only the release settles; past a third of the travel it leaves. LEFT
// only: a right drag inside an open feed belongs to the sheet, which is the
// surface behind this one, and two gestures on one axis is one gesture too
// many. The dismiss control stays for anyone who would rather press a button.
// ---------------------------------------------------------------------------
const SWIPE_LOCK = 8
const SWIPE_MAX = 108
const SWIPE_SETTLE = 0.33

export function useSwipe(onDismiss: () => void) {
  const start = useRef<{ x: number; y: number; axis: 'none' | 'x' | 'y' } | null>(null)
  const [dx, setDx] = useState(0)
  const [dragging, setDragging] = useState(false)

  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length !== 1) return
    start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, axis: 'none' }
  }
  const onTouchMove = (e: React.TouchEvent) => {
    const s = start.current
    if (!s) return
    const mx = e.touches[0].clientX - s.x
    const my = e.touches[0].clientY - s.y
    if (s.axis === 'none') {
      if (Math.abs(mx) < SWIPE_LOCK && Math.abs(my) < SWIPE_LOCK) return
      // A list being scrolled owns the gesture: claiming the horizontal axis on
      // a diagonal makes every flick down the feed jitter the row sideways.
      s.axis = Math.abs(mx) > Math.abs(my) ? 'x' : 'y'
      if (s.axis === 'y') { start.current = null; setDx(0); setDragging(false); return }
      setDragging(true)
    }
    // Once the row owns the x axis the pager must not also see it: the pager's
    // own handler locked x, clamped its travel to zero and dropped the inert
    // guard off the place underneath for the length of the swipe.
    e.stopPropagation()
    setDx(Math.max(-SWIPE_MAX, Math.min(0, mx)))
  }
  const end = () => {
    const s = start.current
    start.current = null
    setDragging(false)
    if (!s || s.axis !== 'x') { setDx(0); return }
    if (Math.abs(dx) >= SWIPE_MAX * SWIPE_SETTLE) onDismiss()
    setDx(0)
  }
  const style = dx !== 0
    ? { transform: `translateX(${dx}px)`, transition: dragging ? ('none' as const) : undefined }
    : undefined
  return { onTouchStart, onTouchMove, onTouchEnd: end, onTouchCancel: end, style, open: dx !== 0 }
}
