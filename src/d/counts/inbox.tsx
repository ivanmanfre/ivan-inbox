import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useInbox } from '../../hooks/useInbox'
import { useSolvedMerge, type SolvedApi } from './solved'

// ONE inbox read for the whole D frame (today's shell mounted useInbox once,
// hooks/useInbox.ts). It is what makes the reply chime ring on EVERY page (the
// chime plays inside the read when a newer inbound lands), feeds ⌘K's People
// band, and is the same list the DMs page draws, so a DMs visit costs no
// second 20k-row read and no second realtime channel.

// `threads` carry solvedAt ("Mark as solved", merged here once), so every reader of the frame's
// inbox, the DMs list, the per-seat counts, Home and ⌘K, settles the same threads.
// `askAll`: a reader that needs the whole history (⌘K's People band) asks for it; see DInboxProvider.
export type DInbox = ReturnType<typeof useInbox> & { solved: SolvedApi; askAll: () => void }

const Ctx = createContext<DInbox | null>(null)

/** Off the DMs page the inbox's read waits this long, so the page's own reads go first. */
const OFF_DMS_DELAY_MS = 4000
/** PERF-COLD (2026-10-08): Content > Ideas is one read of ~5 s of database time on its own; the
 *  inbox's 13 pages starting at 4 s cost it ~1.5 s on a cold open. There the inbox waits longer. */
export const HEAVY_PAGE_DELAY_MS = 9000

// 2026-11-17 speed pass (Ivan: "the app is still slow to load on ui"): off the DMs page the frame's
// inbox reads only the Needs-you conversations (useInbox scope 'priority', the read the DM counts
// already make), not the whole message history: that was ~25 page reads of ~2 s each on EVERY place,
// for a list only the DMs page and ⌘K show. The whole history is read once the DMs page opens or ⌘K
// asks (askAll), and from then on for the rest of the session.
const noAsk = () => {}

export function DInboxProvider({ children, now = false, delayMs = OFF_DMS_DELAY_MS }: { children: ReactNode; now?: boolean; delayMs?: number }) {
  const [on, setOn] = useState(now)
  const [all, setAll] = useState(now)
  useEffect(() => {
    if (now) setAll(true)
    if (on) return
    if (now) { setOn(true); return }
    const t = window.setTimeout(() => setOn(true), delayMs)
    return () => window.clearTimeout(t)
  }, [now, on, delayMs])
  const askAll = useCallback(() => { setAll(true); setOn(true) }, [])
  // The saved copy paints at once either way; only the live read waits.
  const raw = useInbox(on, true, all ? 'all' : 'priority')
  const { threads, solved } = useSolvedMerge(raw.threads, on)
  const inbox = useMemo(() => ({ ...raw, threads, solved, askAll }), [raw, threads, solved, askAll])
  return <Ctx.Provider value={inbox}>{children}</Ctx.Provider>
}

/** The frame's inbox when one is mounted (the counts provider reads it), else null. */
export function useDInboxMaybe(): DInbox | null {
  return useContext(Ctx)
}

/** The frame's inbox; outside the frame (a page test) the page runs its own read. */
export function useDInbox(): DInbox {
  const shared = useContext(Ctx)
  const ownRaw = useInbox(shared == null)
  const { threads, solved } = useSolvedMerge(ownRaw.threads, shared == null)
  const own = useMemo(() => ({ ...ownRaw, threads, solved, askAll: noAsk }), [ownRaw, threads, solved])
  return shared ?? own
}
