import type { ComponentType } from 'react'
import type { BrainAskPaneProps, BrainMobileProps } from '../types'

// Skin toggle for finalist B (goal run brain-b-design-elevation-2026-09-04).
// Read ONCE from the hash the page was loaded with, like WB_PREFIX in
// v2c/route.ts: `#exp/brain-b?skin=a`, `#exp/brain-b/ask?thread=…&skin=b`.
// `plain` is the B that shipped on 09-04 17:00Z. DEFAULT_SKIN flips to the
// winner in Phase 3; `?skin=plain` keeps the old surface reachable for a week.
export type Skin = 'plain' | 'a' | 'b'
export const DEFAULT_SKIN: Skin = 'plain'

export function readSkin(hash: string): Skin | null {
  const m = hash.match(/\?([^#]*)/)
  const s = new URLSearchParams(m?.[1] ?? '').get('skin')
  return s === 'a' || s === 'b' || s === 'plain' ? s : null
}

// This module sits inside the lazily imported candidate chunk. On the phone it
// evaluates at boot, while the hash still carries `?skin=`. On the desktop the
// Ask pane mounts after a rail click, and the rail rewrites the hash through
// wbHash(), which drops the query. The navigation timing entry keeps the URL
// the document was opened with and a same-document hash change never rewrites
// it, so the skin is read from THAT hash first (builder A's fix, adopted).
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

function resolveSkin(): Skin {
  if (typeof location === 'undefined') return DEFAULT_SKIN
  return readSkin(bootHash()) ?? readSkin(location.hash) ?? DEFAULT_SKIN
}

export const SKIN: Skin = resolveSkin()

/** A skin may replace either surface; whatever it leaves out falls back to plain B. */
export interface SkinModule {
  skin: {
    Mobile?: ComponentType<BrainMobileProps>
    AskPane?: ComponentType<BrainAskPaneProps>
  }
}
