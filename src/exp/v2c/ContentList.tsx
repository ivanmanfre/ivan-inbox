import { useEffect, useMemo, useRef, useState } from 'react'
import { PullIndicator } from '../../components/PullIndicator'
import { usePullToRefresh } from '../../hooks/usePullToRefresh'
import {
  useContent, useIdeaCandidates, useScheduledQueue,
} from '../../hooks/useContent'
import {
  CONTENT_LANES, ERROR_ALARM_HOURS, LANE_LABEL, LANE_POSSESSIVE, PIPELINE_STAGES,
  STAGE_LABEL, STAGE_SHORT, boardGroupOf, clientStageLabel,
  countBoardVisible, countUndated, deleteClientDraft, deleteDraft, draftExcerpt,
  draftFailureReason, elapsedMinutes, generatingSince, groupByStage, isRecentError, isStuckGenerating,
  reviewActionable, stageOf, taxonomyValue,
  type BoardGroup, type ContentDraft, type ContentLane, type ContentStage, type ContentStages,
} from '../../lib/content'
import { label } from '../../lib/labels'
import {
  applyFilters, applySearch, buildFacets, draftScore, draftSpecs, DRAFT_PROMINENT, splitFacets,
  type FilterState,
} from '../../lib/contentFilters'
import { useSectionState } from '../../hooks/useSectionState'
import { draftFacetsActive } from './contentIdeas'
import { useConfirm } from '../../components/ConfirmSheet'
import { ReviewActions } from './ReviewActions'
import { FilteredEmpty } from './ContentBits'
import { FilterRow } from './FilterRow'
import { RowSelect } from './RowSelect'
import type { RowCap } from './commandStore'
import { IdeasSection, PillarMix, QueueStrip } from './ContentSections'
import { postTime, relTime, sourceLabel, tagLabel, typeLabel } from './fmt'
import { CalmEmpty, Failed, StageTabs, StatChip, type StageTab } from './Surface'
import { hasMock } from './mock'
import { ContentCalendar } from './ContentCalendar'

// The Content area holds two views of the SAME rows, and the lane tabs select
// whose. Flow is the pipeline queue; Calendar is the month those rows are
// dated into. Both read one fetch and one filter state, so they can never
// disagree about what is scheduled.
export type ContentView = 'flow' | 'calendar'
const VIEW_KEY = 'wb-content-view'

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
// Opening a draft hands the window the QUEUE it was opened from, so j/k and the
// window's rail walk exactly the rows Ivan is looking at.
export type OpenDraft = (id: string, label: string, queue: ContentDraft[]) => void

// Removing a row WITHOUT opening it — Ivan, 2026-08-04: "cant remove any of
// the content... which is super annoying". Same writes the draft window uses
// (deleteDraft / deleteClientDraft), same confirm wording. The board rows keep
// their guard: deleting a promoted draft leaves a ghost copy on Mattan's live
// board (the queue is a denormalised copy only un-promotion rebuilds), so the
// ✕ renders only where the delete is legal.
function RowDelete({ d, lane, onDone }: { d: ContentDraft; lane: ContentLane; onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const confirm = useConfirm()
  if (lane !== 'ivan' && boardGroupOf(d) === 'board') return null
  const run = async (e: React.MouseEvent) => {
    // A tap on the card opens the window; the ✕ must not also fire that.
    e.stopPropagation()
    const ok = await confirm({
      title: 'Delete this draft?',
      message: lane !== 'ivan'
        ? `${LANE_LABEL[lane]} has never seen it, and this removes it permanently.`
        : 'This removes it permanently.',
      confirmText: 'Delete',
      danger: true,
    })
    if (!ok) return
    setBusy(true); setErr('')
    try {
      await (lane !== 'ivan' ? deleteClientDraft(d.id, d.taxonomy) : deleteDraft(d.id, d.taxonomy))
      onDone()
    } catch (er) {
      setErr(er instanceof Error ? er.message : 'Could not delete')
      setBusy(false)
    }
  }
  return (
    <>
      {err && <span className="ops-err">{err}</span>}
      <button
        type="button" className="ct-x" disabled={busy}
        title="Delete draft" aria-label="Delete draft"
        onClick={run}
      >{busy ? '…' : 'Delete'}</button>
    </>
  )
}

function Card({ d, lane, refresh, onOpen, active, queue, glance }: {
  d: ContentDraft; lane: ContentLane; refresh: () => void
  onOpen: OpenDraft; active: boolean
  // The rows of the SECTION this card sits in, in render order. That order is
  // what j/k walks and what the window's rail draws, so the queue is the list
  // Ivan can actually see — filters, search and collapse state included — and
  // cannot drift from it.
  queue: ContentDraft[]
  // AT-A-GLANCE (old-board parity #2, Ivan's complaint #2). The body excerpt and
  // the armed date, on the row, so a decision can be made without opening it.
  //
  // 🔴 NEEDS-REVIEW ONLY, and the scope is the point. This is the section where
  // Ivan is deciding, so it is the one section worth spending a third line on;
  // published (109) and archived (84) are two thirds of the lane and fattening
  // those rows would cost the §7.8 density band ~200 rows deep for nothing.
  glance?: boolean
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
  // Ivan, 2026-08-04, second pass: "We need to have different columns, not
  // just put a tag on everything." Pillar / funnel / source render as fixed
  // COLUMNS (dashboard-v2's ideas table anatomy), not as chips in the meta row.
  const src = taxonomyValue(d.taxonomy, 'source')
  const pillar = taxonomyValue(d.taxonomy, 'pillar')
  const funnel = d.funnel_stage?.trim() || null
  const excerpt = glance ? draftExcerpt(d.post_body) : null
  // ERRORS TAB, THE REASON COLUMN (phase2). The QA chip above is a verdict
  // CODE (QA_BLOCKED, LINT_FAIL) at best and a bare dash at worst, and
  // neither answers "why did this fail" on its own. This line does, on every errored
  // row: taxonomy.error_message first (the pipeline's own account), the
  // labelled qa_verdict as a fallback, and an honest sentence rather than a
  // dash when the row carries neither.
  const reason = stage === 'error' ? draftFailureReason(d) : null
  // WHAT A BULK ACTION MAY DO TO THIS ROW. Declared here because this is the
  // only place that knows the row's status, its lane and whether it sits on a
  // client board; the bulk bar never infers a capability. Both rules are the
  // ones the single-row controls already obey, read from the same functions:
  // reviewActionable gates Approve and Skip, and the ✕ (RowDelete) refuses a
  // promoted client draft because deleting it leaves a ghost on the client's
  // board.
  const caps: RowCap[] = [
    ...(reviewActionable(d.status, lane) ? (['approve', 'skip'] as RowCap[]) : []),
    ...(lane === 'ivan' || boardGroupOf(d) !== 'board' ? (['delete'] as RowCap[]) : []),
  ]
  return (
    <div
      className={`ct-card ct-tap${active ? ' wb-card-on' : ''}${stalled ? ' ct-stalled' : ''}`}
      onClick={() => onOpen(d.id, title, queue)}
    >
      {/* anchor slot — exactly ONE mark, at a fixed width, carrying the QA verdict */}
      <div className="ct-anchor" data-st={stage} data-qa={qaState}>
        {/* The row's registration with the command layer: it writes data-wbrow
            on the card, which is what j/k walks and what x selects. It rides
            INSIDE the anchor because the card is a fixed seven-column grid and
            a direct child would take the anchor's own column. */}
        <RowSelect
          id={d.id} kind="draft" label={title} caps={caps}
          taxonomy={d.taxonomy} lane={lane}
        />
        {thumb
          ? <img className="ct-thumb" src={thumb} alt="" />
          : <div className="ct-thumb ct-thumb-empty" aria-hidden />}
        <span
          className="ct-anchor-dot"
          title={qa ? `QA ${label(d.qa_verdict)}` : 'no QA verdict on this row'}
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
                {d.qa_verdict ? `${label(d.qa_verdict)}${score !== null ? ` ${score}` : ''}` : '—'}
              </span>
            )}
          <span className="ct-chip">{typeLabel(d.type)}</span>
          {/* Slot #3, and only when the row HAS a date. A review-stage draft
              normally does not, so an always-rendered '—' here would spend a
              mark on the absence of a fact rather than on a fact — unlike the
              pillar/funnel/source columns, which are columns and have to hold
              their x.

              🔴 NO LONGER GLANCE-ONLY (2026-08-10, Ivan: "i cant really see post
              time"). The gate was `glance`, which is the review section alone —
              so the SCHEDULED section, the one where every row has an armed
              time and that time is the only reason to look, printed nothing but
              `1d ago`. It shows the CLOCK now, not "in 2d": the question asked
              of an armed row is which day and what time. */}
          {d.scheduled_at && (
            <span className="ct-chip ct-chip-when" title={`Scheduled for ${d.scheduled_at}`}>
              {postTime(d.scheduled_at)}
            </span>
          )}
        </div>
        {/* The line the old board never made him open a row for
            (StudioListView.tsx:463-503). Absent — not blank — when the body has
            not been generated yet. */}
        {glance && excerpt && <div className="ct-ex">{excerpt}</div>}
        {/* SOURCE LEGIBILITY, Mattan-lane only (phase7). d.source_label is the
            richer source (a whole sentence, on 91% of his drafts) that used to
            live in the detail pane alone — the .ct-colv source column three
            spans down is a coarser taxonomy.source slug AND folds away below
            1300px (faithful.css "THE TABLE SHEDS COLUMNS"). This rides in
            .ct-mid instead, so it is never gated by that breakpoint and reads
            at every width. Quiet on purpose (text3, one line, ellipsis) — this
            is an operator surface, not a redesign. */}
        {lane !== 'ivan' && d.source_label && (
          <div className="ct-src" title={d.source_label}>{d.source_label}</div>
        )}
        {/* THE REASON, ON EVERY ONE OF THE 46 ROWS (phase2). One line, meta
            tier, truncated with the full text in the title, the same
            treatment .ct-src already uses for a value that can run to a
            whole sentence. */}
        {reason && <div className="ct-reason" title={reason}>{reason}</div>}
      </div>
      {/* The three facts as COLUMNS, one fixed x each, '—' when absent so the
          column stays a column. Desktop only — below 1000px there is no width
          for a table and the row keeps its two-line phone shape. */}
      <span className="ct-colv" title={pillar ? `Pillar: ${tagLabel(pillar)}` : undefined}>{pillar ? tagLabel(pillar) : '—'}</span>
      <span className="ct-colv" title={funnel ? `Funnel stage: ${tagLabel(funnel)}` : undefined}>{funnel ? tagLabel(funnel) : '—'}</span>
      <span className="ct-colv" title={src ? `Source: ${sourceLabel(src)}` : undefined}>{src ? sourceLabel(src) : '—'}</span>
      {/* trailing slot — the two review controls stay INSIDE the row's third
          column rather than growing a 44px button bar underneath it, which is
          what keeps a 285-row list inside the 40-60px density band. The value
          itself is last, right-aligned and tabular, so every row in the list
          shares one right edge. */}
      {reviewActionable(d.status, lane) && (
        <ReviewActions id={d.id} onDone={refresh} compact demoteApprove={stage === 'error'} />
      )}
      <div className="ct-tail">
        <span className="ct-tm">{relTime(d.updated_at)}</span>
        <RowDelete d={d} lane={lane} onDone={refresh} />
      </div>
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

// THE COMMAND STRIP — candidate B's one structural bet.
//
// It replaces, on one band, five stacked ones: the 122px display hero, the 50px
// alert strip, the 261px pipeline chart card, the 16px cadence line and the
// 96px filter block. Measured on the live Ivan lane at 390: 707 of the 765
// usable pixels were chrome and the first screen held ZERO rows (D3). The
// numbers did not go away — every one of them is still on this strip, drawn as
// a mark small enough to sit beside the work instead of above it.
//
// The rules it keeps, because they are the reasons those blocks were built:
//   · ONE WORD PER NUMBER — `in pipeline`, `in the lane` and `loaded` are three
//     different denominators and each is stated where it is used (D5);
//   · the ideas bank is NOT folded into the pipeline marks — the lane renders a
//     truncated slice of lm_idea_candidates and a truncated series beside a
//     complete one draws a proportion that does not exist;
//   · published keeps its slot as a lane fact, never as a pipeline mark — it
//     accumulates forever and would set the scale on its own.
//
// 🔴 2026-08-07 — THREE MARKS CAME OFF IT, AT IVAN'S WORD. "228 loaded · 2
// scheduled · 7d cadence" and the "6 │ 6 errored +2 notes" band are, verbatim,
// "all not needed". That consciously reverses part of D11 (the error band's
// arithmetic fix) and retires the lane figure D5 was written about — those
// notes stay above because they are the reasoning that produced the marks, and
// a deleted rationale is how the same mark grows back.
//
// What the strip carries now: the lane switch, the view switch, the four stage
// marks, search, Filters. Nothing that was REACHABLE only through the removed
// band was deleted with it — the errored and past-due rows have their own
// sections below, and the pipeline notes moved to Ops (OpsBoard, PipelineNotes).
function CommandStrip({
  lane, setLane, view, setView, laneNote, stats, filter,
}: {
  lane: ContentLane
  setLane: (l: ContentLane) => void
  view?: ContentView
  setView?: (v: ContentView) => void
  laneNote?: React.ReactNode
  stats?: React.ReactNode
  filter: React.ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  // The strip is sticky at the top of the scroller and the SECTION HEADS are
  // sticky too, so the heads have to be told where the strip ends or they slide
  // underneath it and a 285-row list loses the label of the section it is
  // showing. The strip wraps at narrow widths, so its height is a measurement,
  // never a constant.
  useEffect(() => {
    const el = ref.current
    const rows = el?.closest('.rows') as HTMLElement | null
    if (!el || !rows || typeof ResizeObserver === 'undefined') return
    const set = () => rows.style.setProperty('--ct-cmdh', `${Math.ceil(el.getBoundingClientRect().height)}px`)
    set()
    const ro = new ResizeObserver(set)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return (
    <div className="ct-cmd" ref={ref}>
      {/* `display:contents` on the wide pointer canvas, so these are direct
          members of the strip's one flex line; TWO 44px LINES below 1200 and on
          the phone. One element, three behaviours, no second DOM. */}
      <div className="ct-cmd-top">
        <div className="ct-cmd-scroll">
          <div className="ct-cmd-id">
            {/* NO JOB TITLE. The rail names the job on the pointer canvas and the
                work segment names it on the phone, in every data state — a third
                print inside the strip is the D6 doubling one level down. */}
            {/* The lane switch is a VIEW switcher, so it keeps the pill grammar it
                has always had; it is not a filter and never takes `label: value ⌄`. */}
            <div className="ct-cmd-lanes">
              {CONTENT_LANES.map(k => (
                <button
                  type="button" key={k}
                  className={`ct-cmd-lane${lane === k ? ' on' : ''}`}
                  aria-current={lane === k ? 'true' : undefined}
                  onClick={() => setLane(k)}
                >{LANE_LABEL[k]}</button>
              ))}
            </div>
            {/* The Flow/Calendar switch sits INSIDE the id cluster, beside the
                lane pills, because it answers the same kind of question: which
                view of this lane am I looking at. Same pill grammar, and the
                lane it switches inside is the calendar's only selector — there
                is no second lane control on the calendar. */}
            {view && setView && (
              <div className="ct-cmd-lanes ct-cmd-views">
                {(['flow', 'calendar'] as const).map(v => (
                  <button
                    type="button" key={v}
                    className={`ct-cmd-lane${view === v ? ' on' : ''}`}
                    aria-current={view === v ? 'true' : undefined}
                    onClick={() => setView(v)}
                  >{v === 'flow' ? 'Flow' : 'Calendar'}</button>
                ))}
              </div>
            )}
            {laneNote}
          </div>
          {stats}
        </div>
      </div>
      <div className="ct-cmd-f">{filter}</div>
    </div>
  )
}

// The pipeline, as marks that fit on the strip.
//
// PUBLISHED IS NOT A MARK (2026-08-03, Ivan: "delete published we dont need to
// see that on that pipeline stuff") — it is an archive count he never acts on
// and the only stage that accumulates forever, so it would set the scale by
// itself. It keeps its number, in the lane figure at the end of the row, which
// is where an archive total belongs.
function PipelineStats({ stages, onJump }: {
  stages: ContentStages
  onJump: (s: ContentStage) => void
}) {
  const parts = PIPELINE_STAGES
    .filter(s => s !== 'ideas' && s !== 'published')
    .map(s => ({ stage: s, n: stages[s].length }))
  const peak = Math.max(1, ...parts.map(p => p.n))
  // 🔴 ONE WORD PER NUMBER (D5). This sum is every PIPELINE stage, published
  // included — deliberately wider than the marks, so narrowing the drawing does
  // not silently restate the denominator. It is NOT the lane: error, stuck,
  // archived and other are ~105 more rows it never counts, which is why the
  // lane figure beside it reads `of N in the lane` and the filter row's own
  // count says `loaded`. Three numbers, three words, none of them shared.
  const inPipeline = PIPELINE_STAGES
    .filter(s => s !== 'ideas')
    .reduce((a, s) => a + stages[s].length, 0)
  const undated = countUndated(stages.approved)
  return (
    <div className="ct-cmd-stats">
      {parts.map(p => (
        <StatChip
          key={p.stage}
          label={STAGE_SHORT[p.stage]}
          full={STAGE_LABEL[p.stage]}
          n={p.n}
          peak={peak}
          color={STAGE_COLOR[p.stage]}
          tone={p.stage === 'review' && p.n > 0
            ? 'attention'
            : p.stage === 'approved' && undated > 0 ? 'attention' : null}
          title={p.stage === 'review'
            ? `waiting on you · ${inPipeline} in pipeline`
            : p.stage === 'approved' && undated > 0
              ? `${undated} of them approved with no date — on no other surface`
              : `${inPipeline} in pipeline`}
          onClick={() => onJump(p.stage)}
        />
      ))}
      {/* 🔴 THE LANE FIGURE IS GONE (2026-08-07, "228 loaded … not needed"). The
          filter row still prints `9 of 224 shown` whenever a filter is on, which
          is the one place that denominator does work; the idle count stays
          suppressed on Ivan's lane exactly as it was. */}
    </div>
  )
}

// THE ALARM BAND IS GONE (2026-08-07), and this is the note that keeps its
// reasoning where the next reader will find it.
//
// Ivan, verbatim: the "6 │ 6 errored +2 notes" band is "all not needed". That
// reverses part of D11 — the arithmetic fix that made the band's number count
// ROWS and its breakdown sum to it. The fix was correct; the band was still one
// more thing on a strip he reads every day.
//
// 🔴 REMOVING IT WOULD HAVE DELETED REACH, and that part was not allowed. Three
// things were reachable through the band and nowhere else, so each was rehomed
// BEFORE the band came out (verified, not assumed — the Ops rail badge counts
// `ops_drafts`, which has never contained a carousel_drafts row):
//
//   · errors from the last 48h — the Errors section used to exclude exactly the
//     rows the alarm was holding (`!isRecentError`). It now renders EVERY
//     errored row, newest first, and says which of them are inside the window;
//   · past-due schedules (`stages.stuck`) — no section rendered that stage on
//     this lane at all. It has one now;
//   · the pipeline NOTES (a dead generation run, a failed publish, the
//     pre-window alert backlog) — those moved to Ops, where the quiet count
//     belongs, and Ops can jump straight back to the Errors section here.
//
// StageSection is GONE (2026-08-20). Both lanes render StageTable under a tab
// now, so the collapsible header it drew — number, title, count, severity dot,
// chevron — has no surface left. Everything it carried survives: the count and
// the dot moved onto the tab, the title IS the tab, and the sub-line moved into
// the table. The one thing deliberately not rebuilt is the chevron.
// ---------------------------------------------------------------------------
// THE TABS — one stage on screen at a time (2026-08-20)
// ---------------------------------------------------------------------------
//
// Ivan, verbatim: "i dont like the pile format on the stages can we make this
// more column based like ideas, review, scheduled, published, errors instead of
// horizontal pillars, make it more clickup table were i can switch between
// them".
//
// The pile is what the stacked sections are: nine collapsible headers down one
// scroller, so reaching Errors (54 rows) or Published (109) meant scrolling
// past every stage above it and the answer to "how much is at this stage" was
// a number you had to scroll to find. The tab bar states all of them at once —
// the counts are the bar — and the table below it is ONE stage, full height,
// starting at the top of the screen.
//
// What this deliberately keeps from the piles:
//   · the column head and the row anatomy are untouched (§7.1 anchor rail);
//   · the SUB-LINES survive per tab — the 48h error scope, the approved-with-no-
//     date count, the past-due explanation. Those are the sentences that make a
//     count mean something, and a tab bar that dropped them would be prettier
//     and less honest;
//   · the publish queue still rides under Scheduled, because it answers the
//     question that stage asks.
// What it drops: the per-section collapse state. A tab IS the open/closed
// answer, so there is nothing left for a chevron to say.
type ContentTab = ContentStage | 'ideas'

// Render order of the bar. Ivan named five ("ideas, review, scheduled,
// published, errors"); the four he did not name are stages this lane really
// holds and cannot be reached any other way, so they ride at the end rather
// than being deleted with the piles. `stuck`/`archived`/`other` only appear
// when they have rows — an always-on tab reading 0 spends a slot on a stage
// that does not exist today.
const TAB_ORDER: ContentTab[] = [
  'ideas', 'review', 'generating', 'approved', 'scheduled', 'published',
  'error', 'stuck', 'archived', 'other',
]
const TAB_ALWAYS: ContentTab[] = ['ideas', 'review', 'generating', 'approved', 'scheduled', 'published', 'error']

// ONE KEY PER LANE. Ivan's lane and the client lanes do not even share a tab
// VOCABULARY — his are stages, theirs are group-plus-stage — so a single key
// would restore a tab that does not exist on the lane being opened. `readTab`
// validates against the lane's own list and falls back rather than trusting
// what it read.
function tabStoreKey(lane: ContentLane): string { return `wb-content-tab-${lane}` }

function readTab(lane: ContentLane, valid: readonly string[], fallback: string): string {
  try {
    const v = localStorage.getItem(tabStoreKey(lane))
    return v && valid.includes(v) ? v : fallback
  } catch { return fallback }
}

// The tab, persisted. Returned as [value, set] so both lanes state the rule
// once: writing the answer to storage is part of selecting a tab, never a
// separate effect that can be forgotten on one of the two call sites.
function useStageTab(lane: ContentLane, valid: readonly string[], fallback: string) {
  const [tab, setTabState] = useState<string>(() => readTab(lane, valid, fallback))
  const setTab = (t: string) => {
    setTabState(t)
    try { localStorage.setItem(tabStoreKey(lane), t) } catch { /* private mode */ }
  }
  // The lane switch changes the vocabulary underfoot. Re-read for the new lane
  // rather than carrying the old lane's answer into a bar that has no such tab
  // — which renders every tab unselected and a table nobody asked for.
  const laneRef = useRef(lane)
  useEffect(() => {
    if (laneRef.current === lane) return
    laneRef.current = lane
    setTabState(readTab(lane, valid, fallback))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lane])
  return [laneRef.current === lane ? tab : readTab(lane, valid, fallback), setTab] as const
}

// One stage's rows as a table. No header and no chevron: the tab above it is
// both. An empty stage says so in a sentence rather than rendering nothing,
// because in tab mode "nothing there" and "I clicked the wrong thing" look
// identical on a blank screen.
function StageTable({ s, rows, lane, refresh, onOpen, openId, sub, empty }: {
  s: ContentStage
  rows: ContentDraft[]
  lane: ContentLane
  refresh: () => void
  onOpen: OpenDraft
  openId: string | null
  sub?: string | null
  empty?: string
}) {
  return (
    <div id={`wb-s-${s}`}>
      {sub && <div className="ct-subline">{sub}</div>}
      {rows.length === 0
        ? <CalmEmpty line={empty ?? `Nothing at ${STAGE_LABEL[s].toLowerCase()}.`} loadedAt={null} />
        : (
          <>
            <div className="ct-cols-head" aria-hidden>
              <span /><span>Title</span><span>Pillar</span><span>Funnel</span>
              <span>Source</span><span /><span />
            </div>
            {rows.map(d => (
              <Card
                key={d.id} d={d} lane={lane} refresh={refresh} onOpen={onOpen}
                active={openId === d.id} queue={rows}
                // The decision surface, and only it — see Card's `glance` note.
                glance={s === 'review'}
              />
            ))}
          </>
        )}
    </div>
  )
}

// WHAT WENT WITH THE PILES (2026-08-20), and why the reasoning stays:
//
//   · DEFAULT_OPEN — "LOOK HOW ANNOYING IS NOW TO OPEN EVERYTHING" (Ivan,
//     2026-08-04) reversed the default-collapsed rule so the working stages
//     opened themselves. The tabs keep the intent and cost nothing to hold it:
//     the stage you land on is always open, because it is the only one drawn.
//   · TRIAGE_ORDER — triage order, not lifecycle order: the stage that needs
//     Ivan went first because lifecycle order buried Review under ~450px of
//     chrome ("i have to scroll super vertical and long"). The tab bar keeps
//     the rule where it still bites — `readTab` defaults to REVIEW — while the
//     bar itself reads left-to-right in pipeline order, which is the order a
//     row actually travels and the only one a reader can predict.
//
// Both constants are gone rather than kept unused: a stage list nothing renders
// is a second source of truth waiting to disagree with TAB_ORDER.

// The per-section collapse store went with the sections. Its sentinel (a
// TOUCHED marker that told "he closed everything" apart from "he has not
// decided yet") lives on in contentIdeas.ts for the ideas band, which is the
// other writer of that array.

// ---------------------------------------------------------------------------
// LANE A — Ivan
// ---------------------------------------------------------------------------

function IvanLane({ drafts, stages, openId, onOpen, refresh, filters, setFilters, q, setQ, matched, view, setView, lane, setLane }: {
  drafts: ContentDraft[]
  stages: ContentStages
  lane: ContentLane
  setLane: (l: ContentLane) => void
  openId: string | null
  onOpen: OpenDraft
  refresh: () => void
  filters: FilterState
  setFilters: (f: FilterState) => void
  q: string
  setQ: (q: string) => void
  matched: number | null
  view: ContentView
  setView: (v: ContentView) => void
}) {
  // ONE TAB, persisted per lane. A view preference, so it keeps its own
  // localStorage key rather than riding in the section entry the filters use.
  const [tabRaw, setTab] = useStageTab('ivan', TAB_ORDER, 'review')
  const tab = tabRaw as ContentTab
  // Determinism under a filter (phase1-review residual): picking Stage:
  // Published used to render a different card count before vs after a reload.
  // The tabs inherit the rule unchanged — an ACTIVE stage filter selects its
  // tab, so the filter and the table can never be describing two stages.
  const filterStage = filters.stage as ContentStage | undefined
  useEffect(() => {
    if (filterStage) setTab(filterStage)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterStage])
  const ideas = useIdeaCandidates(true)
  const queue = useScheduledQueue(true)

  // WHAT USED TO BE COMPUTED HERE and is not any more: `alerts` (recent errors
  // plus past-due schedules) and `extra` (the three pipeline notes). Both fed
  // the strip band Ivan retired on 2026-08-07. The rows they held are rendered
  // as their own sections below — every errored row, not just the old ones, and
  // a Past due section this lane never had — and the notes are computed in Ops
  // now (usePipelineHealth), which is also where the digest read that fed the
  // third one went. Nothing derives them twice.

  // A stage mark on the strip SELECTS its tab. It used to open a section and
  // scroll to it; with one stage on screen the scroll has nothing left to do,
  // and the top of the list is where the table already starts.
  const jump = (s: ContentStage) => setTab(s)

  // The other end of Ops' jump ("Open them in Content").
  useEffect(() => {
    const on = () => setTab('error')
    window.addEventListener('wb-open-content-errors', on)
    return () => window.removeEventListener('wb-open-content-errors', on)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const specs = draftSpecs('ivan')
  // Counts are derived over EVERY loaded row, not over the current result:
  // "Published 109" is the fact the filter is being chosen against, and a count
  // that already reflects the choice you have not made yet is a moving target.
  const facets = buildFacets(drafts, specs)
  const { prominent, demoted } = splitFacets(facets, DRAFT_PROMINENT)
  // post_body is ALREADY selected (content.ts COLS) and was already in memory;
  // leaving it out of the search meant "where is that draft about margins"
  // found 1 of the 5 drafts that say margin on Ivan's lane (GET probe
  // 2026-08-22, evidence/ai-tools/tenancy-probe.md §3). It is a substring scan
  // over rows that are already here, so it costs no fetch and no round trip.
  const shown = applySearch(applyFilters(drafts, specs, filters), q, d => [d.title, d.topic, d.post_body])
  const shownStages = groupByStage(shown)
  const ideasHidden = draftFacetsActive(filters, q)

  return (
    <>
      <CommandStrip
        lane={lane} setLane={setLane} view={view} setView={setView}
        stats={
          // CALENDAR ONLY, since 2026-08-20. The marks and the tab bar print the
          // same four numbers one row apart — measured on the first tabbed
          // render: "Gen 0 · Review 1 · Appr 0 · Sched 2" sat directly above
          // "Generating 0 · Needs review 1 · Approved 0 · Scheduled 2". That is
          // the D6 doubling, and the tabs win it: they carry every stage rather
          // than four, and the click SELECTS rather than scrolls.
          // The calendar has no tab bar, so there the marks keep their job —
          // count the lane, and take you back to the rows.
          view === 'calendar'
            ? <PipelineStats stages={stages} onJump={s => { setView('flow'); jump(s) }} />
            : undefined
        }
        filter={
          // idleCount={false}: an unfiltered total on Ivan's lane was the figure
          // the strip printed two slots left. That figure is gone now, and this
          // stays suppressed for the reason it was suppressed on 08-04 — the
          // FILTERED line (`9 of 224 shown`) is the number doing work, and it is
          // never suppressed.
          <FilterRow
            prominent={prominent} demoted={demoted}
            state={filters} setState={setFilters} q={q} setQ={setQ}
            shown={shown.length} loaded={drafts.length} total={matched} noun="drafts"
            idleCount={false} inline
          />
        }
      />

      {view === 'calendar' ? (
        // 🔴 BOTH SOURCES, one refresh. The calendar draws drafts AND the
        // publish queue, so a move that re-read only the drafts would leave half
        // the grid on the copy it was mounted with — the stale half being the
        // one that changes on a clock.
        <ContentCalendar
          rows={shown} queue={queue.rows} onOpen={onOpen}
          refresh={() => { refresh(); queue.refresh() }}
        />
      ) : (
      <>
      <StageTabs
        active={tab} onSelect={k => setTab(k)}
        tabs={TAB_ORDER
          .map(t => ({
            key: t,
            label: t === 'ideas' ? 'Ideas' : STAGE_LABEL[t],
            // The ideas bank is a truncated slice of lm_idea_candidates, so its
            // tab prints the SERVER count — the same figure the old band
            // printed, for the same reason: a truncated number beside nine
            // complete ones reads as a stage smaller than it is. Every other
            // tab counts the rows the click will produce.
            n: t === 'ideas'
              ? (ideas.counts.post ?? ideas.split.post.length)
              : shownStages[t].length,
            mark: t === 'review',
          }))
          .filter(t => TAB_ALWAYS.includes(t.key as ContentTab) || t.n > 0)}
      />

      {/* ask 3 — the POST side of the content_type partition only. Rows with no
          content_type ride here too, labelled, rather than vanishing from both
          lanes. It is its own TAB now rather than a band above the stages, and
          it renders open: the tab is the toggle. While a draft facet is on it
          still keeps its header and its count and drops its rows. */}
      {tab === 'ideas' ? (
        <IdeasSection
          ideas={ideas.split.post} kind="post" count={ideas.counts.post}
          unclassified={ideas.split.other}
          loading={ideas.loading}
          error={ideas.error} loadedAt={ideas.loadedAt} refresh={ideas.refresh}
          hiddenByFilter={ideasHidden}
          // No isOpen/onToggle: the band keeps its OWN open flag, which
          // defaults open. Wiring a noop toggle here would draw a chevron that
          // does nothing — the one thing worse than a control you have to
          // learn is a control that lies.
        />
      ) : shown.length === 0 && drafts.length > 0 ? (
        /* The filter matched nothing ANYWHERE — said once, above the tabs'
           worth of empty tables, with the one control that undoes it. A
           per-tab "nothing at this stage" would be true and useless here: the
           stage is not the reason. */
        <FilteredEmpty noun="drafts" onClear={() => { setFilters({}); setQ('') }} />
      ) : (
        <>
          <StageTable
            s={tab} rows={shownStages[tab]} lane="ivan"
            refresh={refresh} onOpen={onOpen} openId={openId}
            sub={
              tab === 'approved' && countUndated(shownStages.approved) > 0
                ? `${countUndated(shownStages.approved)} approved without a date — on no other surface`
                // 🔴 EVERY ERRORED ROW, not the old ones only. This table used
                // to exclude the last 48 hours because that window belonged to
                // an alarm band; the band went in 2026-08-07 and the window
                // survives as this sentence, which is where a time scope
                // belongs once it is no longer a siren.
                : tab === 'error'
                  ? (() => {
                    const recent = shownStages.error.filter(d => isRecentError(d)).length
                    return recent > 0
                      ? `${recent} of these errored inside the last ${ERROR_ALARM_HOURS} hours.`
                      : `Nothing has errored in the last ${ERROR_ALARM_HOURS} hours.`
                  })()
                  // PAST DUE — a scheduled row whose time came and went with no
                  // `source_post_id`. It was only ever visible inside the alarm
                  // band, so it keeps its own tab and its own sentence.
                  : tab === 'stuck'
                    ? 'Their time passed and no published post came back — they never went out.'
                    : null
            }
            empty={tab === 'review' ? 'Nothing is waiting on you.' : undefined}
          />
          {/* The publish queue rides INSIDE the Scheduled tab: it answers the
              one question the drafts table cannot — did the thing that was
              scheduled actually go out. */}
          {tab === 'scheduled' && (
            <QueueStrip
              rows={queue.rows} loading={queue.loading} error={queue.error}
              loadedAt={queue.loadedAt} refresh={queue.refresh}
            />
          )}
          {/* Magnets left this scroll on 08-03; Styles followed on 08-04 (its
              own job now) and the daily summaries moved to Ops. The pillar mix
              is a fact about the WHOLE lane, not about one stage, so it rides
              under the archive tab rather than under every table. */}
          {tab === 'published' && <PillarMix rows={drafts} />}
        </>
      )}
      </>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// LANE B — Mattan Danino
// ---------------------------------------------------------------------------

// ONE LEVEL, and since 2026-08-20 one TAB BAR — Ivan: "make sure everyone has
// it like that".
//
// Ivan, 2026-08-04: "for mattan idk why there are 2 categories, not on his
// board and waiting on u... bc those are the same". The old render nested a
// "Waiting on you" stage section inside a "Not on his board" group header —
// two headers stacked over the same rows. The group level went then, and
// clientStageLabel carries the where instead ("On buffer · client board",
// "Client approved"), which is exactly what makes a FLAT tab bar possible here:
// every tab's label already says both whose turn it is and where the row sits.
//
// 🔴 A CLIENT TAB IS GROUP-PLUS-STAGE, not a stage. `review` means two
// different things on this lane — ours means "Ivan has not decided whether the
// client should see it", his means "the client has it and has not answered" —
// so one Review tab holding both would be the collision the group labels exist
// to prevent. The key is `${group}_${stage}`, the same composite the collapse
// state used, and it stays inside sectionState's KEY_RE (/^[a-z][a-z0-9_]*$/).
const BOARD_ORDER: BoardGroup[] = ['internal', 'board']

// Every stage a client row can hold, in pipeline order, minus `ideas` (that
// bank is Ivan's — lm_idea_candidates carries no tenancy column at all).
const CLIENT_STAGES: ContentStage[] = [
  'review', 'generating', 'approved', 'scheduled', 'published',
  'error', 'stuck', 'archived', 'other',
]
const CLIENT_TAB_KEYS: string[] = BOARD_ORDER.flatMap(g => CLIENT_STAGES.map(s => `${g}_${s}`))
// The one tab that shows at zero. It is the decision the lane exists to ask
// for, and a bar that hid it on a quiet day would answer "is anything waiting
// on me" by omission.
const CLIENT_TAB_ALWAYS = 'internal_review'

function MattanLane({ drafts, openId, onOpen, refresh, filters, setFilters, q, setQ, matched, view, setView, lane, setLane, onBoard }: {
  drafts: ContentDraft[]
  lane: ContentLane
  setLane: (l: ContentLane) => void
  // The lane's one standing fact, and it belongs on the strip beside the lane
  // switch rather than under a display title: how much of what we hold he can
  // actually see.
  onBoard: number
  openId: string | null
  onOpen: OpenDraft
  refresh: () => void
  filters: FilterState
  setFilters: (f: FilterState) => void
  q: string
  setQ: (q: string) => void
  matched: number | null
  view: ContentView
  setView: (v: ContentView) => void
}) {
  // The lane opens on the decision it is asking for. Per-lane key, so RISE and
  // ARCH keep their own answer.
  const [tab, setTab] = useStageTab(lane, CLIENT_TAB_KEYS, CLIENT_TAB_ALWAYS)
  // Same determinism rule as the Ivan lane: an active stage filter selects its
  // tab, so the filter and the table can never describe two different stages.
  // OURS first — a stage filter on this lane is Ivan asking about work he still
  // holds; if that half is empty the effect below falls through to the client's.
  const filterStage = filters.stage as ContentStage | undefined
  const specs = draftSpecs(lane)
  const facets = buildFacets(drafts, specs)
  // The same five prominent axes as Ivan's lane, deliberately WITHOUT `board`:
  // this lane is already GROUPED by board visibility (BOARD_ORDER below), so a
  // board pill would be a second control for a distinction the page structure
  // already draws — it stays available in the disclosure.
  const { prominent, demoted } = splitFacets(facets, DRAFT_PROMINENT)
  // post_body is ALREADY selected (content.ts COLS) and was already in memory;
  // leaving it out of the search meant "where is that draft about margins"
  // found 1 of the 5 drafts that say margin on Ivan's lane (GET probe
  // 2026-08-22, evidence/ai-tools/tenancy-probe.md §3). It is a substring scan
  // over rows that are already here, so it costs no fetch and no round trip.
  const shown = applySearch(applyFilters(drafts, specs, filters), q, d => [d.title, d.topic, d.post_body])

  // No alarm band here either (2026-08-07). This lane never needed a rehoming
  // pass for it: it already renders EVERY stage — `error` and `stuck` included —
  // inside both board categories, so the band was the only surface on which
  // those rows appeared twice.

  // The two halves, split ONCE. boardGroupOf, never an inline
  // `board_visible === true`: the grouping and the count that heads the lane
  // have to agree about NULL, and they only can if they ask the same function.
  const byGroup: Record<BoardGroup, ContentStages> = {
    internal: groupByStage(shown.filter(d => boardGroupOf(d) === 'internal')),
    board: groupByStage(shown.filter(d => boardGroupOf(d) === 'board')),
  }
  const tabs: StageTab[] = BOARD_ORDER.flatMap(g => CLIENT_STAGES.map(st => ({
    key: `${g}_${st}`,
    label: clientStageLabel(st, g),
    n: byGroup[g][st].length,
    // OUR review is the only tab that carries the waiting-on-you dot. A mark on
    // the rows the client is sitting on would point at work that is not his to
    // do or Ivan's to chase.
    mark: g === 'internal' && st === 'review',
  }))).filter(t => t.key === CLIENT_TAB_ALWAYS || t.n > 0)

  // An active stage filter selects a tab that exists. Ours first, then the
  // client's — a stage filter here is Ivan asking about work he still holds.
  useEffect(() => {
    if (!filterStage) return
    const wanted = [`internal_${filterStage}`, `board_${filterStage}`]
      .find(k => tabs.some(t => t.key === k))
    if (wanted) setTab(wanted)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterStage])

  // The tab a reload restored can be a stage that has since emptied, and the
  // bar drops empty tabs — so the selection is resolved against what is on the
  // bar RIGHT NOW rather than trusted. Falling back to the first tab keeps the
  // table and the highlighted pill describing the same rows.
  const active = tabs.some(t => t.key === tab) ? tab : (tabs[0]?.key ?? CLIENT_TAB_ALWAYS)
  const [activeGroup, activeStage] = (() => {
    const i = active.indexOf('_')
    return [active.slice(0, i) as BoardGroup, active.slice(i + 1) as ContentStage]
  })()

  return (
    <>
      <CommandStrip
        lane={lane} setLane={setLane} view={view} setView={setView}
        laneNote={drafts.length > 0
          ? (
            <span className="ct-cmd-note" title={`${onBoard} of the ${drafts.length} loaded drafts are visible on ${LANE_POSSESSIVE.risedtc} board`}>
              <b>{onBoard}</b>/{drafts.length} on his board
            </span>
          )
          : undefined}
        filter={
          // idleCount={false}, matching Ivan's lane (2026-08-07). With the
          // strip's own lane figure retired, an unfiltered `103 drafts` here was
          // the last survivor of exactly the cluster he called not needed. The
          // FILTERED line is untouched — that one is the number doing work.
          <FilterRow
            prominent={prominent} demoted={demoted}
            state={filters} setState={setFilters} q={q} setQ={setQ}
            shown={shown.length} loaded={drafts.length} total={matched} noun="drafts"
            idleCount={false} inline
          />
        }
      />

      {view === 'calendar' ? (
        <ContentCalendar rows={shown} onOpen={onOpen} refresh={refresh} />
      ) : (
        <>
          <StageTabs tabs={tabs} active={active} onSelect={setTab} />
          {shown.length === 0 && drafts.length > 0
            ? <FilteredEmpty noun="drafts" onClear={() => { setFilters({}); setQ('') }} />
            : (
              <StageTable
                s={activeStage} rows={byGroup[activeGroup][activeStage]}
                // 🔴 `lane`, not a hardcoded 'risedtc'. This component draws
                // every client lane (ARCH included), and the row uses it to
                // decide whether to print source_label and whether the review
                // controls are legal.
                lane={lane}
                refresh={refresh} onOpen={onOpen} openId={openId}
                empty={active === CLIENT_TAB_ALWAYS
                  ? 'Nothing is waiting on you.'
                  : `Nothing at ${clientStageLabel(activeStage, activeGroup).toLowerCase()}.`}
              />
            )}
        </>
      )}

      {/* The lead-magnet lane left this scroll for the Magnets job; Styles is
          its own job now (08-04). No pillar TARGET on this lane either: the
          target constant is Ivan's editorial strategy. */}
    </>
  )
}

// ---------------------------------------------------------------------------

export function ContentList({ lane, setLane, openId, onOpen }: {
  lane: ContentLane
  setLane: (l: ContentLane) => void
  openId: string | null
  onOpen: OpenDraft
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
  // `posts2`, not `posts`: the 08-04 default-open reversal has to reach a
  // browser whose stored `posts` entry carries the TOUCHED marker — the old
  // key's answer would silently override the new defaults forever.
  const [sect, setSect] = useSectionState(`content.posts2.${lane}`)
  // FLOW vs CALENDAR. Deliberately NOT in the per-lane section entry: the view
  // is a property of how Ivan is working right now, not of a lane's vocabulary,
  // and switching lane inside the calendar has to keep him in the calendar —
  // that is what makes the lane tabs the calendar's selector. Same one-key
  // localStorage shape the rail's collapse uses.
  const [view, setViewState] = useState<ContentView>(() => {
    try { return localStorage.getItem(VIEW_KEY) === 'calendar' ? 'calendar' : 'flow' } catch { return 'flow' }
  })
  const setView = (v: ContentView) => {
    setViewState(v)
    try { localStorage.setItem(VIEW_KEY, v) } catch { /* private mode */ }
  }
  const setFilters = (f: FilterState) => setSect(p => ({ ...p, filters: f }))
  const setQ = (q: string) => setSect(p => ({ ...p, q }))
  // `sect.open` is still WRITTEN by the ideas band through its own helpers; no
  // content section reads it any more (the tabs replaced the collapse store),
  // so nothing here projects it down a lane.
  const switchLane = (l: ContentLane) => setLane(l)

  // Ops' "Open them in Content" (OpsBoard, PipelineNotes). The errored rows are
  // a FLOW thing — the calendar draws dated posts, and an errored draft has no
  // date to draw — so the view flips before the section is jumped to.
  useEffect(() => {
    const on = () => setView('flow')
    window.addEventListener('wb-open-content-errors', on)
    return () => window.removeEventListener('wb-open-content-errors', on)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // A bulk action finished. The bar has no reference to this list and does not
  // need one: it says the rows changed, and whatever is mounted refetches.
  useEffect(() => {
    const on = () => refresh()
    window.addEventListener('wb-rows-changed', on)
    return () => window.removeEventListener('wb-rows-changed', on)
  }, [refresh])

  const err = error ?? (hasMock('fetch-error') ? 'PostgREST returned 500 for carousel_drafts' : null)
  const firstLoad = loading && drafts.length === 0
  const nothingMatched = !loading && (matched ?? 0) === 0
  const filteredAway = nothingMatched && (laneTotal ?? 0) > 0
  const onBoard = useMemo(() => countBoardVisible(drafts), [drafts])

  return (
    <>
      {/* THE DISPLAY HERO IS GONE (D3/D6). It cost 122px at 390 to print one
          word — a word the segmented bar 44px above it and the rail beside it
          were both already printing — plus the lane pills, which moved onto the
          command strip where they sit beside the numbers they switch. The three
          error/empty states below still render their own header through
          `Failed` / `CalmEmpty`, so a surface that cannot draw a strip is never
          a surface with no title. */}
      <div className="rows ct-rows" ref={rowsRef}>
        <PullIndicator pull={ptr.pull} refreshing={ptr.refreshing} trigger={ptr.trigger} />
        {/* 🔴 The lane switch is the ONE control that must survive every data
            state. The two lanes read different tables, so an empty or broken
            Mattan lane with no way back to Ivan is a dead surface — which is
            exactly what deleting the hero would have caused if the strip only
            rendered on the happy path. The strip drops its numbers here (there
            are none) and keeps its switch. */}
        {(err || firstLoad || nothingMatched) && (
          <CommandStrip lane={lane} setLane={switchLane} view={view} setView={setView} filter={null} />
        )}
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
              message={`Nothing matched, but ${laneTotal} draft${laneTotal === 1 ? '' : 's'} exist in this lane. The lane query ate them.`}
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
            lane={lane} setLane={switchLane}
            filters={sect.filters} setFilters={setFilters} q={sect.q} setQ={setQ}
            matched={matched} view={view} setView={setView}
          />
        ) : (
          <MattanLane
            drafts={drafts} openId={openId} onOpen={onOpen} refresh={refresh}
            lane={lane} setLane={switchLane} onBoard={onBoard}
            filters={sect.filters} setFilters={setFilters} q={sect.q} setQ={setQ}
            matched={matched} view={view} setView={setView}
          />
        )}
        <div style={{ height: 24 }} />
      </div>
    </>
  )
}
