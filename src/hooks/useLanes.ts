/* ==========================================================================
   THE LANE LIST, FROM THE REGISTRY.

   Until now the tenants a Strategy surface could show were typed into
   `src/lib/content.ts:14` as `['ivan', 'risedtc', 'arch']`, so a fourth client
   with a full roster could not appear anywhere without a deploy. The database
   already held the answer: `client_registry`, filtered by `lane_allowed()`.
   That function is granted to service_role only, on purpose, so the browser
   asks `operator_lanes('clientops')` (db/100) instead, which applies the same
   guard and also drops inactive rows, keeping `zz-selftest` out of the inbox.

   One read per session. The answer changes when Ivan onboards a client, which
   is not something that happens while a tab is open, and a lane switch must
   never wait on a network call.

   THE FALLBACK IS THE OLD CONSTANT, AND IT SAYS SO. While the call is in
   flight, and if it fails, the surfaces render the three lanes they have
   always rendered rather than an empty switch. `state` rides onto the surface
   as a data attribute so a shot can tell a registry answer from a fallback.
   ========================================================================== */
import { useEffect, useMemo, useState } from 'react'
import { CONTENT_LANES, LANE_LABEL } from '../lib/content'
import { fetchLanes, type Lane } from '../lib/markets'

export type LanesState = 'loading' | 'registry' | 'fallback'
export type Lanes = { lanes: Lane[]; state: LanesState; message: string | null }

const CACHE_KEY = 'a-lanes-v1'

/** The lanes the code has always known, used only until the registry answers. */
export const FALLBACK_LANES: Lane[] = CONTENT_LANES.map(id => ({ client_id: id, display_name: LANE_LABEL[id] }))

function readCache(store?: Pick<Storage, 'getItem' | 'setItem'>): Lane[] | null {
  try {
    const raw = store?.getItem(CACHE_KEY)
    if (!raw) return null
    const v = JSON.parse(raw) as unknown
    if (!Array.isArray(v) || !v.length) return null
    const lanes = v.filter((r): r is Lane =>
      !!r && typeof r === 'object'
      && typeof (r as Lane).client_id === 'string' && (r as Lane).client_id !== ''
      && typeof (r as Lane).display_name === 'string' && (r as Lane).display_name !== '')
    return lanes.length ? lanes : null
  } catch { return null }
}

function writeCache(lanes: Lane[], store?: Pick<Storage, 'getItem' | 'setItem'>): void {
  try { store?.setItem(CACHE_KEY, JSON.stringify(lanes)) } catch { /* private window: one read per mount instead */ }
}

/** The whole hook, pure enough to test: the store and the read are both injectable. */
export function useLanes(
  read: () => Promise<Awaited<ReturnType<typeof fetchLanes>>> = fetchLanes,
  store: Pick<Storage, 'getItem' | 'setItem'> | undefined = typeof sessionStorage === 'undefined' ? undefined : sessionStorage,
): Lanes {
  // A cached answer paints on the first frame, the same way DMs paints its threads.
  const seed = useMemo(() => readCache(store), [store])
  const [lanes, setLanes] = useState<Lane[] | null>(seed)
  const [failed, setFailed] = useState<string | null>(null)

  useEffect(() => {
    if (seed) return
    let live = true
    void read().then(r => {
      if (!live) return
      if (r.kind === 'ready') { setLanes(r.lanes); writeCache(r.lanes, store) }
      else setFailed(r.message)
    }).catch(e => { if (live) setFailed(String(e?.message || e)) })
    return () => { live = false }
  }, [read, store, seed])

  if (lanes) return { lanes, state: 'registry', message: null }
  return { lanes: FALLBACK_LANES, state: failed ? 'fallback' : 'loading', message: failed }
}

/** The lane a surface should show, given what the registry answered.
    A lane the operator was on that the registry no longer lists falls back to
    the first one rather than leaving the switch pointing at nothing. */
export function resolveLane(current: string, lanes: Lane[]): string {
  return lanes.some(l => l.client_id === current) ? current : (lanes[0]?.client_id ?? current)
}

/** The Segmented's options, in the order the registry gave them. */
export function laneOptions(lanes: Lane[]): Array<{ id: string; label: string }> {
  return lanes.map(l => ({ id: l.client_id, label: l.display_name }))
}
