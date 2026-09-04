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
// wbHash(), which drops the query. So an explicit `?skin=` is stashed per tab
// the first time it is seen and the stash is preferred over a bare hash.
const SKIN_KEY = 'brain-b-skin'
function resolveSkin(): Skin {
  if (typeof location === 'undefined') return DEFAULT_SKIN
  const fromHash = readSkin(location.hash)
  try {
    if (fromHash) { sessionStorage.setItem(SKIN_KEY, fromHash); return fromHash }
    const kept = sessionStorage.getItem(SKIN_KEY)
    if (kept === 'a' || kept === 'b' || kept === 'plain') return kept
  } catch { /* storage blocked: the hash is all we have */ }
  return DEFAULT_SKIN
}

export const SKIN: Skin = resolveSkin()

/** A skin may replace either surface; whatever it leaves out falls back to plain B. */
export interface SkinModule {
  skin: {
    Mobile?: ComponentType<BrainMobileProps>
    AskPane?: ComponentType<BrainAskPaneProps>
  }
}
