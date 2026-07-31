import { DraftsScreen } from '../../screens/DraftsScreen'
import type { Thread } from '../../lib/inbox'
import { ContentQueue } from './ContentQueue'
import { StylesGallery } from './StylesGallery'

export type WorkSeg = 'dms' | 'content' | 'styles'

const SEGS: { key: WorkSeg; label: string }[] = [
  { key: 'dms', label: 'DMs' },
  { key: 'content', label: 'Content' },
  { key: 'styles', label: 'Styles' },
]

// Drafts tab, expanded into three segments — the whole IA thesis for this
// candidate: no new tab, an existing tab absorbs the new surfaces. DMs is the
// UNMODIFIED <DraftsScreen/>, same props Shell already passed it (its own
// nav/header, its own Ivan/Rise seg, its own Ops-pending preview row) —
// proving the DM flow carries zero regression risk from living behind a
// segmented switch instead of owning the tab outright. That embedded
// Ops-pending row in DraftsScreen (one screen already hosting another
// domain's cards without a tab of its own) is the precedent this whole
// skeleton generalizes.
export function WorkScreen({ seg, setSeg, threads, onOpenThread, refresh, onOpenOps }: {
  seg: WorkSeg
  setSeg: (s: WorkSeg) => void
  threads: Thread[]
  onOpenThread: (id: string) => void
  refresh: () => void
  onOpenOps: () => void
}) {
  return (
    <>
      <div className="seg" style={{ margin: '14px 16px 0' }}>
        {SEGS.map(s => (
          <div key={s.key} className={`sg ${seg === s.key ? 'on' : ''}`} onClick={() => setSeg(s.key)}>
            {s.label}
          </div>
        ))}
      </div>
      {seg === 'dms' && (
        <DraftsScreen threads={threads} onOpenThread={onOpenThread} refresh={refresh} onOpenOps={onOpenOps} />
      )}
      {seg === 'content' && <ContentQueue />}
      {seg === 'styles' && <StylesGallery />}
    </>
  )
}
