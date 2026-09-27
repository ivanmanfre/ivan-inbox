import { Suspense, lazy, useCallback, useEffect, useState } from 'react'
import { useScheduledQueue } from '../../hooks/useContent'
import type { ContentLane } from '../../lib/content'
import type { Resource } from '../../lib/styles'
import { ConfirmProvider } from '../../wb/chrome/ConfirmSheet'
import { Skeleton } from '../ui/states'
import type { Sub } from './SubNav'
import { dHash } from '../route'

// TODAY'S VIEWS, mounted inside D's frame. Magnets, Errors (every post: stage
// tabs, filters, search, bulk, calendar), Publish queue, Strategy (incl. the
// merged Outliers/Markets tab), Results and Styles are not rebuilt as new D
// trees in this pass; they are reachable from the sub-nav and work exactly as
// they do today (their own confirms answer through today's provider).
const ContentList = lazy(() => import('../../wb/content').then(m => ({ default: m.ContentList })))
const MagnetsList = lazy(() => import('../../wb/content/magnets').then(m => ({ default: m.MagnetsList })))
const StylesList = lazy(() => import('../../wb/content/styles').then(m => ({ default: m.StylesList })))
const StrategyView = lazy(() => import('../../wb/content/strategy').then(m => ({ default: m.StrategyView })))
const MagnetWindow = lazy(() => import('../../wb/magnet').then(m => ({ default: m.MagnetWindow })))
const QueueStrip = lazy(() => import('../../wb/content/queue').then(m => ({ default: m.QueueStrip })))

type MagnetOpen = { id: string; queue: { id: string; title: string; type: string | null; updated_at: string; status: string }[] }

function PublishQueue() {
  const q = useScheduledQueue(true)
  return <QueueStrip rows={q.rows} loading={q.loading} error={q.error} loadedAt={q.loadedAt} refresh={q.refresh} />
}

function Errors({ lane, setLane, openDraft }: { lane: ContentLane; setLane: (l: ContentLane) => void; openDraft: (id: string, lane: ContentLane) => void }) {
  // Land on the Errors tab, the same jump today's Ops link makes.
  useEffect(() => {
    const t = window.setTimeout(() => window.dispatchEvent(new Event('wb-open-content-errors')), 60)
    return () => window.clearTimeout(t)
  }, [lane])
  return <ContentList lane={lane} setLane={setLane} openId={null} onOpen={id => openDraft(id, lane)} />
}

// Today's Strategy writes its own address (`#exp/v2/strategy?lane=&section=`)
// with replaceState. Inside D that address is put back into D's grammar at
// once, so a reload lands on the same D place and tab.
function useKeepDAddress(on: boolean) {
  useEffect(() => {
    if (!on) return
    const fix = () => {
      const m = location.hash.match(/^#exp\/(?:v2c?|brain-[abc])\/strategy\?(.*)$/)
      if (!m) return
      const q = new URLSearchParams(m[1])
      const sec = q.get('section') ?? ''
      const sub = sec === 'markets' || sec === 'outliers' ? 'markets' : sec === 'results' ? 'results' : 'strategy'
      history.replaceState(history.state, '', dHash('content', sub, q))
    }
    const t = window.setInterval(fix, 300)
    return () => window.clearInterval(t)
  }, [on])
}

export function Legacy({ sub, lane, setLane, openDraft, magnet, phone }: {
  sub: Sub; lane: ContentLane; setLane: (l: ContentLane) => void
  openDraft: (id: string, lane: ContentLane) => void; magnet: string | null; phone: boolean
}) {
  const [open, setOpen] = useState<MagnetOpen | null>(magnet ? { id: magnet, queue: [] } : null)
  const openMagnet = useCallback((id: string, _label: string, queue: Resource[]) => {
    setOpen({ id, queue: queue.map(r => ({ id: r.id, title: r.topic ?? 'Untitled', type: r.format, updated_at: r.updated_at, status: r.status })) })
  }, [])
  useKeepDAddress(sub === 'strategy' || sub === 'markets' || sub === 'results')
  const section = sub === 'markets' ? 'markets' : sub === 'results' ? 'results' : 'this-week'
  return (
    <div className="cn-legacy app wb ds-shell">
      <p className="cn-legacy-note">Today’s view, inside the new frame.</p>
      <ConfirmProvider>
        <Suspense fallback={<Skeleton lines={6} label="Loading today's view" />}>
          {sub === 'magnets' && <MagnetsList lane={lane} setLane={setLane} onOpen={openMagnet} />}
          {sub === 'errors' && <Errors lane={lane} setLane={setLane} openDraft={openDraft} />}
          {sub === 'queue' && <PublishQueue />}
          {(sub === 'strategy' || sub === 'markets' || sub === 'results') && <StrategyView key={section} lane={lane} setLane={setLane} initialSection={section} />}
          {sub === 'styles' && <StylesList lane={lane} setLane={setLane} />}
          {open && (
            <MagnetWindow id={open.id} lane={lane} queue={open.queue} mobile={phone}
              onClose={() => setOpen(null)} onPick={id => setOpen(cur => (cur ? { ...cur, id } : cur))} />
          )}
        </Suspense>
      </ConfirmProvider>
    </div>
  )
}
