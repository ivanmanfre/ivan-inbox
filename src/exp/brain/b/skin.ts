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

export const SKIN: Skin = readSkin(typeof location === 'undefined' ? '' : location.hash)

/** A skin may replace either surface; whatever it leaves out falls back to plain B. */
export interface SkinModule {
  skin: {
    Mobile?: ComponentType<BrainMobileProps>
    AskPane?: ComponentType<BrainAskPaneProps>
  }
}
