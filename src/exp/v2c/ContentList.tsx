import { useEffect, useMemo, useRef, useState } from 'react'
import { PullIndicator } from '../../components/PullIndicator'
import { usePullToRefresh } from '../../hooks/usePullToRefresh'
import {
  useAgentDigest, useContent, useIdeaCandidates, useScheduledQueue, useStyleRoster,
} from '../../hooks/useContent'
import {
  CONTENT_LANES, ERROR_ALARM_HOURS, LANE_LABEL, LANE_POSSESSIVE, PIPELINE_STAGES,
  STAGE_LABEL, STAGE_SHORT, STUCK_GENERATING_MINUTES, countBoardVisible, countUndated,
  elapsedMinutes, generatingSince, groupByStage, isRecentError, isStuckGenerating,
  isStuckScheduled, queueFailed, reviewActionable, stageOf,
  type ContentDraft, type ContentLane, type ContentStage, type ContentStages,
} from '../../lib/content'
import {
  applyFilters, applySearch, buildFacets, draftScore, draftSpecs, DRAFT_PROMINENT, splitFacets,
  type FilterState,
} from '../../lib/contentFilters'
import { useSectionState } from '../../hooks/useSectionState'
import { ReviewActions } from './ReviewActions'
import { FilteredEmpty } from './ContentBits'
import { FilterRow } from './FilterRow'
import {
  AlertCountLine, IdeasSection, PillarMix, QueueStrip,
  StyleRoster, SummariesSection,
} from './ContentSections'
import { relTime, typeLabel } from './fmt'
import { CalmEmpty, CapsuleChart, Failed, SectionHead } from './Surface'
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

// One working-list row, built to the spine's anchor-column contract (§7.1/7.2).
//
// What changed and why it is the single most-weighted defect in the run: the
// status/QA chip used to sit inside the WRAPPING `.ct-meta` flex, so its x
// position moved with the title's length and nothing told the eye which row it
// was on. Two fixes, both applied, because 285 rows is not a place to be clever:
//
//   1. status is expressed ON THE ANCHOR — a corner dot on the 28px plate, so
//      the stage of every row reads down a single 28px-wide column;
//   2. the status chip is slot #1 of a `flex-wrap:nowrap` meta row that can
//      never reflow, so the QA verdict is at a fixed x on every row too.
//
// The rail (anchor 28px + 12px gap) puts every row's PRIMARY text at an
// identical x at 390 and at 1440. That is what makes a three-second row-find
// possible on a list this long.
function Card({ d, lane, refresh, onOpen, active }: {
  d: ContentDraft; lane: ContentLane; refresh: () => void
  onOpen: (id: string, label: string) => void; active: boolean
}) {
  const thumb = d.image_urls?.[0]
  const title = d.title || d.topic || 'Untitled'
  const score = draftScore(d)
  const stage = stageOf(d)
  const qa = d.qa_verdict?.trim().toUpperCase()
  // GRAFT (phase 6 ask 8a, from candidate `split`): the corner dot carried the
  // STAGE, which the section the row sits in already says. It carries the QA
  // verdict now, in three states and severity tokens only — green a literal
  // PASS, amber anything that is not (FAIL / NEEDS_REGENERATE / REWRITE_OK),
  // grey no verdict at all. Grey is the honest third state: "not judged" is not
  // "judged fine", and an amber-only dot could not say the difference.
  const qaState = qa ? (qa === 'PASS' ? 'pass' : 'fail') : 'none'
  // ask 6 — a generation that died mid-run. Amber, and its count joins the
  // alert strip above.
  const stalled = isStuckGenerating(d)
  const genMins = stalled ? elapsedMinutes(generatingSince(d)) : null
  return (
    <div
      className={`ct-card ct-tap${active ? ' wb-card-on' : ''}${stalled ? ' ct-stalled' : ''}`}
      onClick={() => onOpen(d.id, title)}
    >
      {/* anchor slot — exactly ONE mark, at a fixed width, carrying the QA verdict */}
      <div className="ct-anchor" data-st={stage} data-qa={qaState}>
        {thumb
          ? <img className="ct-thumb" src={thumb} alt="" />
          : <div className="ct-thumb ct-thumb-empty" aria-hidden />}
        <span
          className="ct-anchor-dot"
          title={qa ? `QA ${d.qa_verdict}` : 'no QA verdict on this row'}
        />
      </div>
      <div className="ct-mid">
        <div className="ct-title ct-row-p">{title}</div>
        {/* CHIP DIET — phase 6 ask 5, "wtf with that chunk of tags". Up to five
            marks per row became TWO, both load-bearing: the QA verdict (slot #1,
            fixed x, the fact you scan a 70-row review list for) and the format.
            funnel_stage, the board-visibility chip and the topic echo all moved
            to the detail pane, which already renders every one of them
            (DraftPane.tsx:87, :96) — nothing was deleted, and the board chip is
            redundant on Mattan's lane anyway because that lane is GROUPED by it. */}
        <div className="ct-meta">
          {/* SLOT #1 — never reflows, never moves. Strictly, only a literal PASS
              is a pass. Rows with no verdict still spend the slot, so the column
              stays a column. On a stalled generation the slot carries the age
              instead: for that row, that IS the verdict. */}
          {stalled
            ? <span className="ct-chip ct-st ct-chip-warn">{genMins}m ⚠</span>
            : (
              <span
                className={`ct-chip ct-st ${qa ? (qa === 'PASS' ? 'ct-chip-ok' : 'ct-chip-warn') : 'ct-chip-none'}`}
              >
                {d.qa_verdict ? `${d.qa_verdict}${score !== null ? ` ${score}` : ''}` : '—'}
              </span>
            )}
          <span className="ct-chip">{typeLabel(d.type)}</span>
        </div>
      </div>
      {/* trailing slot — the two review controls stay INSIDE the row's third
          column rather than growing a 44px button bar underneath it, which is
          what keeps a 285-row list inside the 40-60px density band. The value
          itself is last, right-aligned and tabular, so every row in the list
          shares one right edge. */}
      {reviewActionable(d.status, lane) && <ReviewActions id={d.id} onDone={refresh} compact />}
      <div className="ct-tail"><span className="ct-tm">{relTime(d.updated_at)}</span></div>
    </div>
  )
}

function Skeleton() {
  return (
    <div aria-hidden>
      <div className="wb-pipe">
        <div className="sk" style={{ height: 10, borderRadius: 99 }} />
      </div>
      {/* The skeleton has to be built to the same rail as the rows it stands in
          for, or the list jumps 28px sideways the moment the fetch lands. */}
      {Array.from({ length: 8 }).map((_, i) => (
        <div className="ct-card" key={i}>
          <div className="ct-anchor"><div className="sk" style={{ width: 28, height: 28, borderRadius: 6 }} /></div>
          <div className="ct-mid">
            <div className="sk sk-line" style={{ width: '62%' }} />
            <div className="sk sk-line" style={{ width: '38%', marginTop: 4 }} />
          </div>
          <div className="ct-tail"><div className="sk sk-line" style={{ width: 40 }} /></div>
        </div>
      ))}
    </div>
  )
}

// The pipeline drawn once, at the top, as a CHART CARD in the reference's full
// anatomy (M2/M4/M9): eyebrow · the plot · legend · right-aligned Total footer
// carrying the real denominator.
//
// The plot is a capsule column per stage with the value printed INSIDE the mark
// — the single most transferable thing in the Nixtio shot, and it costs nothing
// here because the series is real: it is the stage histogram of the rows this
// list is already holding.
//
// DATA HONESTY. Two denominators, both from `Prefer: count=exact` probes and
// neither from rows.length: `matched` is the server's count of the same filter
// this list ran, `laneTotal` is every row in the lane. The ideas bank is stated
// separately and NOT folded into the bar, because the lane renders 59 of 1,716
// idea candidates — putting a truncated 59 in the same chart as a complete 285
// would draw a proportion that does not exist.
function PipelineBar({ stages, ideasShown, ideasTotal, matched, laneTotal, onJump }: {
  stages: ContentStages
  ideasShown: number
  ideasTotal: number | null
  matched: number | null
  laneTotal: number | null
  onJump: (s: ContentStage) => void
}) {
  const parts = PIPELINE_STAGES
    .filter(s => s !== 'ideas')
    .map(s => ({ stage: s, key: STAGE_LABEL[s], n: stages[s].length, color: STAGE_COLOR[s] }))
  const loaded = parts.reduce((s, p) => s + p.n, 0)
  const review = stages.review.length
  const undated = countUndated(stages.approved)
  return (
    <div className="wb-chartcard">
      <div className="wb-cardh">
        <span className="wb-cardh-t wb-eyebrow">Post pipeline</span>
        <span className="wb-cardh-x">···</span>
      </div>

      {/* The plot itself now lives in Surface.tsx so the lead-magnet lane can
          draw the same chart (phase 6 ask 2) — the post bar keeps its own hero
          figure and probe-backed footer. */}
      <CapsuleChart
        parts={parts.map(p => ({ key: p.stage, label: p.key, short: STAGE_SHORT[p.stage], n: p.n }))}
        onJump={k => onJump(k as ContentStage)}
      />

      <div className="wb-pipe-n">
        <span className="wb-pipe-big">{review}</span>
        <span className="wb-pipe-lbl">
          waiting on you<br />of {loaded} loaded
        </span>
        {undated > 0 && (
          <span className="wb-pipe-warn">{undated} approved with no date</span>
        )}
      </div>

      {/* M4 — legend + Total footer. Every figure below is a count probe. */}
      <div className="wb-cardf">
        <span className="wb-legend">
          <span className="wb-legend-d" style={{ background: 'var(--cat-1)' }} />
          <span className="wb-legend-l">In flight</span>
        </span>
        <span className="wb-legend">
          <span className="wb-legend-d" style={{ background: 'var(--cat-3)' }} />
          <span className="wb-legend-l">
            {/* ask 3: POST ideas only. This figure used to be every row in
                lm_idea_candidates at `reviewing`, lead-magnet ideas included —
                so the post pipeline's idea count quietly carried rows that were
                never going to become posts. Both numbers are now scoped to
                content_type='post', the denominator by its own exact probe. */}
            Post ideas {ideasShown} of {ideasTotal ?? '—'}
          </span>
        </span>
        <span className="wb-total">
          Total: <b>{matched ?? loaded}</b>
          {laneTotal !== null && laneTotal !== matched ? ` of ${laneTotal} in the lane` : ''}
        </span>
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
  // The strip opens itself only when it is small enough to READ. On the live
  // Ivan lane it carries 38 rows, and 38 rows of "is published with no landing
  // URL" above the pipeline chart buries every draft in the queue below it —
  // measured: the first 1440×900 viewport of the test surface contained zero
  // draft rows. The count, the breakdown and the chevron are all still there,
  // and a handful still opens on sight.
  //
  // `null` = the operator has not decided yet, so follow the data. A plain
  // `useState(n <= 6)` does NOT work here and the screenshot proved it: the
  // initialiser runs on the FIRST render, when both arrays are still empty from
  // the pending fetch, so it latches `true` and the strip is stuck open once the
  // 38 rows land. State that is seeded from data which arrives later has to be
  // derived, not initialised.
  const [open, setOpen] = useState<boolean | null>(null)
  const n = drafts.length + extra.length
  const isOpen = open ?? n <= 6
  if (n === 0) return null
  const errored = drafts.filter(d => d.status === 'error').length
  const stuck = drafts.filter(d => isStuckScheduled(d)).length
  return (
    <>
      {/* The jump target lives on the HEADER, not inside the collapsible body:
          `jump()` (:385) scrolls to `wb-s-<stage>`, and an anchor that unmounts
          with the body would send the error jump nowhere whenever the strip is
          closed. The header is what you want to land on anyway — it carries the
          count and the breakdown. */}
      <div id="wb-s-error" />
      <button type="button" className="ct-alert" onClick={() => setOpen(!isOpen)}>
        <span className="ct-alert-n">{n}</span>
        <span className="ct-alert-t">
          {[
            errored > 0 && `${errored} errored`,
            stuck > 0 && `${stuck} past due, never posted`,
            extra.length > 0 && `${extra.length} elsewhere`,
          ].filter(Boolean).join(' · ')}
        </span>
        <span className="chev">{isOpen ? '⌄' : '›'}</span>
      </button>
      {isOpen && (
        <>
          {/* the line is wrapped so it can ellipsize: a list of what is wrong,
              not prose about it. The full sentence lives on the row it points at. */}
          {extra.map(e => <div className="ct-alert-x" key={e.key}><span>{e.line}</span></div>)}
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

function IvanLane({ drafts, stages, openId, onOpen, refresh, filters, setFilters, q, setQ, matched, laneTotal }: {
  drafts: ContentDraft[]
  stages: ContentStages
  openId: string | null
  onOpen: (id: string, label: string) => void
  refresh: () => void
  filters: FilterState
  setFilters: (f: FilterState) => void
  q: string
  setQ: (q: string) => void
  matched: number | null
  laneTotal: number | null
}) {
  const stageOpen = useOpenStages(DEFAULT_OPEN)
  // Determinism under a filter (phase1-review residual): picking Stage:
  // Published used to render a different card count before vs after a reload,
  // because the persisted filter landed on a section whose open/closed state
  // was whatever the last session left. The rule is now stated: an ACTIVE
  // stage filter forces that stage's section open.
  const filterStage = filters.stage as ContentStage | undefined
  useEffect(() => {
    if (filterStage) stageOpen.ensure(filterStage)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterStage])
  const ideas = useIdeaCandidates(true)
  const queue = useScheduledQueue(true)
  const roster = useStyleRoster()
  const digest = useAgentDigest(true)

  // Deliberately built from the UNFILTERED stages: a filter may narrow the
  // flow, but it may never hide a broken row. The strip sits above the flow for
  // the same reason. Lead-magnet alerts (stalled LM generations, stuck
  // resources) moved to the Magnets job with the ResourceLane that renders
  // them — this strip is posts-only now.
  //
  // Ask 13: the strip is an ALARM, so only errors from the last 48h ring it
  // (isRecentError — taxonomy.error_flipped_at, updated_at fallback). Older
  // errored rows move to the Errors section below, still visible, not alarming.
  const alerts = [...stages.error.filter(d => isRecentError(d)), ...stages.stuck]
  const failedQueue = queue.rows.filter(queueFailed)
  // ask 6 — a generation that died mid-run. The rows stay in their Generating
  // section (that is still the stage they are in, and the row itself carries
  // the amber age chip); what joins the strip is the COUNT, so a silently-dead
  // run is visible without leaving the top of the page.
  const stalledGen = stages.generating.filter(d => isStuckGenerating(d))
  const extra = [
    ...(stalledGen.length > 0
      ? [{
        key: 'stalled-gen',
        line: `${stalledGen.length} draft${stalledGen.length === 1 ? '' : 's'} generating for over ${STUCK_GENERATING_MINUTES} minutes — the run that started ${stalledGen.length === 1 ? 'it' : 'them'} is probably dead.`,
      }]
      : []),
    ...(failedQueue.length > 0
      ? [{
        key: 'queue',
        line: `${failedQueue.length} publish ${failedQueue.length === 1 ? 'failure' : 'failures'} in the queue — the only place a failed publish is written down.`,
      }]
      : []),
  ]

  const jump = (s: ContentStage) => {
    stageOpen.ensure(s)
    requestAnimationFrame(() => {
      document.getElementById(`wb-s-${s}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }

  const specs = draftSpecs('ivan')
  // Counts are derived over EVERY loaded row, not over the current result:
  // "Published 109" is the fact the filter is being chosen against, and a count
  // that already reflects the choice you have not made yet is a moving target.
  const facets = buildFacets(drafts, specs)
  const { prominent, demoted } = splitFacets(facets, DRAFT_PROMINENT)
  const shown = applySearch(applyFilters(drafts, specs, filters), q, d => [d.title, d.topic])
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
      <PipelineBar
        stages={stages} ideasShown={ideas.split.post.length} ideasTotal={ideas.counts.post}
        matched={matched} laneTotal={laneTotal} onJump={jump}
      />
      {/* Advisory denominator, never a quota, never a gate, never red. */}
      <div className="ct-subtle">
        {scheduledThisWeek} scheduled in the next 7 days of a 4-a-week cadence — a
        denominator, not a quota. Nothing here blocks or scores against it.
      </div>

      <FilterRow
        prominent={prominent} demoted={demoted}
        state={filters} setState={setFilters} q={q} setQ={setQ}
        shown={shown.length} loaded={drafts.length} total={matched} noun="drafts"
      />

      {/* ask 3 — the POST side of the content_type partition only. Rows with no
          content_type ride here too, labelled, rather than vanishing from both
          lanes. ask 4 — collapsed by default with a sticky header. */}
      <IdeasSection
        ideas={ideas.split.post} kind="post" n="01" count={ideas.counts.post}
        unclassified={ideas.split.other}
        loading={ideas.loading}
        error={ideas.error} loadedAt={ideas.loadedAt} refresh={ideas.refresh}
      />

      {shown.length === 0 && drafts.length > 0
        ? <FilteredEmpty noun="drafts" onClear={() => { setFilters({}); setQ('') }} />
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

      {/* Ask 13's other half: errors older than the 48h alarm window are still
          IN the queue — a section, not a siren. The strip above no longer
          counts them, so without this they would vanish from the lane. */}
      <StageSection
        s="error" rows={shownStages.error.filter(d => !isRecentError(d))} lane="ivan"
        refresh={refresh} onOpen={onOpen} openId={openId}
        isOpen={stageOpen.isOpen('error')} toggle={() => stageOpen.toggle('error')}
        sub={`Errored more than ${ERROR_ALARM_HOURS} hours ago — out of the alarm strip, not out of the queue.`}
      />
      {(['archived', 'other'] as const).map(s => (
        <StageSection
          key={s} s={s} rows={shownStages[s]} lane="ivan" refresh={refresh}
          onOpen={onOpen} openId={openId}
          isOpen={stageOpen.isOpen(s)} toggle={() => stageOpen.toggle(s)}
        />
      ))}

      {/* The lead magnets LEFT this scroll entirely (usability-voice ask 1):
          they are the Magnets job now. The Content scroll ends at the summary
          sections below. */}
      <PillarMix rows={drafts} />
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

function MattanLane({ drafts, openId, onOpen, refresh, filters, setFilters, q, setQ, matched }: {
  drafts: ContentDraft[]
  openId: string | null
  onOpen: (id: string, label: string) => void
  refresh: () => void
  filters: FilterState
  setFilters: (f: FilterState) => void
  q: string
  setQ: (q: string) => void
  matched: number | null
}) {
  const stageOpen = useOpenStages(['review', 'approved', 'scheduled', 'generating'])
  const [groupOpen, setGroupOpen] = useState<string[]>(['board', 'internal'])
  // Same determinism rule as the Ivan lane: an active stage filter opens its section.
  const filterStage = filters.stage as ContentStage | undefined
  useEffect(() => {
    if (filterStage) stageOpen.ensure(filterStage)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterStage])
  const roster = useStyleRoster()

  const specs = draftSpecs('risedtc')
  const facets = buildFacets(drafts, specs)
  // The same five prominent axes as Ivan's lane, deliberately WITHOUT `board`:
  // this lane is already GROUPED by board visibility (BOARD_GROUPS below), so a
  // board pill would be a second control for a distinction the page structure
  // already draws — it stays available in the disclosure.
  const { prominent, demoted } = splitFacets(facets, DRAFT_PROMINENT)
  const shown = applySearch(applyFilters(drafts, specs, filters), q, d => [d.title, d.topic])

  const onBoard = countBoardVisible(drafts)
  const scheduled = drafts.filter(d => d.scheduled_at).length
  const noImage = drafts.filter(d => d.status === 'review' && !(d.image_urls?.length)).length

  // Stuck-resource lines moved to the Magnets job with the lane that renders
  // them; this strip is posts-only now. Ask 13: same 48h alarm window as the
  // Ivan lane — older errors keep their rows in the Errors section this lane
  // already renders below.
  const alerts = shown.filter(d => isRecentError(d) || isStuckScheduled(d))

  return (
    <>
      <AlertStrip drafts={alerts} lane="risedtc" refresh={refresh} onOpen={onOpen} openId={openId} extra={[]} />

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

      <FilterRow
        prominent={prominent} demoted={demoted}
        state={filters} setState={setFilters} q={q} setQ={setQ}
        shown={shown.length} loaded={drafts.length} total={matched} noun="drafts"
      />

      {shown.length === 0 && drafts.length > 0
        ? <FilteredEmpty noun="drafts" onClear={() => { setFilters({}); setQ('') }} />
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

      {/* The lead-magnet lane left this scroll for the Magnets job (the
          no-Mattan-ideas rule travels with it — lm_idea_candidates carries no
          tenancy column, so only the Ivan lane has an idea stage there). */}
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
  // PERSISTENCE, and the reset it deliberately replaces.
  //
  // What was here (and is now gone): `const [filters, setFilters] =
  // useState<FilterState>({})` plus `switchLane = (l) => { setFilters({});
  // setLane(l) }` — filter state was reset on every lane switch AND lost on
  // every reload, with the stated reason that "the two lanes spell the same
  // ideas differently ('story' vs 'story_opener'), so a carried filter would
  // silently hide rows."
  //
  // That reason is correct and it is preserved — by KEYING, not by amnesia. The
  // section key carries the lane (`content.posts.ivan` vs
  // `content.posts.risedtc`), so a filter set on one lane can never reach the
  // other's vocabulary; there is no carried state to mis-apply. What changes is
  // that coming BACK to a lane restores the answer you left there, and a reload
  // no longer throws it away. Forgetting was never the safety property — not
  // crossing lanes was.
  const [sect, setSect] = useSectionState(`content.posts.${lane}`)
  const setFilters = (f: FilterState) => setSect(p => ({ ...p, filters: f }))
  const setQ = (q: string) => setSect(p => ({ ...p, q }))
  const switchLane = (l: ContentLane) => setLane(l)

  const err = error ?? (hasMock('fetch-error') ? 'PostgREST returned 500 for carousel_drafts' : null)
  const firstLoad = loading && drafts.length === 0
  const nothingMatched = !loading && (matched ?? 0) === 0
  const filteredAway = nothingMatched && (laneTotal ?? 0) > 0
  const onBoard = useMemo(() => countBoardVisible(drafts), [drafts])

  return (
    <>
      {/* M1 — the display title flush left with the pill switcher right-set
          beside it, which is the reference's whole top row. The lane switch is a
          view switcher, so it keeps the pill (§6.3.2); it is not a filter and
          does not take the `label: value ⌄` grammar. */}
      <div className="nav wb-head">
        <div className="row-top">
          <h2>Content</h2>
        </div>
        <div className="chips">
          {CONTENT_LANES.map(k => (
            <button type="button" key={k} className={`chip ${lane === k ? 'on' : ''}`} onClick={() => switchLane(k)}>
              {LANE_LABEL[k]}
            </button>
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
            filters={sect.filters} setFilters={setFilters} q={sect.q} setQ={setQ}
            matched={matched} laneTotal={laneTotal}
          />
        ) : (
          <MattanLane
            drafts={drafts} openId={openId} onOpen={onOpen} refresh={refresh}
            filters={sect.filters} setFilters={setFilters} q={sect.q} setQ={setQ}
            matched={matched}
          />
        )}
        <div style={{ height: 24 }} />
      </div>
    </>
  )
}
