/* ==========================================================================
   src/wb/chrome/PullIndicator.tsx: S42, on the design system.

   Three states, the same three: below the trigger it points down, past it it
   points up, and while the read is in flight it spins. The arithmetic is the old
   file's; the glyphs are lucide marks and the spin is the system's own busy
   loop, which runs only while `refreshing` is true. The old copy stays on disk
   for `#exp/stock` (D2).
   ========================================================================== */
import { Icon } from '../../ds'
import './chrome.css'

export function PullIndicator({ pull, refreshing, trigger }: {
  pull: number; refreshing: boolean; trigger: number
}) {
  if (pull <= 0 && !refreshing) return null
  const ready = pull >= trigger
  return (
    <div className="a-ptr" style={{ height: pull }} aria-hidden>
      <span
        className="a-ptr-mark"
        data-live={refreshing ? '' : undefined}
        style={{
          opacity: refreshing ? 1 : Math.min(1, pull / trigger),
          transform: refreshing ? undefined : `rotate(${pull * 3}deg)`,
        }}
      >
        <Icon name={refreshing ? 'refresh' : ready ? 'up' : 'down'} size={20} />
      </span>
    </div>
  )
}
