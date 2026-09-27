import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { useInbox } from '../../hooks/useInbox'

// ONE inbox read for the whole D frame (today's shell mounted useInbox once,
// hooks/useInbox.ts). It is what makes the reply chime ring on EVERY page (the
// chime plays inside the read when a newer inbound lands), feeds ⌘K's People
// band, and is the same list the DMs page draws, so a DMs visit costs no
// second 20k-row read and no second realtime channel.

export type DInbox = ReturnType<typeof useInbox>

const Ctx = createContext<DInbox | null>(null)

/** Off the DMs page the whole-inbox read waits this long, so the page's own reads go first. */
const OFF_DMS_DELAY_MS = 4000

export function DInboxProvider({ children, now = false }: { children: ReactNode; now?: boolean }) {
  const [on, setOn] = useState(now)
  useEffect(() => {
    if (on) return
    if (now) { setOn(true); return }
    const t = window.setTimeout(() => setOn(true), OFF_DMS_DELAY_MS)
    return () => window.clearTimeout(t)
  }, [now, on])
  // The saved copy paints at once either way; only the live read waits.
  const inbox = useInbox(on, true)
  return <Ctx.Provider value={inbox}>{children}</Ctx.Provider>
}

/** The frame's inbox when one is mounted (the counts provider reads it), else null. */
export function useDInboxMaybe(): DInbox | null {
  return useContext(Ctx)
}

/** The frame's inbox; outside the frame (a page test) the page runs its own read. */
export function useDInbox(): DInbox {
  const shared = useContext(Ctx)
  const own = useInbox(shared == null)
  return shared ?? own
}
