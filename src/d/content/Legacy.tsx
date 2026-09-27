import { Suspense, lazy, useCallback, useEffect, useState } from 'react'
import { useScheduledQueue } from '../../hooks/useContent'
import type { ContentDraft, ContentLane } from '../../lib/content'
import type { Resource } from '../../lib/styles'
import { ConfirmProvider } from '../../wb/chrome/ConfirmSheet'
import { Skeleton } from '../ui/states'
import type { Sub } from './SubNav'

// TODAY'S VIEWS, mounted inside D's frame. Magnets, Errors (every post: stage
// tabs, filters, search, bulk, calendar), Publish queue, Strategy (incl. the
// Outliers + Markets tab), Results and Styles are today's components; they
// keep their own writes and confirms (today's provider). What this file owns
// is the MOUNTING, which is where the parity audit found the gaps:
//  - Errors lands on its tab for every lane (the tab is written before the
//    list reads it, not fired as an event the list may not hear yet);
//  - a row opens D's draft window beside the list, walking that list;
//  - Strategy / Outliers & Markets / Results are ONE mount, so a sub switch
//    is a tab switch (unsaved edits ask first) and the address it writes is D's;
//  - a magnet link opens every time it changes and is cleared on close.
const ContentList = lazy(() => import('../../wb/content').then(m => ({ default: m.ContentList })))
const MagnetsList = lazy(() => import('../../wb/content/magnets').then(m => ({ default: m.MagnetsList })))
const StylesList = lazy(() => import('../../wb/content/styles').then(m => ({ default: m.StylesList })))
const StrategyView = lazy(() => import('../../wb/content/strategy').then(m => ({ default: m.StrategyView })))
const MagnetWindow = lazy(() => import('../../wb/magnet').then(m => ({ default: m.MagnetWindow })))
const QueueStrip = lazy(() => import('../../wb/content/queue').then(m => ({ default: m.QueueStrip })))

type MagnetOpen = { id: string; queue: { id: string; title: string; type: string | null; updated_at: string; status: string }[] }

function PublishQueue({ lane }: { lane: ContentLane }) {
  const q = useScheduledQueue(true)
  return (
    <>
      <p className="cn-legacy-note" data-queue-seat="ivan">
        {lane === 'ivan' ? 'Your feed (Ivan): every post the publisher holds for LinkedIn.'
          : 'This is your feed (Ivan), not the client’s: Rise and Arch publish from their own boards, so their posts are never in this queue.'}
      </p>
      <QueueStrip rows={q.rows} loading={q.loading} error={q.error} loadedAt={q.loadedAt} refresh={q.refresh} />
    </>
  )
}

/** Put the lane's list on `tab` (today's per-lane key) and on the flow view, before the list first reads them. */
function landOn(lane: ContentLane, tab: string) {
  try {
    localStorage.setItem(`wb-content-tab-${lane}`, tab)
    localStorage.setItem('wb-content-view', 'flow')
  } catch { /* private mode */ }
}

function Errors({ lane, setLane, onOpen, openId, laneCounts, land }: {
  lane: ContentLane; setLane: (l: ContentLane) => void; openId: string | null
  onOpen: (id: string, lane: ContentLane, queue: string[]) => void
  laneCounts?: Partial<Record<ContentLane, number>>; land: string
}) {
  // Once per mount (keyed by lane + landing tab above), before ContentList renders.
  useState(() => { landOn(lane, land); return true })
  return (
    <ContentList lane={lane} setLane={setLane} openId={openId} laneCounts={laneCounts}
      onOpen={(id, _label, queue: ContentDraft[]) => onOpen(id, lane, queue.map(r => r.id))} />
  )
}

export function Legacy({ sub, lane, setLane, openDraft, openId, magnet, clearMagnet, phone, laneCounts, land }: {
  sub: Sub; lane: ContentLane; setLane: (l: ContentLane) => void
  openDraft: (id: string, lane: ContentLane, queue: string[]) => void; openId: string | null
  magnet: string | null; clearMagnet: () => void; phone: boolean
  laneCounts?: Partial<Record<ContentLane, number>>
  /** The Errors sub's landing tab for this lane (today's tab key). */
  land: string
}) {
  const [open, setOpen] = useState<MagnetOpen | null>(magnet ? { id: magnet, queue: [] } : null)
  // A magnet link (⌘K hit, notification) opens every time it names a new one.
  useEffect(() => {
    if (magnet) setOpen(cur => (cur?.id === magnet ? cur : { id: magnet, queue: [] }))
  }, [magnet])
  const openMagnet = useCallback((id: string, _label: string, queue: Resource[]) => {
    setOpen({ id, queue: queue.map(r => ({ id: r.id, title: r.topic ?? 'Untitled', type: r.format, updated_at: r.updated_at, status: r.status })) })
  }, [])
  const closeMagnet = useCallback(() => { setOpen(null); if (magnet) clearMagnet() }, [clearMagnet, magnet])
  const strategy = sub === 'strategy' || sub === 'markets' || sub === 'results'
  return (
    <div className="cn-legacy app wb ds-shell">
      <ConfirmProvider>
        <Suspense fallback={<Skeleton lines={6} label="Loading today's view" />}>
          {sub === 'magnets' && <MagnetsList lane={lane} setLane={setLane} onOpen={openMagnet} />}
          {sub === 'errors' && (
            <Errors key={`${lane}:${land}`} lane={lane} setLane={setLane} onOpen={openDraft} openId={openId} laneCounts={laneCounts} land={land} />
          )}
          {sub === 'queue' && <PublishQueue lane={lane} />}
          {/* One mount for the three subs: StrategyView reads its tab from D's address and writes it back. */}
          {strategy && <StrategyView lane={lane} setLane={setLane} />}
          {sub === 'styles' && <StylesList lane={lane} setLane={setLane} />}
          {open && (
            <MagnetWindow id={open.id} lane={lane} queue={open.queue} mobile={phone}
              onClose={closeMagnet} onPick={id => setOpen(cur => (cur ? { ...cur, id } : cur))} />
          )}
        </Suspense>
      </ConfirmProvider>
    </div>
  )
}
