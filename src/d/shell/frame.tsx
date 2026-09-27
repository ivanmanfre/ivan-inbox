import { createContext, useContext } from 'react'
import type { Layout } from '../places'
import type { DRoute } from '../route'

// What the frame hands to everything under it. Pages mostly need nothing from
// here (they get PlaceProps); the ui/ primitives read it to know the canvas and
// where the answer row lives.
export type Frame = {
  layout: Layout
  route: DRoute
  navigate: (hash: string) => void
  bellOpen: boolean
  setBellOpen: (open: boolean) => void
  claudeOpen: boolean
  setClaudeOpen: (open: boolean) => void
  openPalette: () => void
  /** Desktop: the answer row's title box. Phone: null (the title renders inline). */
  titleSlot: HTMLElement | null
  /** The frame's tool box (desktop answer row, phone top bar), left of the frame's own keys. */
  toolsSlot: HTMLElement | null
}

export const FrameCtx = createContext<Frame | null>(null)

export function useFrame(): Frame {
  const f = useContext(FrameCtx)
  if (!f) throw new Error('useFrame outside the D Shell')
  return f
}

/** Same as useFrame, but null outside the Shell (for primitives used in tests). */
export function useFrameMaybe(): Frame | null {
  return useContext(FrameCtx)
}
