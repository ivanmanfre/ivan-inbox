import { useSyncExternalStore } from 'react'

// SPEC-foundation §2.3 "Ambient gate" / "Reduced motion". One answer to "how
// much may move right now": 'off' under Reduce Motion or Daily Brief's View
// options → Motion Off; 'subtle' under Motion Subtle (no ambient loops); and
// 'off' while the page is hidden (a hidden WebKit page freezes the timeline,
// so nothing is queued then). Native writes the classes; Inbox only reads them.

export type MotionLevel = 'full' | 'subtle' | 'off'

export function motionLevel(i: { reduced: boolean; off: boolean; subtle: boolean; hidden: boolean }): MotionLevel {
  if (i.reduced || i.off || i.hidden) return 'off'
  if (i.subtle) return 'subtle'
  return 'full'
}

const RM = '(prefers-reduced-motion: reduce)'

function read(): MotionLevel {
  if (typeof document === 'undefined') return 'full'
  const cl = document.documentElement.classList
  return motionLevel({
    reduced: typeof window !== 'undefined' && !!window.matchMedia?.(RM).matches,
    off: cl.contains('brief-motion-off'),
    subtle: cl.contains('brief-motion-subtle'),
    hidden: document.visibilityState === 'hidden',
  })
}

function subscribe(f: () => void): () => void {
  const mq = typeof window !== 'undefined' ? window.matchMedia?.(RM) : undefined
  mq?.addEventListener?.('change', f)
  document.addEventListener('visibilitychange', f)
  // Daily Brief flips the html classes from its native View options.
  const mo = typeof MutationObserver === 'function' ? new MutationObserver(f) : null
  mo?.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
  return () => { mq?.removeEventListener?.('change', f); document.removeEventListener('visibilitychange', f); mo?.disconnect() }
}

export function useMotionLevel(): MotionLevel {
  return useSyncExternalStore(subscribe, read, () => 'full')
}

export const __readMotionLevel = read
