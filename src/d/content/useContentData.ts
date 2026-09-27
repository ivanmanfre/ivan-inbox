import { useCallback, useEffect, useMemo, useState } from 'react'
import { useContent, useScheduledQueue } from '../../hooks/useContent'
import { publishBlocksByDraft } from '../../lib/publishBlock'
import { fetchIvanArmedDays, type ContentDraft, type ScheduledQueueRow } from '../../lib/content'
import { fetchVerdict, verdictParts, type VerdictPart } from '../../lib/contentVerdict'
import type { Lane } from './model'

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

function seat(r: ReturnType<typeof useContent>): SeatRead {
  return { rows: r.drafts, loading: r.loading, error: r.error, loadedAt: r.loadedAt, refresh: r.refresh }
}

export function useContentData(): ContentData {
  const ivan = useContent('ivan')
  const rise = useContent('risedtc')
  const arch = useContent('arch')
  const queue = useScheduledQueue(true)
  const blocks = useMemo(() => (queue.loadedAt ? publishBlocksByDraft(queue.rows) : null), [queue.loadedAt, queue.rows])
  const [armed, setArmed] = useState<Set<string> | null>(null)
  const [armedFailed, setArmedFailed] = useState(false)
  const [verdict, setVerdict] = useState<VerdictPart[] | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let live = true
    fetchIvanArmedDays()
      .then(s => { if (live) { setArmed(s); setArmedFailed(false) } })
      .catch(() => { if (live) setArmedFailed(true) })
    fetchVerdict()
      .then(v => { if (live) setVerdict(verdictParts(v)) })
      .catch(() => { if (live) setVerdict(null) })
    return () => { live = false }
  }, [tick, ivan.drafts])

  const { refresh: r1 } = ivan, { refresh: r2 } = rise, { refresh: r3 } = arch, { refresh: r4 } = queue
  const refreshAll = useCallback(() => { r1(); r2(); r3(); r4(); setTick(t => t + 1) }, [r1, r2, r3, r4])
  const failed = [ivan, rise, arch].filter(s => s.error).length

  return {
    seats: { ivan: seat(ivan), risedtc: seat(rise), arch: seat(arch) },
    armed, armedFailed, verdict, blocks, queueRows: queue.loadedAt ? queue.rows : null, refreshAll, failed,
  }
}
