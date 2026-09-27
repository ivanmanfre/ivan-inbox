import type { MouseEvent, ReactNode } from 'react'
import { PLACES, type Layout, type PlaceId } from '../places'
import { AnswerRow } from './AnswerRow'

/**
 * A link to the OLD app (another `#exp/...` shell). The experiment gate reads
 * the hash only at load, so a hash change alone would leave D on screen: the
 * link sets the hash and reloads, which is what opening it fresh would do.
 */
export function ForeignLink({ hash, children, className }: { hash: string; children: ReactNode; className?: string }) {
  const go = (e: MouseEvent) => {
    e.preventDefault()
    location.hash = hash
    location.reload()
  }
  return <a className={className ?? 'd-link'} href={hash} onClick={go}>{children}</a>
}

/** The honest state of a place whose D page is not built yet. */
export function NotBuilt({ place, layout }: { place: PlaceId; layout: Layout }) {
  const p = PLACES[place]
  return (
    <div className={`d-notbuilt d-notbuilt-${layout}`} data-d-notbuilt={place}>
      <AnswerRow title={p.label} sub="Not built yet in this preview." />
      <div className="d-notbuilt-b">
        <p>Not built yet in this preview. Open today's page:</p>
        <ForeignLink hash={p.today} className="d-btn">Today's {p.label}</ForeignLink>
      </div>
    </div>
  )
}
