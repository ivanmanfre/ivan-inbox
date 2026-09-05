/* ==========================================================================
   src/stockStyles.tsx — the stock shell's stylesheet, as a module.

   DECISIONS D4: `src/styles.css` is the iOS-palette sheet every `src/screens`
   surface reads, and it is stock's alone from Phase 3 W1 on. `src/main.tsx`
   used to import it for everyone, which put 1,113 lines of a retired palette
   in front of the live app on every load.

   Nothing else lives here. The `#exp/stock` branch in App.tsx mounts this
   through `React.lazy`, so the sheet arrives with the chunk and is in the
   document before the shell inside it paints; nothing on any other path
   reaches this file, so the live app never loads it.
   ========================================================================== */
import type { ReactNode } from 'react'
import './styles.css'

export default function StockStyles({ children }: { children?: ReactNode }) {
  return <>{children}</>
}
