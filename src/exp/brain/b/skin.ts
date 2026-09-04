import type { ComponentType } from 'react'
import type { BrainAskPaneProps, BrainMobileProps } from '../types'

// Skin toggle for finalist B (goal run brain-b-design-elevation-2026-09-04).
// Read ONCE from the hash the page was loaded with, like WB_PREFIX in
// v2c/route.ts: `#exp/brain-b?skin=a`, `#exp/brain-b/ask?thread=…&skin=b`.
// `plain` is the B that shipped on 09-04 17:00Z. DEFAULT_SKIN flips to the
// winner in Phase 3; `?skin=plain` keeps the old surface reachable for a week.
export type Skin = 'plain' | 'a' | 'b'
export const DEFAULT_SKIN: Skin = 'plain'

export function readSkin(hash: string): Skin {
  const m = hash.match(/\?([^#]*)/)
  const s = new URLSearchParams(m?.[1] ?? '').get('skin')
  return s === 'a' || s === 'b' || s === 'plain' ? s : DEFAULT_SKIN
}

/**
 * The hash the DOCUMENT was loaded with, which is not the same thing as the
 * hash right now. This module is evaluated when the candidate's chunk loads,
 * and on the DESKTOP that is when the Ask pane is first docked — by which time
 * the app has already navigated the hash to `#exp/brain-b/dms` and the `?skin=`
 * it booted with is gone. The phone loaded the same chunk at boot and read it
 * fine, so the skin silently fell back to plain on one surface and not the
 * other. The navigation timing entry keeps the URL the document was opened
 * with and a same-document hash change never rewrites it, which is exactly the
 * "read ONCE, from the hash the page was loaded with" this file already means.
 */
function bootHash(): string {
  if (typeof location === 'undefined') return ''
  let url = location.href
  try {
    const nav = performance?.getEntriesByType?.('navigation')?.[0] as { name?: string } | undefined
    if (nav?.name) url = nav.name
  } catch { /* no navigation timing: the live hash is the best available */ }
  const at = url.indexOf('#')
  return at < 0 ? '' : url.slice(at)
}

const BOOTED = readSkin(bootHash())
export const SKIN: Skin = BOOTED !== DEFAULT_SKIN
  ? BOOTED
  : readSkin(typeof location === 'undefined' ? '' : location.hash)

/** A skin may replace either surface; whatever it leaves out falls back to plain B. */
export interface SkinModule {
  skin: {
    Mobile?: ComponentType<BrainMobileProps>
    AskPane?: ComponentType<BrainAskPaneProps>
  }
}
