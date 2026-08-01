import { useMemo, useRef, useState } from 'react'
import { PullIndicator } from '../../components/PullIndicator'
import { usePullToRefresh } from '../../hooks/usePullToRefresh'
import {
  useAgentDigest, useContent, useIdeaCandidates, useResources, useScheduledQueue, useStyleRoster,
} from '../../hooks/useContent'
import {
  CONTENT_LANES, LANE_LABEL, LANE_POSSESSIVE, PIPELINE_STAGES,
  STAGE_LABEL, countBoardVisible, countUndated, groupByStage, isStuckScheduled,
  queueFailed, reviewActionable,
  type ContentDraft, type ContentLane, type ContentStage, type ContentStages,
} from '../../lib/content'
import { isStuckResource } from '../../lib/styles'
import { applyFilters, buildFacets, draftScore, draftSpecs, type FilterState } from '../../lib/contentFilters'
import { ReviewActions } from './ReviewActions'
import { FilterBar, FilteredEmpty } from './ContentBits'
import {
  AlertCountLine, IdeasSection, PillarMix, QueueStrip, ResourcesSection,
  StyleRoster, SummariesSection,
} from './ContentSections'
import { relTime, typeLabel } from './fmt'
import { CalmEmpty, Failed, SectionHead, StackBar } from './Surface'
import { hasMock } from './mock'

// Content — TWO LANES, and nothing else.
//
//   Ivan            client_id IS NULL, plus three row sets that carry no tenancy
//                   column at all and are therefore Ivan's by construction
//   Mattan Danino   client_id = 'risedtc'
//
// They are two VIEWS and not one filtered list because they obey different
// rules. The terminal fact of an Ivan row is whether it published; the terminal
// fact of a Mattan row is whether it is on Mattan's board. On Ivan's lane
// `review` means "waiting on Ivan"; on Mattan's it means "available to be
// promoted", and 70 of his 84 rows sit there — reading that lane through the
// pipeline's eyes produces "70 things waiting on you", which is false.
//
// So: Ivan groups by pipeline stage. Mattan groups by promotion state, with
// stage as the secondary key inside each group.
//
// 'risedtc' is a database value and never reaches a label (LANE_LABEL).

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
  const score = draftScore(d)
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
            {/* QA on the card is what makes a 70-row review list scannable —
                strictly, only a literal PASS is a pass. */}
            {d.qa_verdict && (
              <span className={`ct-chip ${d.qa_verdict.trim().toUpperCase() === 'PASS' ? 'ct-chip-ok' : 'ct-chip-warn'}`}>
                {d.qa_verdict}{score !== null ? ` ${score}` : ''}
              </span>
            )}
            {d.funnel_stage && <span className="ct-chip">{d.funnel_stage}</span>}
            <span className="ct-tm">{relTime(d.updated_at)}</span>
            {lane === 'risedtc' && (
              // On a read-only lane the fact that matters is whether the client
              // can SEE the row, not that it is a client row. Strict === true:
              // absence of the flag is not evidence of promotion.
              <span className={d.board_visible === true ? 'ct-lane' : 'ct-chip'}>
                {d.board_visible === true ? 'On Mattan’s board' : 'Internal'}
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
function PipelineBar({ stages, ideas, onJump }: {
  stages: ContentStages; ideas: number; onJump: (s: ContentStage) => void
}) {
  const parts = PIPELINE_STAGES.map(s => ({
    key: STAGE_LABEL[s],
    n: s === 'ideas' ? ideas : stages[s].length,
    color: STAGE_COLOR[s],
  }))
  const total = parts.reduce((s, p) => s + p.n, 0)
  const review = stages.review.length
  const undated = countUndated(stages.approved)
  return (
    <div className="wb-pipe">
      <StackBar parts={parts} />
      <div className="wb-pipe-k">
        {parts.filter(p => p.n > 0).map((p, i) => (
          <span className="wb-pipe-i" key={p.key} onClick={() => onJump(PIPELINE_STAGES[i])}>
            <span className="wb-pipe-d" style={{ background: p.color }} />
            <b>{p.n}</b> {p.key.toLowerCase()}
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

// The alert strip. error + stuck drafts, the publish queue's failures, and the
// stuck resource all land here: a failed publish and a failed generation are the
// same class of fact to the operator even though they live in three tables.
function AlertStrip({ drafts, lane, refresh, onOpen, openId, extra }: {
  drafts: ContentDraft[]
  lane: ContentLane
  refresh: () => void
  onOpen: (id: string, label: string) => void
  openId: string | null
  extra: { key: string; line: string }[]
}) {
  const [open, setOpen] = useState(true)
  const n = drafts.length + extra.length
  if (n === 0) return null
  const errored = drafts.filter(d => d.status === 'error').length
  const stuck = drafts.filter(d => isStuckScheduled(d)).length
  return (
    <>
      <div className="ct-alert" onClick={() => setOpen(o => !o)}>
        <span className="ct-alert-n">{n}</span>
        <span className="ct-alert-t">
          {[
            errored > 0 && `${errored} errored`,
            stuck > 0 && `${stuck} past due, never posted`,
            extra.length > 0 && `${extra.length} elsewhere`,
          ].filter(Boolean).join(' · ')}
        </span>
        <span className="chev">{open ? '⌄' : '›'}</span>
      </div>
      {open && (
        <>
          <div id="wb-s-error" />
          {extra.map(e => <div className="ct-alert-x" key={e.key}>{e.line}</div>)}
          {drafts.map(d => (
            <Card key={d.id} d={d} lane={lane} refresh={refresh} onOpen={onOpen} active={openId === d.id} />
          ))}
        </>
      )}
    </>
  )
}

// A stage section with its rows. Shared by both lanes — the lanes differ in how
// they NEST these, not in how a stage renders.
function StageSection({ s, n, rows, lane, refresh, onOpen, openId, isOpen, toggle, sub }: {
  s: ContentStage
  n?: string
  rows: ContentDraft[]
  lane: ContentLane
  refresh: () => void
  onOpen: (id: string, label: string) => void
  openId: string | null
  isOpen: boolean
  toggle: () => void
  sub?: string | null
}) {
  if (rows.length === 0) return null
  return (
    <div id={`wb-s-${s}`}>
      <SectionHead
        n={n}
        title={STAGE_LABEL[s]}
        count={rows.length}
        // A backlog is not a warning. Only review carries a mark, and only the
        // neutral "pending" one.
        sev={s === 'review' && lane === 'ivan' ? 'attention' : null}
        open={isOpen}
        onToggle={toggle}
      />
      {isOpen && (
        <>
          {sub && <div className="ct-subline">{sub}</div>}
          {rows.map(d => (
            <Card key={d.id} d={d} lane={lane} refresh={refresh} onOpen={onOpen} active={openId === d.id} />
          ))}
        </>
      )}
    </div>
  )
}

const DEFAULT_OPEN: ContentStage[] = ['ideas', 'generating', 'review', 'approved']

function useOpenStages(initial: ContentStage[]) {
  const [open, setOpen] = useState<ContentStage[]>(initial)
  return {
    isOpen: (s: ContentStage) => open.includes(s),
    toggle: (s: ContentStage) =>
      setOpen(cur => (cur.includes(s) ? cur.filter(x => x !== s) : [...cur, s])),
    ensure: (s: ContentStage) => setOpen(cur => (cur.includes(s) ? cur : [...cur, s])),
  }
}

// ---------------------------------------------------------------------------
// LANE A — Ivan
// ---------------------------------------------------------------------------

function IvanLane({ drafts, stages, openId, onOpen, refresh, filters, setFilters, matched }: {
  drafts: ContentDraft[]
  stages: ContentStages
  openId: string | null
  onOpen: (id: string, label: string) => void
  refresh: () => void
  filters: FilterState
  setFilters: (f: FilterState) => void
  matched: number | null
}) {
  const stageOpen = useOpenStages(DEFAULT_OPEN)
  const ideas = useIdeaCandidates(true)
  const queue = useScheduledQueue(true)
  const resources = useResources('ivan')
  const roster = useStyleRoster()
  const digest = useAgentDigest(true)

  const alerts = [...stages.error, ...stages.stuck]
  const failedQueue = queue.rows.filter(queueFailed)
  const stuckRes = resources.rows.filter(isStuckResource)
  const extra = [
    ...(failedQueue.length > 0
      ? [{
        key: 'queue',
        line: `${failedQueue.length} publish ${failedQueue.length === 1 ? 'failure' : 'failures'} in the queue — the only place a failed publish is written down.`,
      }]
      : []),
    ...stuckRes.map(r => ({
      key: r.id,
      line: `Resource “${r.topic ?? r.id}” is ${r.status} with no landing URL (updated ${relTime(r.updated_at)}).`,
    })),
  ]

  const jump = (s: ContentStage) => {
    stageOpen.ensure(s)
    requestAnimationFrame(() => {
      document.getElementById(`wb-s-${s}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }

  const specs = draftSpecs('ivan')
  const facets = buildFacets(drafts, specs)
  const shown = applyFilters(drafts, specs, filters)
  const shownStages = groupByStage(shown)
  const scheduledThisWeek = stages.scheduled.filter(d => {
    if (!d.scheduled_at) return false
    const t = Date.parse(d.scheduled_at)
    return Number.isFinite(t) && t >= Date.now() && t < Date.now() + 7 * 86400_000
  }).length

  return (
    <>
      <AlertCountLine olderUnsent={digest.olderUnsent} />
      <AlertStrip drafts={alerts} lane="ivan" refresh={refresh} onOpen={onOpen} openId={openId} extra={extra} />
      <PipelineBar stages={stages} ideas={ideas.rows.length} onJump={jump} />
      {/* Advisory denominator, never a quota, never a gate, never red. */}
      <div className="ct-subtle">
        {scheduledThisWeek} scheduled in the next 7 days of a 4-a-week cadence — a
        denominator, not a quota. Nothing here blocks or scores against it.
      </div>

      <FilterBar
        facets={facets} state={filters} setState={setFilters}
        shown={shown.length} loaded={drafts.length} total={matched} noun="drafts"
      />

      <IdeasSection
        ideas={ideas.rows} count={ideas.count} loading={ideas.loading}
        error={ideas.error} loadedAt={ideas.loadedAt} refresh={ideas.refresh}
      />

      {shown.length === 0 && drafts.length > 0
        ? <FilteredEmpty noun="drafts" onClear={() => setFilters({})} />
        : PIPELINE_STAGES.filter(s => s !== 'ideas').map((s, i) => (
          <div key={s}>
            <StageSection
              s={s} n={String(i + 2).padStart(2, '0')} rows={shownStages[s]} lane="ivan"
              refresh={refresh} onOpen={onOpen} openId={openId}
              isOpen={stageOpen.isOpen(s)} toggle={() => stageOpen.toggle(s)}
              sub={s === 'approved' && countUndated(shownStages.approved) > 0
                ? `${countUndated(shownStages.approved)} approved without a date — on no other surface`
                : null}
            />
            {/* The publish queue rides INSIDE the Scheduled section: it answers
                the one question the drafts table cannot — did the thing that was
                scheduled actually go out. */}
            {s === 'scheduled' && stageOpen.isOpen('scheduled') && (
              <QueueStrip
                rows={queue.rows} loading={queue.loading} error={queue.error}
                loadedAt={queue.loadedAt} refresh={queue.refresh}
              />
            )}
          </div>
        ))}

      {(['archived', 'other'] as const).map(s => (
        <StageSection
          key={s} s={s} rows={shownStages[s]} lane="ivan" refresh={refresh}
          onOpen={onOpen} openId={openId}
          isOpen={stageOpen.isOpen(s)} toggle={() => stageOpen.toggle(s)}
        />
      ))}

      <PillarMix rows={drafts} />
      <ResourcesSection
        rows={resources.rows} lane="ivan" loading={resources.loading}
        error={resources.error} loadedAt={resources.loadedAt} refresh={resources.refresh}
      />
      <StyleRoster
        roster={roster.rows} laneRows={drafts} lane="ivan"
        loading={roster.loading} error={roster.error} refresh={roster.refresh}
      />
      <SummariesSection rows={digest.rows} />
    </>
  )
}

// ---------------------------------------------------------------------------
// LANE B — Mattan Danino
// ---------------------------------------------------------------------------

const BOARD_GROUPS = [
  {
    key: 'board',
    title: 'On Mattan’s board',
    note: 'Mattan can see, edit, approve, veto and reschedule these on his own board.',
  },
  {
    key: 'internal',
    title: 'Internal',
    note: 'Exists on our side only — Mattan has never seen it. Promotion happens in Client Ops, not here.',
  },
] as const

function MattanLane({ drafts, openId, onOpen, refresh, filters, setFilters, matched }: {
  drafts: ContentDraft[]
  openId: string | null
  onOpen: (id: string, label: string) => void
  refresh: () => void
  filters: FilterState
  setFilters: (f: FilterState) => void
  matched: number | null
}) {
  const stageOpen = useOpenStages(['review', 'approved', 'scheduled', 'generating'])
  const [groupOpen, setGroupOpen] = useState<string[]>(['board', 'internal'])
  const resources = useResources('risedtc')
  const roster = useStyleRoster()

  const specs = draftSpecs('risedtc')
  const facets = buildFacets(drafts, specs)
  const shown = applyFilters(drafts, specs, filters)

  const onBoard = countBoardVisible(drafts)
  const scheduled = drafts.filter(d => d.scheduled_at).length
  const noImage = drafts.filter(d => d.status === 'review' && !(d.image_urls?.length)).length

  const alerts = shown.filter(d => d.status === 'error' || isStuckScheduled(d))
  const stuckRes = resources.rows.filter(isStuckResource)
  const extra = stuckRes.map(r => ({
    key: r.id,
    line: `Resource “${r.topic ?? r.id}” has been ${r.status} since ${relTime(r.updated_at)} with no landing URL.`,
  }))

  return (
    <>
      <AlertStrip drafts={alerts} lane="risedtc" refresh={refresh} onOpen={onOpen} openId={openId} extra={extra} />

      {/* 🔴 The OBSERVED figures and no denominator: there is no weekly-cap
          constant anywhere in personal-site or in this app, and inventing
          "of 4/wk" here would be fabricating a client commitment. */}
      <div className="wb-pipe">
        <div className="wb-pipe-n">
          <span className="wb-pipe-big">{onBoard}</span>
          <span className="wb-pipe-lbl">
            on {LANE_POSSESSIVE.risedtc} board<br />of {drafts.length} in this lane
          </span>
          <span className="wb-pipe-i"><b>{scheduled}</b> with a date</span>
        </div>
        <div className="ct-subtle">
          His forward calendar lives on the client board, not in this column —
          a buffer slot is today + 4 days, rolled off the weekend, so anything
          closer than that was set by hand. This lane never writes it.
        </div>
        {noImage > 0 && (
          <div className="ct-subtle ct-warn">
            {noImage} rows at review carry no image. A regen clears
            <code> image_urls</code>, and <code>operator_schedule_draft</code> refuses
            a draft without media (<code>awaiting_media</code>) — the photo has to be
            re-pinned first.
          </div>
        )}
      </div>

      <FilterBar
        facets={facets} state={filters} setState={setFilters}
        shown={shown.length} loaded={drafts.length} total={matched} noun="drafts"
      />

      {shown.length === 0 && drafts.length > 0
        ? <FilteredEmpty noun="drafts" onClear={() => setFilters({})} />
        : BOARD_GROUPS.map((g, gi) => {
          const rows = shown.filter(d => (g.key === 'board') === (d.board_visible === true))
          if (rows.length === 0) return null
          const stages = groupByStage(rows)
          const open = groupOpen.includes(g.key)
          return (
            <div key={g.key} id={`wb-g-${g.key}`}>
              <SectionHead
                n={String(gi + 1).padStart(2, '0')}
                title={g.title}
                count={rows.length}
                open={open}
                onToggle={() => setGroupOpen(cur =>
                  cur.includes(g.key) ? cur.filter(x => x !== g.key) : [...cur, g.key])}
              />
              {open && (
                <>
                  <div className="ct-subtle">{g.note}</div>
                  {/* Stage is the SECONDARY key inside a promotion group: on
                      this lane `review` means "available to be promoted", not
                      "waiting on Ivan", so it carries no attention mark. */}
                  {([...PIPELINE_STAGES, 'error', 'stuck', 'archived', 'other'] as ContentStage[])
                    .filter(s => s !== 'ideas')
                    .map(s => (
                      <StageSection
                        key={s} s={s} rows={stages[s]} lane="risedtc" refresh={refresh}
                        onOpen={onOpen} openId={openId}
                        isOpen={stageOpen.isOpen(s)} toggle={() => stageOpen.toggle(s)}
                      />
                    ))}
                </>
              )}
            </div>
          )
        })}

      <ResourcesSection
        rows={resources.rows} lane="risedtc" loading={resources.loading}
        error={resources.error} loadedAt={resources.loadedAt} refresh={resources.refresh}
      />
      <StyleRoster
        roster={roster.rows} laneRows={drafts} lane="risedtc"
        loading={roster.loading} error={roster.error} refresh={roster.refresh}
      />
      {/* No pillar TARGET on this lane: the target constant is Ivan's editorial
          strategy. Pillar renders here as a tag and a facet, with no target. */}
    </>
  )
}

// ---------------------------------------------------------------------------

export function ContentList({ lane, setLane, openId, onOpen }: {
  lane: ContentLane
  setLane: (l: ContentLane) => void
  openId: string | null
  onOpen: (id: string, label: string) => void
}) {
  const { drafts, stages, matched, laneTotal, loading, error, loadedAt, refresh } = useContent(lane)
  const rowsRef = useRef<HTMLDivElement>(null)
  const ptr = usePullToRefresh(rowsRef, () => refresh())
  const [filters, setFilters] = useState<FilterState>({})

  // 🔴 Filters are never persisted across a lane switch: the two lanes spell the
  // same ideas differently ('story' vs 'story_opener'), so a carried filter
  // would silently hide rows — the calm, wrong, empty board again, one level
  // down. The Shell also remounts this component per lane; this is the belt.
  const switchLane = (l: ContentLane) => { setFilters({}); setLane(l) }

  const err = error ?? (hasMock('fetch-error') ? 'PostgREST returned 500 for carousel_drafts' : null)
  const firstLoad = loading && drafts.length === 0
  const nothingMatched = !loading && (matched ?? 0) === 0
  const filteredAway = nothingMatched && (laneTotal ?? 0) > 0
  const onBoard = useMemo(() => countBoardVisible(drafts), [drafts])

  return (
    <>
      <div className="nav">
        <div className="row-top">
          <h2>Content</h2>
        </div>
        <div className="chips">
          {CONTENT_LANES.map(k => (
            <span key={k} className={`chip ${lane === k ? 'on' : ''}`} onClick={() => switchLane(k)}>
              {LANE_LABEL[k]}
            </span>
          ))}
          {lane === 'risedtc' && drafts.length > 0 && (
            <span className="wb-lanenote">{onBoard} of {drafts.length} on {LANE_POSSESSIVE.risedtc} board</span>
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
              line={`No ${LANE_POSSESSIVE[lane]} drafts in the pipeline.`}
              loadedAt={loadedAt}
            />
          )
        ) : lane === 'ivan' ? (
          <IvanLane
            drafts={drafts} stages={stages} openId={openId} onOpen={onOpen} refresh={refresh}
            filters={filters} setFilters={setFilters} matched={matched}
          />
        ) : (
          <MattanLane
            drafts={drafts} openId={openId} onOpen={onOpen} refresh={refresh}
            filters={filters} setFilters={setFilters} matched={matched}
          />
        )}
        <div style={{ height: 24 }} />
      </div>
    </>
  )
}
