/* ==========================================================================
   src/lib/confirm.ts — the confirm CONTEXT, and nothing else.

   Two shells ask the same question. `#exp/stock` asks it through the iOS action
   sheet in src/components/ConfirmSheet.tsx; the live app asks it through the
   design system's dialog in src/wb/chrome/ConfirmSheet.tsx. Both are providers
   over THIS context, so every `useConfirm()` call site in the app keeps working
   without knowing which shell it is running inside, and there is exactly one
   promise contract rather than two that can drift.
   ========================================================================== */
import { createContext, useContext } from 'react'

export type ConfirmOpts = {
  title: string
  message?: string
  confirmText?: string
  cancelText?: string
  /** The confirm removes something for good. */
  danger?: boolean
}

export type PendingConfirm = ConfirmOpts & { resolve: (ok: boolean) => void }

/** Default resolves false: an unmounted provider must never mean "yes". */
export const ConfirmCtx = createContext<(opts: ConfirmOpts) => Promise<boolean>>(
  () => Promise.resolve(false),
)

export function useConfirm() {
  return useContext(ConfirmCtx)
}
