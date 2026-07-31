import { type ReactNode, useCallback, useRef, useState } from 'react'
import { PullIndicator } from '../../components/PullIndicator'
import { usePullToRefresh } from '../../hooks/usePullToRefresh'
import { useContent } from '../../hooks/useContent'
import {
  countBoardVisible, countUndated, reviewActionable,
  ALERT_STAGES, PIPELINE_STAGES, STAGE_LABEL,
  type ContentDraft, type ContentLane, type ContentStage, type ContentStages,
} from '../../lib/content'
import { DraftDetail } from './DraftDetail'
import { ReviewActions } from './ReviewActions'
import { relTime, typeLabel } from './fmt'

// One card shape for every stage (title/topic, type chip, relative time,
// thumbnail if there's one). Tapping it opens the full row (DraftDetail).
// Only a 'review' row in the Ivan lane carries the approve/skip pair — D6/D7:
// approve is a status write that does NOT publish, and the Rise lane is
// read-only ambient visibility here (client-facing decisions stay on the client
// board). Rise cards instead carry the board-visibility pill: whether the
// client can actually SEE this row is the fact that matters on a lane Ivan
// can't act on.
function QueueCard({ d, lane, refresh, onOpen }: {
  d: ContentDraft; lane: ContentLane; refresh: () => void; onOpen: (id: string) => void
}) {
  const thumb = d.image_urls?.[0]
  return (
    <div className="ct-card ct-tap" onClick={() => onOpen(d.id)}>
      <div className="ct-top">
        {thumb ? <img className="ct-thumb" src={thumb} alt="" /> : <div className="ct-thumb ct-thumb-empty">No image</div>}
        <div className="ct-mid">
          <div className="ct-title">{d.title || d.topic || 'Untitled'}</div>
          {d.title && d.topic && d.title !== d.topic && <div className="ct-topic">{d.topic}</div>}
          <div className="ct-meta">
            <span className="ct-chip">{typeLabel(d.type)}</span>
            <span className="ct-tm">{relTime(d.updated_at)}</span>
            {lane === 'risedtc' && (
              <span className={d.board_visible === true ? 'ct-lane' : 'ct-chip'}>
                {d.board_visible === true ? "On Rise's board" : 'Internal'}
              </span>
            )}
          </div>
        </div>
      </div>
      {reviewActionable(d.status, lane) && <ReviewActions id={d.id} onDone={refresh} compact />}
    </div>
  )
}

// Same collapsible header idiom as OpsScreen's Section (ops-sechdr/chev, hidden
// entirely at count 0 — no empty-state chrome for a stage nothing is sitting
// in). Open state is LIFTED to the queue so a tap on the stage rail can open a
// collapsed section before scrolling to it: scrolling a collapsed header into
// view and showing the operator nothing is worse than not scrolling at all.
function StageSection({ title, count, open, onToggle, id, sub, children }: {
  title: string; count: number; open: boolean; onToggle: () => void
  id: string; sub?: ReactNode; children: ReactNode
}) {
  if (count === 0) return null
  return (
    <>
      <div className="ops-sechdr" id={id} onClick={onToggle}>
        <span>{title} · {count}</span>
        <span className="chev">{open ? '⌄' : '›'}</span>
      </div>
      {open && (
        <>
          {sub}
          {children}
        </>
      )}
    </>
  )
}

// ---- stage rail ----
//
// Replaces round 1's 2x2 tile grid. Same counts, no extra fetch, but read as
// the PIPELINE: ideas → generating → needs review → approved → scheduled →
// published, in that order, left to right. Error/Stuck ride at the end and are
// the only chips that ever take severity colour, and only when they're
// non-zero — D10's "an honest zero is not a warning": a clean queue must read
// calm, not urgent.
const RAIL_STAGES: ContentStage[] = [...PIPELINE_STAGES, ...ALERT_STAGES]

function StageRail({ stages, onJump }: {
  stages: ContentStages; onJump: (s: ContentStage) => void
}) {
  return (
    <div className="ct-rail">
      {RAIL_STAGES.map(s => {
        const n = stages[s].length
        const bad = (s === 'error' || s === 'stuck') && n > 0
        return (
          <div
            key={s}
            className={`ct-rchip${bad ? ' bad' : ''}${n === 0 ? ' zero' : ''}`}
            onClick={n > 0 ? () => onJump(s) : undefined}
          >
            <span className="ct-rn">{n}</span>
            <span className="ct-rl">{STAGE_LABEL[s]}</span>
          </div>
        )
      })}
    </div>
  )
}

function ContentSkeleton() {
  return (
    <div aria-hidden>
      {Array.from({ length: 3 }).map((_, i) => (
        <div className="ct-card" key={i}>
          <div className="ct-top">
            <div className="sk" style={{ width: 56, height: 56, borderRadius: 12, flex: 'none' }} />
            <div className="ct-mid">
              <div className="sk sk-line" style={{ width: '60%' }} />
              <div className="sk sk-line" style={{ width: '40%', marginTop: 8 }} />
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

const LANES: { key: ContentLane; label: string }[] = [
  { key: 'ivan', label: 'Ivan' },
  { key: 'risedtc', label: 'Rise' },
]

// Sections that are open on arrival. The top of the pipeline is where work is;
// Scheduled and Published are reference, and both are opened on demand by the
// rail (which forces them open before scrolling).
const DEFAULT_OPEN: ContentStage[] = ['ideas', 'generating', 'review', 'approved']

export function ContentQueue({ lane, setLane }: { lane: ContentLane; setLane: (l: ContentLane) => void }) {
  const { drafts, stages, matched, laneTotal, loading, error, refresh } = useContent(lane)
  const rowsRef = useRef<HTMLDivElement>(null)
  const ptr = usePullToRefresh(rowsRef, () => refresh())
  const [openStages, setOpenStages] = useState<ContentStage[]>(DEFAULT_OPEN)
  const [alertOpen, setAlertOpen] = useState(true)
  const [openId, setOpenId] = useState<string | null>(null)

  const isOpen = (s: ContentStage) => openStages.includes(s)
  const toggle = (s: ContentStage) =>
    setOpenStages(cur => (cur.includes(s) ? cur.filter(x => x !== s) : [...cur, s]))

  // Open first, scroll after paint — scrollIntoView against a header whose
  // rows are still collapsed lands on the wrong offset the moment they expand.
  const jump = useCallback((s: ContentStage) => {
    if (s === 'error' || s === 'stuck') setAlertOpen(true)
    else setOpenStages(cur => (cur.includes(s) ? cur : [...cur, s]))
    requestAnimationFrame(() => {
      document.getElementById(`ct-s-${s}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }, [])

  const firstLoad = loading && drafts.length === 0
  // D10: an empty board and a broken filter must never render the same way.
  // scoped===0 while the lane has rows at all means the recent-or-active filter
  // ate everything — a bug, not a quiet Sunday.
  const nothingMatched = !loading && (matched ?? 0) === 0
  const filteredAway = nothingMatched && (laneTotal ?? 0) > 0

  const alertRows = [...stages.error, ...stages.stuck]
  const undated = countUndated(stages.approved)
  const onBoard = countBoardVisible(drafts)

  return (
    <>
      <div className="chips" style={{ margin: '4px 16px 0' }}>
        {LANES.map(l => (
          <span key={l.key} className={`chip ${lane === l.key ? 'on' : ''}`} onClick={() => setLane(l.key)}>
            {l.label}
          </span>
        ))}
      </div>
      {/* Lane header line — Rise only. The one number Ivan can't get anywhere
          else on a read-only lane: how much of what the engine made has
          actually been promoted onto the client's board. */}
      {lane === 'risedtc' && !firstLoad && !error && drafts.length > 0 && (
        <div className="ct-lanehdr">{onBoard} of {drafts.length} visible on Rise's board</div>
      )}
      <div className="rows ct-rows" ref={rowsRef}>
        <PullIndicator pull={ptr.pull} refreshing={ptr.refreshing} trigger={ptr.trigger} />
        {error ? (
          <div className="ct-broken">{error}</div>
        ) : firstLoad ? (
          <ContentSkeleton />
        ) : nothingMatched ? (
          filteredAway ? (
            <div className="ct-broken">
              Nothing matches the queue filters — {laneTotal} draft{laneTotal === 1 ? '' : 's'} exist outside them.
            </div>
          ) : (
            <div className="empty">No {lane === 'ivan' ? 'Ivan' : 'Rise'} drafts in the queue.</div>
          )
        ) : (
          <>
            {/* Exceptions ride ABOVE the pipeline, never as sections inside it:
                an errored row and a schedule that silently died are not steps on
                the way to publishing, and interleaving them broke the reading
                order of the lifecycle. Open by default — an alert that has to be
                unfolded to be seen isn't one. */}
            {alertRows.length > 0 && (
              <>
                <div className="ct-alert" onClick={() => setAlertOpen(o => !o)}>
                  <span className="ct-alert-n">{alertRows.length}</span>
                  <span className="ct-alert-t">
                    {stages.error.length > 0 && `${stages.error.length} errored`}
                    {stages.error.length > 0 && stages.stuck.length > 0 && ' · '}
                    {stages.stuck.length > 0 && `${stages.stuck.length} past due, never posted`}
                  </span>
                  <span className="chev">{alertOpen ? '⌄' : '›'}</span>
                </div>
                {alertOpen && (
                  <>
                    <div id="ct-s-error" />
                    {stages.error.map(d => (
                      <QueueCard key={d.id} d={d} lane={lane} refresh={refresh} onOpen={setOpenId} />
                    ))}
                    <div id="ct-s-stuck" />
                    {stages.stuck.map(d => (
                      <QueueCard key={d.id} d={d} lane={lane} refresh={refresh} onOpen={setOpenId} />
                    ))}
                  </>
                )}
              </>
            )}

            <StageRail stages={stages} onJump={jump} />

            {PIPELINE_STAGES.map(s => (
              <StageSection
                key={s}
                id={`ct-s-${s}`}
                title={STAGE_LABEL[s]}
                count={stages[s].length}
                open={isOpen(s)}
                onToggle={() => toggle(s)}
                sub={s === 'approved' && undated > 0 ? (
                  // The proven black hole, kept in sight now that approved rows
                  // are one section: the dashboard's review lane only shows
                  // status='review' and its calendar only shows rows that HAVE
                  // a date, so these are on no other surface at all.
                  <div className="ct-subline">{undated} approved without a date</div>
                ) : undefined}
              >
                {stages[s].map(d => (
                  <QueueCard key={d.id} d={d} lane={lane} refresh={refresh} onOpen={setOpenId} />
                ))}
              </StageSection>
            ))}

            {/* Decided-against rows and vocabulary the app hasn't caught up to
                (n8n writes these statuses, not this app) both collapse to the
                bottom — collapsed, but never dropped (blank-board #3). */}
            <StageSection
              id="ct-s-archived" title={STAGE_LABEL.archived} count={stages.archived.length}
              open={isOpen('archived')} onToggle={() => toggle('archived')}
            >
              {stages.archived.map(d => (
                <QueueCard key={d.id} d={d} lane={lane} refresh={refresh} onOpen={setOpenId} />
              ))}
            </StageSection>
            <StageSection
              id="ct-s-other" title={STAGE_LABEL.other} count={stages.other.length}
              open={isOpen('other')} onToggle={() => toggle('other')}
            >
              {stages.other.map(d => (
                <QueueCard key={d.id} d={d} lane={lane} refresh={refresh} onOpen={setOpenId} />
              ))}
            </StageSection>
          </>
        )}
      </div>
      {openId && (
        <DraftDetail id={openId} lane={lane} refresh={refresh} onBack={() => setOpenId(null)} />
      )}
    </>
  )
}
