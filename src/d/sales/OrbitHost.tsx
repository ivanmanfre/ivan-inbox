import { Suspense, lazy } from 'react'
import { dHash } from '../route'
import { DConfirmBridge } from '../shell/Layer'
import { DIcon } from '../ui/icons'
import { Skeleton } from '../ui/states'

// TODAY'S ORBIT, mounted inside D's frame (parity 09-27: it used to be a
// foreign link that reloaded into the old app). Same component, same reads
// (signal_graph, signal_person, 60 s poll + realtime), same four writes
// (Queue invite, Skip, Add to lane, bulk queue from a post) with their own
// confirms, answered by D's confirm (Skip is danger: red key, Enter never
// confirms). Tenant and range come from the address (`?tenant=&range=`),
// read once at mount, so an old `#exp/v2/orbit?tenant=arch&range=7d` link
// lands on the same view. Open thread goes to D's DMs.
const Orbit = lazy(() => import('../../orbit/Orbit').then(m => ({ default: m.Orbit })))

export function OrbitHost({ navigate, layout }: { navigate: (hash: string) => void; layout: 'desktop' | 'phone' }) {
  return (
    <div className={`sl-orbithost sl-orbithost-${layout}`} data-orbit-host>
      <div className="sl-orbitback">
        <button type="button" className="d-ib" aria-label="Back to Sales" onClick={() => navigate(dHash('sales'))}><DIcon name="back" /></button>
        <small>Sales</small>
      </div>
      <div className="app wb ds-shell d-oldhost">
        <DConfirmBridge>
          <Suspense fallback={<Skeleton lines={6} label="Loading Orbit" />}>
            <Orbit />
          </Suspense>
        </DConfirmBridge>
      </div>
    </div>
  )
}
