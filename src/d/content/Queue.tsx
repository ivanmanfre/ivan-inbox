import { useState } from 'react'
import type { ContentDraft } from '../../lib/content'
import { Failed, Skeleton } from '../ui/states'
import { LANES, LANE_NAME, POSS, age, aimOf, titleOf, type Lane } from './model'
import type { SeatRead } from './useContentData'

// The queue the draft window walks (j/k): what waits on Ivan per seat, newest
// first. Ivan: his drafts in review. Rise / Arch: in review and not on the
// client's board yet. Older than two weeks sits in its own fold with its real
// count (the frame's "Waiting on you" stops counting them at 14 days).
export function Queue({ lane, setLane, seat, fresh, older, counts, openId, onOpen, now }: {
  lane: Lane
  setLane: (l: Lane) => void
  seat: SeatRead
  fresh: ContentDraft[]
  older: ContentDraft[]
  counts: Record<Lane, number | null | undefined>
  openId: string | null
  onOpen: (id: string) => void
  now?: number
}) {
  const [showOld, setShowOld] = useState(false)
  const cap = lane === 'ivan' ? 'Your drafts in review, newest first' : `Not on ${POSS[lane]} board yet, newest first`
  const rows = showOld ? [...fresh, ...older] : fresh
  return (
    <section className="cn-q" aria-label="Waiting on you">
      <div className="cn-qh">
        <div className="cn-seg" role="tablist" aria-label="Seat">
          {LANES.map(l => (
            <button key={l} type="button" role="tab" aria-selected={l === lane} className={l === lane ? 'cn-on' : ''} onClick={() => setLane(l)}>
              {LANE_NAME[l]}<b>{counts[l] === undefined ? '…' : counts[l] ?? '?'}</b>
            </button>
          ))}
        </div>
        <small>{cap}</small>
        <span className="cn-kk"><kbd>j</kbd><kbd>k</kbd>walk</span>
      </div>
      {seat.error ? <Failed what={`${LANE_NAME[lane]}'s drafts`} detail={seat.error} onRetry={seat.refresh} />
        : seat.loading && !seat.loadedAt ? <Skeleton lines={5} title={false} label="Reading the queue" />
          : fresh.length === 0 && older.length === 0 ? (
            <div className="cn-fold"><span>Nothing waits on you here. Every draft in review is decided{lane === 'ivan' ? '' : ' or already on the board'}.</span></div>
          ) : (
            <div role="list">
              {fresh.length === 0 && <div className="cn-fold"><span>Nothing from the last two weeks.</span></div>}
              {rows.map((r, i) => (
                <button key={r.id} type="button" role="listitem" data-verb="open" className={`cn-row${r.id === openId ? ' cn-sel' : ''}`}
                  aria-current={r.id === openId ? 'true' : undefined} onClick={() => onOpen(r.id)}>
                  <span className="cn-m">{i + 1}</span>
                  <span className="cn-m">{age(r.created_at, now)}</span>
                  <span className="cn-t">{titleOf(r)}</span>
                  <span className="cn-m">{aimOf(r)}</span>
                  <span className="cn-m">{r.qa_score ? Math.round(Number(r.qa_score)) || r.qa_score : ''}</span>
                </button>
              ))}
              {older.length > 0 && (
                <div className="cn-fold">
                  <span>Older than two weeks</span>
                  <button type="button" onClick={() => setShowOld(o => !o)} aria-expanded={showOld}>{older.length} · {showOld ? 'Hide' : 'Show'}</button>
                </div>
              )}
            </div>
          )}
    </section>
  )
}
