import { createContext, useContext, type ReactNode } from 'react'
import { useInbox } from '../../hooks/useInbox'

// ONE inbox read for the whole D frame (today's shell mounted useInbox once,
// hooks/useInbox.ts). It is what makes the reply chime ring on EVERY page (the
// chime plays inside the read when a newer inbound lands), feeds ⌘K's People
// band, and is the same list the DMs page draws, so a DMs visit costs no
// second 20k-row read and no second realtime channel.

export type DInbox = ReturnType<typeof useInbox>

const Ctx = createContext<DInbox | null>(null)

export function DInboxProvider({ children }: { children: ReactNode }) {
  const inbox = useInbox()
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
