/* ==========================================================================
   Strategy > Outliers. One view for this client's LinkedIn + X outliers.

   Reads `operator_outliers` once per lane (platform 'all', week null) and
   filters/sorts on the client. SWR first paint (the Markets shape): a cached
   read paints the first frame, the live read replaces it, and a failed read
   never becomes a cache. "Use this" calls `operator_outlier_use`, which is
   idempotent server-side, then the button settles to "On the board". A failed
   tap keeps the RPC's reason on the card and the button goes back to idle.

   Self-keyed per lane: the default export remounts the inner view on a lane
   change, so no card, read or board state crosses from one client to the
   next, whether or not the parent keys the mount.
   ========================================================================== */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { readSwr, writeSwr } from '../../../lib/swr'
import {
  fetchOutliers, putOutlierOnBoard, rowKey,
  type OutlierRow, type OutliersPayload, type OutliersRead,
} from '../../../lib/outliers'
import { OutliersPanel } from './OutliersPanel'
import type { UseState } from './OutlierCard'
import { useOutlierLabels, type OutlierLabelSource } from '../../../d/content/OutlierLabels'
import type { Lane } from '../../../d/content/model'
import './outliers.css'

const swrQuery = (lane: string) => `outliers:${lane}`

type UseEntry = { state: UseState; message?: string }

function OutliersInner({ lane, humanLabels = false }: { lane: string; humanLabels?: boolean }) {
  const seed = useMemo(() => readSwr<OutliersPayload>(swrQuery(lane)), [lane])
  const [read, setRead] = useState<OutliersRead | null>(seed ? { kind: 'ready', data: seed.payload } : null)
  const [tick, setTick] = useState(0)
  const [uses, setUses] = useState<Record<string, UseEntry>>({})
  const [visible, setVisible] = useState<OutlierLabelSource[] | null>(null)
  const validLane = lane === 'ivan' || lane === 'risedtc' || lane === 'arch'
  const labels = useOutlierLabels(lane as Lane, humanLabels && validLane && read?.kind === 'ready' && read.data.client === lane ? visible : null)

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

  const stateOf = useCallback((r: OutlierRow): UseState => uses[rowKey(r)]?.state ?? (r.idea ? 'on' : 'off'), [uses])
  const failOf = useCallback((r: OutlierRow): string | undefined => uses[rowKey(r)]?.message, [uses])

  const onUse = useCallback((r: OutlierRow) => {
    const k = rowKey(r)
    setUses(u => ({ ...u, [k]: { state: 'busy' } }))
    void putOutlierOnBoard(lane, r.platform, r.post_id).then(res => {
      setUses(u => ({ ...u, [k]: res.ok ? { state: 'on' } : { state: 'failed', message: res.message } }))
    })
  }, [lane])

  return <OutliersPanel read={read} stateOf={stateOf} failOf={failOf} onUse={onUse} onRetry={retry} labelControl={humanLabels && validLane ? labels.control : undefined} onVisibleRows={humanLabels && validLane ? setVisible : undefined} labelsSummary={humanLabels ? labels.summary : null} />
}

export default function OutliersView({ lane, humanLabels = false }: { lane: string; humanLabels?: boolean }) {
  return <OutliersInner key={lane} lane={lane} humanLabels={humanLabels} />
}
