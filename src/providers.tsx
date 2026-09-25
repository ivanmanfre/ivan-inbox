import type { ReactNode } from 'react'
// The app-wide providers, moved out of src/main.tsx (P1 speed, 2026-09-25).
// All three import the design system, and the design system imports motion:
// mounted from main.tsx they put motion, lucide and every ds primitive into the
// entry chunk, which the browser had to fetch, parse and run before React could
// mount at all. Every surface they wrap is itself lazy, so App.tsx loads this
// module beside the route's own chunk instead. The order is unchanged.
// R5c: one MotionConfig for the app (src/ds/MotionProvider.tsx).
import { Motion } from './ds/MotionProvider'
import { ConfirmProvider } from './wb/chrome/ConfirmSheet'
import { PushLaterProvider } from './wb/sheets/PushLater'

export default function Providers({ children }: { children: ReactNode }) {
  return (
    <Motion>
      <ConfirmProvider>
        <PushLaterProvider>
          {children}
        </PushLaterProvider>
      </ConfirmProvider>
    </Motion>
  )
}
