import { useRef, useState } from 'react'
import { PullIndicator } from '../../components/PullIndicator'
import { usePullToRefresh } from '../../hooks/usePullToRefresh'
import { useContent } from '../../hooks/useContent'
import {
  ALERT_STAGES, PIPELINE_STAGES, STAGE_LABEL, countBoardVisible, countUndated,
  reviewActionable, type ContentDraft, type ContentLane, type ContentStage,
  type ContentStages,
} from '../../lib/content'
import { ReviewActions } from './ReviewActions'
import { relTime, typeLabel } from './fmt'
import { CalmEmpty, Failed, SectionHead, StackBar } from './Surface'
import { hasMock } from './mock'

// Content, as the pipeline.
//
// The primary grouping is groupByStage (LIFECYCLE), not bucketDrafts (triage).
// That is Ivan's own stated preference, quoted verbatim in content.ts:270 after a
// round on the triage board: "pretty shitty the way stages are… separate on our
// end on ideas, review, approved". A Content surface's job is "show me the whole
// pipeline"; triage is what the Drafts queue already does, and bucketDrafts stays
// the engine behind the counts and the actionable-row rule rather than a second
// competing board.
//
// error and stuck are lifted OUT of the flow into one strip above it: an errored
// row is not a step on the way to publishing.

const STAGE_COLOR: Record<string, string> = {
  ideas: 'rgba(235,235,245,.28)',
  generating: '#0A84FF',
  review: '#FFD60A',
  approved: '#10A37F',
  scheduled: 'rgba(16,163,127,.45)',
  published: 'rgba(235,235,245,.55)',
}

function Card({ d, lane, refresh, onOpen, active }: {
  d: ContentDraft; lane: ContentLane; refresh: () => void
  onOpen: (id: string, label: string) => void; active: boolean
}) {
  const thumb = d.image_urls?.[0]
  const title = d.title || d.topic || 'Untitled'
  return (
    <div
      className={`ct-card ct-tap${active ? ' wb-card-on' : ''}`}
      onClick={() => onOpen(d.id, title)}
    >
      <div className="ct-top">
        {thumb
          ? <img className="ct-thumb" src={thumb} alt="" />
          : <div className="ct-thumb ct-thumb-empty">No image</div>}
        <div className="ct-mid">
          <div className="ct-title">{title}</div>
          {d.title && d.topic && d.title !== d.topic && <div className="ct-topic">{d.topic}</div>}
          <div className="ct-meta">
            <span className="ct-chip">{typeLabel(d.type)}</span>
            <span className="ct-tm">{relTime(d.updated_at)}</span>
            {lane === 'risedtc' && (
              // On a read-only lane the fact that matters is whether the client
              // can SEE the row, not that it is a client row.
              <span className={d.board_visible === true ? 'ct-lane' : 'ct-chip'}>
                {d.board_visible === true ? 'On Rise’s board' : 'Internal'}
              </span>
            )}
          </div>
        </div>
      </div>
      {reviewActionable(d.status, lane) && <ReviewActions id={d.id} onDone={refresh} compact />}
    </div>
  )
}

function Skeleton() {
  return (
    <div aria-hidden>
      <div className="wb-pipe">
        <div className="sk" style={{ height: 10, borderRadius: 99 }} />
      </div>
      {Array.from({ length: 3 }).map((_, i) => (
        <div className="ct-card" key={i}>
          <div className="ct-top">
            <div className="sk" style={{ width: 56, height: 56, borderRadius: 12, flex: 'none' }} />
            <div className="ct-mid">
              <div className="sk sk-line" style={{ width: '62%' }} />
              <div className="sk sk-line" style={{ width: '38%', marginTop: 8 }} />
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

// The pipeline drawn once, at the top: proportions as a stacked bar, plus the
// two numbers that carry a decision (needs review, approved-with-no-date). This
// is the section's visual encoding — the stage list below it is text.
function PipelineBar({ stages, onJump }: {
  stages: ContentStages; onJump: (s: ContentStage) => void
}) {
  const parts = PIPELINE_STAGES.map(s => ({ key: STAGE_LABEL[s], n: stages[s].length, color: STAGE_COLOR[s] }))
  const total = parts.reduce((s, p) => s + p.n, 0)
  const review = stages.review.length
  const undated = countUndated(stages.approved)
  return (
    <div className="wb-pipe">
      <StackBar parts={parts} />
      <div className="wb-pipe-k">
        {PIPELINE_STAGES.filter(s => stages[s].length > 0).map(s => (
          <span className="wb-pipe-i" key={s} onClick={() => onJump(s)}>
            <span className="wb-pipe-d" style={{ background: STAGE_COLOR[s] }} />
            <b>{stages[s].length}</b> {STAGE_LABEL[s].toLowerCase()}
          </span>
        ))}
      </div>
      <div className="wb-pipe-n">
        <span className="wb-pipe-big">{review}</span>
        <span className="wb-pipe-lbl">waiting on you<br />of {total} in flight</span>
        {undated > 0 && (
          <span className="wb-pipe-warn">{undated} approved with no date</span>
        )}
      </div>
    </div>
  )
}

const DEFAULT_OPEN: ContentStage[] = ['ideas', 'generating', 'review', 'approved']

export function ContentList({ lane, setLane, openId, onOpen }: {
  lane: ContentLane
  setLane: (l: ContentLane) => void
  openId: string | null
  onOpen: (id: string, label: string) => void
}) {
  const { drafts, stages, matched, laneTotal, loading, error, loadedAt, refresh } = useContent(lane)
  const rowsRef = useRef<HTMLDivElement>(null)
  const ptr = usePullToRefresh(rowsRef, () => refresh())
  const [open, setOpen] = useState<ContentStage[]>(DEFAULT_OPEN)
  const [alertOpen, setAlertOpen] = useState(true)

  const isOpen = (s: ContentStage) => open.includes(s)
  const toggle = (s: ContentStage) =>
    setOpen(cur => (cur.includes(s) ? cur.filter(x => x !== s) : [...cur, s]))
  const jump = (s: ContentStage) => {
    if (ALERT_STAGES.includes(s as 'error' | 'stuck')) setAlertOpen(true)
    else setOpen(cur => (cur.includes(s) ? cur : [...cur, s]))
    requestAnimationFrame(() => {
      document.getElementById(`wb-s-${s}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }

  const err = error ?? (hasMock('fetch-error') ? 'PostgREST returned 500 for carousel_drafts' : null)
  const firstLoad = loading && drafts.length === 0
  const nothingMatched = !loading && (matched ?? 0) === 0
  const filteredAway = nothingMatched && (laneTotal ?? 0) > 0
  const alerts = [...stages.error, ...stages.stuck]
  const onBoard = countBoardVisible(drafts)

  return (
    <>
      <div className="nav">
        <div className="row-top">
          <h2>Content</h2>
        </div>
        <div className="chips">
          {([['ivan', 'Ivan'], ['risedtc', 'Rise']] as const).map(([k, l]) => (
            <span key={k} className={`chip ${lane === k ? 'on' : ''}`} onClick={() => setLane(k)}>{l}</span>
          ))}
          {lane === 'risedtc' && drafts.length > 0 && (
            <span className="wb-lanenote">{onBoard} of {drafts.length} on Rise’s board</span>
          )}
        </div>
      </div>
      <div className="rows ct-rows" ref={rowsRef}>
        <PullIndicator pull={ptr.pull} refreshing={ptr.refreshing} trigger={ptr.trigger} />
        {err ? (
          <Failed
            what="The content pipeline"
            message={err}
            onRetry={refresh}
            loadedAt={drafts.length > 0 ? loadedAt : null}
          />
        ) : firstLoad ? (
          <Skeleton />
        ) : nothingMatched ? (
          filteredAway ? (
            // An empty board and a broken filter must never render the same.
            <Failed
              what="The queue filter"
              message={`Nothing matched, but ${laneTotal} draft${laneTotal === 1 ? '' : 's'} exist in this lane. The recent-or-active filter ate them.`}
              onRetry={refresh}
              loadedAt={null}
            />
          ) : (
            <CalmEmpty
              line={`No ${lane === 'ivan' ? 'Ivan' : 'Rise'} drafts in the pipeline.`}
              loadedAt={loadedAt}
            />
          )
        ) : (
          <>
            {alerts.length > 0 && (
              <>
                <div className="ct-alert" onClick={() => setAlertOpen(o => !o)}>
                  <span className="ct-alert-n">{alerts.length}</span>
                  <span className="ct-alert-t">
                    {stages.error.length > 0 && `${stages.error.length} errored`}
                    {stages.error.length > 0 && stages.stuck.length > 0 && ' · '}
                    {stages.stuck.length > 0 && `${stages.stuck.length} past due, never posted`}
                  </span>
                  <span className="chev">{alertOpen ? '⌄' : '›'}</span>
                </div>
                {alertOpen && (
                  <>
                    <div id="wb-s-error" />
                    {alerts.map(d => (
                      <Card key={d.id} d={d} lane={lane} refresh={refresh} onOpen={onOpen}
                        active={openId === d.id} />
                    ))}
                  </>
                )}
              </>
            )}

            <PipelineBar stages={stages} onJump={jump} />

            {PIPELINE_STAGES.map((s, i) => {
              const n = stages[s].length
              if (n === 0) return null
              return (
                <div key={s} id={`wb-s-${s}`}>
                  <SectionHead
                    n={String(i + 1).padStart(2, '0')}
                    title={STAGE_LABEL[s]}
                    count={n}
                    // A backlog is not a warning. Only review carries a mark, and
                    // only the neutral "pending" one.
                    sev={s === 'review' && n > 0 ? 'attention' : null}
                    open={isOpen(s)}
                    onToggle={() => toggle(s)}
                  />
                  {isOpen(s) && (
                    <>
                      {s === 'approved' && countUndated(stages.approved) > 0 && (
                        <div className="ct-subline">
                          {countUndated(stages.approved)} approved without a date — on no other surface
                        </div>
                      )}
                      {stages[s].map(d => (
                        <Card key={d.id} d={d} lane={lane} refresh={refresh} onOpen={onOpen}
                          active={openId === d.id} />
                      ))}
                    </>
                  )}
                </div>
              )
            })}

            {(['archived', 'other'] as const).map(s => stages[s].length > 0 && (
              <div key={s} id={`wb-s-${s}`}>
                <SectionHead
                  title={STAGE_LABEL[s]} count={stages[s].length}
                  open={isOpen(s)} onToggle={() => toggle(s)}
                />
                {isOpen(s) && stages[s].map(d => (
                  <Card key={d.id} d={d} lane={lane} refresh={refresh} onOpen={onOpen}
                    active={openId === d.id} />
                ))}
              </div>
            ))}
            <div style={{ height: 24 }} />
          </>
        )}
      </div>
    </>
  )
}
