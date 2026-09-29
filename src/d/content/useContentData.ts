import { useCallback, useEffect, useMemo, useState } from 'react'
import { useContent, useScheduledQueue } from '../../hooks/useContent'
import { publishBlocksByDraft } from '../../lib/publishBlock'
import { fetchIvanArmedDays, type ContentDraft, type ScheduledQueueRow } from '../../lib/content'
import { fetchVerdict, verdictParts, type VerdictPart } from '../../lib/contentVerdict'
import type { Lane } from './model'
import { useStalled } from '../ui/timeout'

// The page's reads: today's useContent once per seat (a fixed three calls, never
// in a loop or behind a condition), the days Ivan's feed already holds, and
// today's verdict line (the blocked-post sentence). Nothing new is queried.
export type SeatRead = {
  rows: ContentDraft[]
  loading: boolean
  error: string | null
  loadedAt: string | null
  refresh: () => void
}

export type ContentData = {
  seats: Record<Lane, SeatRead>
  armed: Set<string> | null
  armedFailed: boolean
  verdict: VerdictPart[] | null
  /** Ivan's posts the publisher stopped (draft id -> reason), from today's publish-queue read; null until read. */
  blocks: Map<string, string> | null
  /** Today's publish-queue read (scheduled_posts, Ivan's feed), for queue-only posts on the planner; null until read. */
  queueRows: ScheduledQueueRow[] | null
  refreshAll: () => void
  failed: number
}

function seat(r: ReturnType<typeof useContent>, stalled: boolean): SeatRead {
  // A first read with no answer in 12 s is a failed read ("could not read"), never a lasting "…".
  const error = r.error ?? (stalled ? 'no answer after 12 s' : null)
  return { rows: r.drafts, loading: r.loading, error, loadedAt: r.loadedAt, refresh: r.refresh }
}

// `enabled` = false holds all four reads (Review paints its week first; see
// useWeek). Once let go it stays on: the caller latches it.
export function useContentData(enabled: boolean = true): ContentData {
  const ivan = useContent('ivan', enabled)
  const rise = useContent('risedtc', enabled)
  const arch = useContent('arch', enabled)
  const queue = useScheduledQueue(enabled)
  const st = {
    ivan: useStalled(enabled && !ivan.error && !ivan.loadedAt, ivan.refresh),
    rise: useStalled(enabled && !rise.error && !rise.loadedAt, rise.refresh),
    arch: useStalled(enabled && !arch.error && !arch.loadedAt, arch.refresh),
  }
  const qLoaded = enabled && !!queue.loadedAt
  const blocks = useMemo(() => (qLoaded ? publishBlocksByDraft(queue.rows) : null), [qLoaded, queue.rows])
  const [armed, setArmed] = useState<Set<string> | null>(null)
  const [armedFailed, setArmedFailed] = useState(false)
  const [verdict, setVerdict] = useState<VerdictPart[] | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!enabled) return
    let live = true
    fetchIvanArmedDays()
      .then(s => { if (live) { setArmed(s); setArmedFailed(false) } })
      .catch(() => { if (live) setArmedFailed(true) })
    fetchVerdict()
      .then(v => { if (live) setVerdict(verdictParts(v)) })
      .catch(() => { if (live) setVerdict(null) })
    return () => { live = false }
  }, [enabled, tick, ivan.drafts])

  const { refresh: r1 } = ivan, { refresh: r2 } = rise, { refresh: r3 } = arch, { refresh: r4 } = queue
  const refreshAll = useCallback(() => { r1(); r2(); r3(); r4(); setTick(t => t + 1) }, [r1, r2, r3, r4])
  const failed = [ivan.error || st.ivan, rise.error || st.rise, arch.error || st.arch].filter(Boolean).length

  return {
    seats: { ivan: seat(ivan, st.ivan), risedtc: seat(rise, st.rise), arch: seat(arch, st.arch) },
    armed, armedFailed, verdict, blocks, queueRows: qLoaded ? queue.rows : null, refreshAll, failed,
  }
}
