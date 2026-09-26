/* ==========================================================================
   Strategy > Outliers. One view for this client's LinkedIn + X outliers.

   Reads `operator_outliers` once per lane (platform 'all', week null) and
   filters/sorts on the client. SWR first paint (the Markets shape): a cached
   read paints the first frame, the live read replaces it, and a failed read
   never becomes a cache. "Use this" calls `operator_outlier_use`, which is
   idempotent server-side, then the button settles to "On the board".
   ========================================================================== */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { readSwr, writeSwr } from '../../../lib/swr'
import {
  fetchOutliers, putOutlierOnBoard, rowKey,
  type OutlierRow, type OutliersPayload, type OutliersRead,
} from '../../../lib/outliers'
import { OutliersPanel } from './OutliersPanel'
import type { UseState } from './OutlierCard'
import './outliers.css'

const swrQuery = (lane: string) => `outliers:${lane}`

export default function OutliersView({ lane }: { lane: string }) {
  const seed = useMemo(() => readSwr<OutliersPayload>(swrQuery(lane)), [lane])
  const [read, setRead] = useState<OutliersRead | null>(seed ? { kind: 'ready', data: seed.payload } : null)
  const [tick, setTick] = useState(0)
  const [uses, setUses] = useState<Record<string, UseState>>({})

  useEffect(() => {
    let live = true
    void fetchOutliers(lane).then(r => {
      if (!live) return
      setRead(r)
      if (r.kind === 'ready') writeSwr(swrQuery(lane), r.data)
    })
    return () => { live = false }
  }, [lane, tick])

  const retry = useCallback(() => { setRead(null); setTick(t => t + 1) }, [])

  const stateOf = useCallback((r: OutlierRow): UseState => uses[rowKey(r)] ?? (r.idea ? 'on' : 'off'), [uses])

  const onUse = useCallback((r: OutlierRow) => {
    const k = rowKey(r)
    setUses(u => ({ ...u, [k]: 'busy' }))
    void putOutlierOnBoard(lane, r.platform, r.post_id).then(res => {
      setUses(u => ({ ...u, [k]: res.ok ? 'on' : 'failed' }))
    })
  }, [lane])

  return <OutliersPanel read={read} stateOf={stateOf} onUse={onUse} onRetry={retry} />
}
