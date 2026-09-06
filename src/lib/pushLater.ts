/* ==========================================================================
   src/lib/pushLater.ts — the push-later CONTEXT and its date arithmetic.

   Same split as src/lib/confirm.ts, and for the same reason: two shells ask
   the same question. `#exp/stock` asks it through the iOS action sheet in
   src/components/PushLaterSheet.tsx; the live app asks it through the design
   system's sheet in src/wb/sheets/PushLater.tsx. Both are providers over THIS
   context, so every `usePushLater()` call site keeps working without knowing
   which shell it is inside, and there is one promise contract rather than two
   that can drift.

   The four date helpers moved here with it because they are pure and every
   list row that prints "in 6 days" reads one of them.
   ========================================================================== */
import { createContext, useContext } from 'react'

export type PendingPush = { name: string; resolve: (until: string | null) => void }

/** Default resolves null: an unmounted provider must never park a draft. */
export const PushCtx = createContext<(name: string) => Promise<string | null>>(
  () => Promise.resolve(null),
)

export function usePushLater() {
  return useContext(PushCtx)
}

// `datetime-local` wants "YYYY-MM-DDTHH:mm" in LOCAL time and gives it back the
// same way. Date.toISOString() is UTC, so it is the wrong tool in both
// directions: feeding it in shifts the default by the offset, and reading it
// out as if it were UTC would push a draft to the wrong hour. Both conversions
// go through the local fields.
export function toLocalInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

export function fromLocalInput(v: string): string | null {
  const t = new Date(v)
  if (Number.isNaN(t.getTime())) return null
  return t.toISOString()
}

/** "Tue 26 Aug, 08:00" — the date he will see it, in his own clock. */
export function formatReturn(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'later'
  return d.toLocaleString(undefined, {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  })
}

/** "in 6 days" / "tomorrow" / "today" — how long the park has left to run. */
export function returnsIn(iso: string, now: number = Date.now()): string {
  const days = Math.round((Date.parse(iso) - now) / 86_400_000)
  if (Number.isNaN(days)) return ''
  if (days <= 0) return 'today'
  if (days === 1) return 'tomorrow'
  if (days < 14) return `in ${days} days`
  if (days < 60) return `in ${Math.round(days / 7)} weeks`
  return `in ${Math.round(days / 30)} months`
}
