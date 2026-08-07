import { useEffect, useMemo, useRef, useState } from 'react'
import { PullIndicator } from '../../components/PullIndicator'
import { usePullToRefresh } from '../../hooks/usePullToRefresh'
import {
  useAgentDigest, useContent, useIdeaCandidates, useScheduledQueue,
} from '../../hooks/useContent'
import {
  CONTENT_LANES, ERROR_ALARM_HOURS, LANE_LABEL, LANE_POSSESSIVE, PIPELINE_STAGES,
  STAGE_LABEL, STAGE_SHORT, STUCK_GENERATING_MINUTES, boardGroupOf, clientStageLabel,
  countBoardVisible, countUndated, deleteClientDraft, deleteDraft, draftExcerpt,
  elapsedMinutes, generatingSince, groupByStage, isRecentError, isStuckGenerating,
  isStuckScheduled, queueFailed, reviewActionable, stageOf, taxonomyValue,
  type BoardGroup, type ContentDraft, type ContentLane, type ContentStage, type ContentStages,
} from '../../lib/content'
import {
  applyFilters, applySearch, buildFacets, draftScore, draftSpecs, DRAFT_PROMINENT, splitFacets,
  type FilterState,
} from '../../lib/contentFilters'
import { useSectionState } from '../../hooks/useSectionState'
import {
  draftFacetsActive, ideasIsOpen, toggleIdeasOpen, stagesWriteBase, STAGES_TOUCHED,
} from './contentIdeas'
import { useConfirm } from '../../components/ConfirmSheet'
import { ReviewActions } from './ReviewActions'
import { FilteredEmpty } from './ContentBits'
import { FilterRow } from './FilterRow'
import { IdeasSection, PillarMix, QueueStrip } from './ContentSections'
import { relOrAhead, relTime, sourceLabel, tagLabel, typeLabel } from './fmt'
import { CalmEmpty, Failed, SectionHead, StatChip } from './Surface'
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
  if (lane === 'risedtc' && boardGroupOf(d) === 'board') return null
  const run = async (e: React.MouseEvent) => {
    // A tap on the card opens the window; the ✕ must not also fire that.
    e.stopPropagation()
    const ok = await confirm({
      title: 'Delete this draft?',
      message: lane === 'risedtc'
        ? 'Mattan has never seen it, and this removes it permanently.'
        : 'This removes it permanently.',
      confirmText: 'Delete',
      danger: true,
    })
    if (!ok) return
    setBusy(true); setErr('')
    try {
      await (lane === 'risedtc' ? deleteClientDraft(d.id, d.taxonomy) : deleteDraft(d.id, d.taxonomy))
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
  return (
    <div
      className={`ct-card ct-tap${active ? ' wb-card-on' : ''}${stalled ? ' ct-stalled' : ''}`}
      onClick={() => onOpen(d.id, title, queue)}
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
          {/* Slot #3, glance rows only, and only when the row HAS a date. A
              review-stage draft normally does not, so an always-rendered '—'
              here would spend a mark on the absence of a fact rather than on a
              fact — unlike the pillar/funnel/source columns, which are columns
              and have to hold their x. */}
          {glance && d.scheduled_at && (
            <span className="ct-chip ct-chip-when" title={`scheduled_at ${d.scheduled_at}`}>
              {relOrAhead(d.scheduled_at)}
            </span>
          )}
        </div>
        {/* The line the old board never made him open a row for
            (StudioListView.tsx:463-503). Absent — not blank — when the body has
            not been generated yet. */}
        {glance && excerpt && <div className="ct-ex">{excerpt}</div>}
      </div>
      {/* The three facts as COLUMNS, one fixed x each, '—' when absent so the
          column stays a column. Desktop only — below 1000px there is no width
          for a table and the row keeps its two-line phone shape. */}
      <span className="ct-colv" title={pillar ? `pillar ${pillar}` : undefined}>{pillar ? tagLabel(pillar) : '—'}</span>
      <span className="ct-colv" title={funnel ? `funnel_stage ${funnel}` : undefined}>{funnel ? tagLabel(funnel) : '—'}</span>
      <span className="ct-colv" title={src ? `taxonomy.source ${src}` : undefined}>{src ? sourceLabel(src) : '—'}</span>
      {/* trailing slot — the two review controls stay INSIDE the row's third
          column rather than growing a 44px button bar underneath it, which is
          what keeps a 285-row list inside the 40-60px density band. The value
          itself is last, right-aligned and tabular, so every row in the list
          shares one right edge. */}
      {reviewActionable(d.status, lane) && <ReviewActions id={d.id} onDone={refresh} compact />}
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
function CommandStrip({
  lane, setLane, laneNote, stats, alert, filter, tail,
}: {
  lane: ContentLane
  setLane: (l: ContentLane) => void
  laneNote?: React.ReactNode
  stats?: React.ReactNode
  alert?: React.ReactNode
  filter: React.ReactNode
  tail?: React.ReactNode
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
      {/* `display:contents` on the pointer canvas, so these four are direct
          members of the strip's one flex line; a real scrolling row on the
          phone, where four controls cannot share 358px and stacking them was
          three rows of chrome. One element, two behaviours, no second DOM. */}
      <div className="ct-cmd-top">
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
          {laneNote}
        </div>
        {stats}
        {alert}
        {tail}
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
function PipelineStats({ stages, matched, laneTotal, onJump }: {
  stages: ContentStages
  matched: number | null
  laneTotal: number | null
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
      <span
        className="ct-cmd-tot"
        title={`${matched ?? inPipeline} rows loaded${laneTotal !== null ? ` of ${laneTotal} in this lane` : ''}`}
      >
        <b>{matched ?? inPipeline}</b>
        {laneTotal !== null && laneTotal !== matched ? <i>/{laneTotal}</i> : null}
      </span>
    </div>
  )
}

// THE ALARM, and the one arithmetic fix it needed (D11).
//
// What was printed: `7 │ 5 errored · 2 elsewhere`, where 7 = draft ROWS plus
// pipeline NOTES and the breakdown was built from a different set — so a
// `stages.stuck` row that was neither errored nor past-due inflated the total
// without ever appearing in the words under it, and "elsewhere" was literally
// `extra.length`, a word for a number the reader had no way to resolve.
//
// The rule now: THE NUMBER COUNTS ROWS. Its breakdown is exhaustive by
// construction — errored, past due, and everything else in the same array named
// as such — so the parts always sum to the whole. The notes are not rows and
// are never added to it; they are a separate, named tail.
function alertParts(drafts: ContentDraft[]): { errored: number; stuck: number; other: number } {
  const errored = drafts.filter(d => d.status === 'error').length
  const stuck = drafts.filter(d => d.status !== 'error' && isStuckScheduled(d)).length
  return { errored, stuck, other: drafts.length - errored - stuck }
}

// The chip that rides in the command strip. It is the whole alarm at rest: the
// row count, the breakdown that sums to it, and the note tail.
function AlertChip({ drafts, extra, open, onToggle }: {
  drafts: ContentDraft[]
  extra: { key: string; line: string }[]
  open: boolean
  onToggle: () => void
}) {
  if (drafts.length === 0 && extra.length === 0) return null
  const { errored, stuck, other } = alertParts(drafts)
  const words = [
    errored > 0 && `${errored} errored`,
    stuck > 0 && `${stuck} past due`,
    other > 0 && `${other} other`,
  ].filter(Boolean).join(' · ')
  return (
    <>
      {/* The jump target lives on the CHIP, not inside the collapsible body:
          `jump()` scrolls to `wb-s-<stage>`, and an anchor that unmounts with
          the body would send the error jump nowhere whenever it is closed. */}
      <div id="wb-s-error" />
      <button
        type="button" className="ct-alert ct-alert-chip" onClick={onToggle}
        aria-expanded={open}
        title={drafts.length > 0
          ? `${drafts.length} draft rows need attention: ${words}${extra.length > 0 ? ` · plus ${extra.length} pipeline notes, which are not rows` : ''}`
          : `${extra.length} pipeline notes — no draft row is in trouble`}
      >
        {drafts.length > 0 && <span className="ct-alert-n">{drafts.length}</span>}
        <span className="ct-alert-t">
          {drafts.length > 0 ? words : `${extra.length} pipeline ${extra.length === 1 ? 'note' : 'notes'}`}
        </span>
        {drafts.length > 0 && extra.length > 0 && (
          // NOT added into the number above it. A note is a sentence about the
          // pipeline; a row is a draft you can open.
          <span className="ct-alert-x-n">+{extra.length} notes</span>
        )}
        <span className="chev">{open ? '⌄' : '›'}</span>
      </button>
    </>
  )
}

// The disclosure body, below the strip and above the flow.
function AlertBody({ drafts, lane, refresh, onOpen, openId, extra }: {
  drafts: ContentDraft[]
  lane: ContentLane
  refresh: () => void
  onOpen: OpenDraft
  openId: string | null
  extra: { key: string; line: string }[]
}) {
  return (
    <div className="ct-alert-body">
      {/* the line is wrapped so it can ellipsize: a list of what is wrong, not
          prose about it. The full sentence lives on the row it points at. */}
      {extra.map(e => <div className="ct-alert-x" key={e.key}><span>{e.line}</span></div>)}
      {drafts.map(d => (
        <Card key={d.id} d={d} lane={lane} refresh={refresh} onOpen={onOpen} active={openId === d.id} queue={drafts} />
      ))}
    </div>
  )
}

// A stage section with its rows. Shared by both lanes — the lanes differ in how
// they NEST these, not in how a stage renders.
function StageSection({ s, n, rows, lane, group, refresh, onOpen, openId, isOpen, toggle, sub }: {
  s: ContentStage
  n?: string
  rows: ContentDraft[]
  lane: ContentLane
  // Which of the client lane's two categories this section is nested in. Absent
  // on the Ivan lane, which has no such split. It changes the LABEL, because on
  // the client lane one status means two different things — see clientStageLabel.
  group?: BoardGroup
  refresh: () => void
  onOpen: OpenDraft
  openId: string | null
  isOpen: boolean
  toggle: () => void
  sub?: string | null
}) {
  if (rows.length === 0) return null
  return (
    <div id={group ? `wb-s-${group}-${s}` : `wb-s-${s}`}>
      <SectionHead
        n={n}
        title={group ? clientStageLabel(s, group) : STAGE_LABEL[s]}
        count={rows.length}
        // A backlog is not a warning. Only review carries a mark, and only the
        // neutral "pending" one — and on the client lane only in the category
        // that is actually waiting on Ivan. A mark on the rows Mattan is sitting
        // on would point at work that is not his to do or Ivan's to chase.
        sev={s === 'review' && (lane === 'ivan' || group === 'internal') ? 'attention' : null}
        open={isOpen}
        onToggle={toggle}
      />
      {isOpen && (
        <>
          {sub && <div className="ct-subline">{sub}</div>}
          {/* Column labels once per section, on the same grid as the rows, so
              the eye reads a TABLE (dashboard-v2's anatomy). Desktop only. */}
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

// 2026-08-04, Ivan, reversing 08-03's default-collapsed rule: "LOOK HOW
// ANNOYING IS NOW TO OPEN EVERYTHING COMPARED TO PREVIOUS DASHBOARD WHERE...
// THINGS ARE DIRECTLY OPEN". The working stages open themselves; only the two
// archives (published 109, archived 84) and the odd tails stay behind a click,
// because those are the sections whose row count buries the work.
const DEFAULT_OPEN: ContentStage[] = ['review', 'generating', 'approved', 'scheduled', 'error']

// TRIAGE ORDER, not lifecycle order. The stage that needs Ivan goes first; the
// rest keep the pipeline's own sequence behind it. Lifecycle order put Review
// third, under two collapsed-or-not sections and ~450px of chrome, which is the
// "i have to scroll super vertical and long" he reported. The numbering follows
// the render, so the section labelled 02 is always the top one.
const TRIAGE_ORDER: ContentStage[] = [
  'review', 'generating', 'approved', 'scheduled', 'published',
]

// A stage the operator has never touched follows the rule above. The moment he
// opens or closes ANY section his answer wins and survives the reload — which
// needs a way to tell "he closed everything" from "he has not decided yet",
// because both are an empty list. TOUCHED is that marker: it rides in the same
// array, takes the same identifier shape the store already validates, and
// cannot collide with a stage id (the stages are named in ContentStage).
//
// The sentinel and the rebuild it drives live in contentIdeas.ts, with the
// ideas band's two keys: the array has TWO writers and neither rebuild is
// correct read on its own (contentIdeas.ts, "ONE ARRAY, TWO WRITERS").
const TOUCHED = STAGES_TOUCHED

function useOpenStages(
  persisted: string[],
  setPersisted: (fn: (cur: string[]) => string[]) => void,
  initial: string[],
) {
  const decided = persisted.includes(TOUCHED)
  const open = decided ? persisted : initial
  const write = (next: (cur: string[]) => string[]) =>
    setPersisted(cur => [...next(stagesWriteBase(cur, initial)), TOUCHED])
  return {
    isOpen: (s: string) => open.includes(s),
    toggle: (s: string) =>
      write(cur => (cur.includes(s) ? cur.filter(x => x !== s) : [...cur, s])),
    ensure: (s: string) => write(cur => (cur.includes(s) ? cur : [...cur, s])),
  }
}

// ---------------------------------------------------------------------------
// LANE A — Ivan
// ---------------------------------------------------------------------------

function IvanLane({ drafts, stages, openId, onOpen, refresh, filters, setFilters, q, setQ, matched, laneTotal, open, setOpen, lane, setLane }: {
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
  laneTotal: number | null
  open: string[]
  setOpen: (fn: (cur: string[]) => string[]) => void
}) {
  const stageOpen = useOpenStages(open, setOpen, DEFAULT_OPEN)
  // The alarm is a CLOSED SUMMARY on every count, and the state lives out here
  // because the chip rides in the command strip while its rows render below it.
  // 2026-08-03 measured why it never auto-opens: on the live lane it resolved
  // open at 4 rows and cost ~420px directly above the queue — the alarm's own
  // rows pushing the work off screen, which is the failure it exists to prevent.
  const [alertOpen, setAlertOpen] = useState(false)
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
    // Density (2026-08-03): this used to be its own two-line paragraph directly
    // above the pipeline — ~36px of prose that names nothing actionable. It IS
    // a footnote about the alert count, so it belongs inside the alert
    // disclosure, where it costs nothing until the alerts are open. It keeps
    // its non-alarm wording; it is history, not a defect.
    ...(digest.olderUnsent > 0
      ? [{
        key: 'older-unsent',
        line: `${digest.olderUnsent} pipeline ${digest.olderUnsent === 1 ? 'alert predates' : 'alerts predate'} the 14-day window (ClickUp-era ids, no live draft behind them) — historical, not actionable here.`,
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
  const ideasHidden = draftFacetsActive(filters, q)
  const scheduledThisWeek = stages.scheduled.filter(d => {
    if (!d.scheduled_at) return false
    const t = Date.parse(d.scheduled_at)
    return Number.isFinite(t) && t >= Date.now() && t < Date.now() + 7 * 86400_000
  }).length

  return (
    <>
      <CommandStrip
        lane={lane} setLane={setLane}
        stats={
          <PipelineStats stages={stages} matched={matched} laneTotal={laneTotal} onJump={jump} />
        }
        alert={
          <AlertChip drafts={alerts} extra={extra} open={alertOpen} onToggle={() => setAlertOpen(o => !o)} />
        }
        filter={
          // idleCount={false}: the strip's own lane figure two slots left already
          // states this total, and the unfiltered note here would be that number a
          // second time on the same band. The FILTERED line is never suppressed —
          // `9 of 224 shown` is the number doing work.
          <FilterRow
            prominent={prominent} demoted={demoted}
            state={filters} setState={setFilters} q={q} setQ={setQ}
            shown={shown.length} loaded={drafts.length} total={matched} noun="drafts"
            idleCount={false} inline
          />
        }
        tail={
          // Advisory denominator, never a quota, never a gate, never red — and
          // now a mark rather than a line of prose. The word "cadence" is what
          // stops it reading as a target, which is why it is still printed.
          <span
            className="ct-cmd-cad"
            title={`${scheduledThisWeek} posts are scheduled in the next 7 days. The 4-a-week cadence is an editorial rhythm, not a quota and not a gate.`}
          >
            <b>{scheduledThisWeek}</b>↗7d
          </span>
        }
      />
      {alertOpen && (
        <AlertBody drafts={alerts} lane="ivan" refresh={refresh} onOpen={onOpen} openId={openId} extra={extra} />
      )}

      {/* ask 3 — the POST side of the content_type partition only. Rows with no
          content_type ride here too, labelled, rather than vanishing from both
          lanes. ask 4 — open by default, sticky header, and the open flag is
          persisted alongside the stage sections' (contentIdeas.ts). While a draft
          facet is on the band keeps its header and its count and drops its
          rows, so the drafts the filter DID find are the next thing on screen. */}
      <IdeasSection
        ideas={ideas.split.post} kind="post" n="01" count={ideas.counts.post}
        unclassified={ideas.split.other}
        loading={ideas.loading}
        error={ideas.error} loadedAt={ideas.loadedAt} refresh={ideas.refresh}
        hiddenByFilter={ideasHidden}
        isOpen={ideasIsOpen(open)} onToggle={() => setOpen(toggleIdeasOpen)}
      />

      {/* The escape and the band above it are driven by the SAME predicate: when
          nothing matched, the ideas band is already down to its header, so "No
          drafts match this filter" is the first thing under the filter row
          instead of the 75th. Clearing here restores both — one control, both
          row sets. */}
      {shown.length === 0 && drafts.length > 0
        ? <FilteredEmpty noun="drafts" onClear={() => { setFilters({}); setQ('') }} />
        : TRIAGE_ORDER.map((s, i) => (
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

      {/* Magnets left this scroll on 08-03; Styles followed on 08-04 (its own
          job now) and the daily summaries moved to Ops. The Content scroll
          ends at the pillar mix. */}
      <PillarMix rows={drafts} />
    </>
  )
}

// ---------------------------------------------------------------------------
// LANE B — Mattan Danino
// ---------------------------------------------------------------------------

// ONE LEVEL of sections, not two.
//
// Ivan, 2026-08-04: "for mattan idk why there are 2 categories, not on his
// board and waiting on u... bc those are the same". The old render nested a
// "Waiting on you" stage section inside a "Not on his board" group header —
// two headers stacked over the same rows. The group level is gone: the lane
// renders flat stage sections, ours first (the work), then his board's, and
// clientStageLabel already carries the where ("On buffer · RISE DTC board", "Mattan
// approved") so nothing is lost with the header.
const BOARD_ORDER: BoardGroup[] = ['internal', 'board']

function MattanLane({ drafts, openId, onOpen, refresh, filters, setFilters, q, setQ, matched, open, setOpen, lane, setLane, onBoard }: {
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
  open: string[]
  setOpen: (fn: (cur: string[]) => string[]) => void
}) {
  // Same density rule as the Ivan lane, and the same persistence: only the stage
  // that needs a decision opens itself. On this lane `review` means "available
  // to be promoted to the board", which is still the one Ivan acts on.
  // 🔴 The composite key, and it MUST match projectOpen's KEY_RE
  // (/^[a-z][a-z0-9_]*$/ — sectionState.ts:65): a `group:stage` key would be
  // silently dropped on write and every section would reopen on reload.
  const stageOpen = useOpenStages(open, setOpen, [
    'internal_review', 'internal_generating', 'internal_approved', 'internal_scheduled',
    'board_review', 'board_approved', 'board_scheduled',
  ])
  const [alertOpen, setAlertOpen] = useState(false)
  // Same determinism rule as the Ivan lane: an active stage filter opens its section.
  // Same determinism rule as the Ivan lane, applied to BOTH categories: a
  // stage filter that opened only one of them would render a different row
  // count before and after a reload, which is the bug this rule exists for.
  const filterStage = filters.stage as ContentStage | undefined
  useEffect(() => {
    if (!filterStage) return
    stageOpen.ensure(`internal_${filterStage}`)
    stageOpen.ensure(`board_${filterStage}`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterStage])
  const specs = draftSpecs('risedtc')
  const facets = buildFacets(drafts, specs)
  // The same five prominent axes as Ivan's lane, deliberately WITHOUT `board`:
  // this lane is already GROUPED by board visibility (BOARD_ORDER below), so a
  // board pill would be a second control for a distinction the page structure
  // already draws — it stays available in the disclosure.
  const { prominent, demoted } = splitFacets(facets, DRAFT_PROMINENT)
  const shown = applySearch(applyFilters(drafts, specs, filters), q, d => [d.title, d.topic])

  // Stuck-resource lines moved to the Magnets job with the lane that renders
  // them; this strip is posts-only now. Ask 13: same 48h alarm window as the
  // Ivan lane — older errors keep their rows in the Errors section this lane
  // already renders below.
  const alerts = shown.filter(d => isRecentError(d) || isStuckScheduled(d))

  return (
    <>
      <CommandStrip
        lane={lane} setLane={setLane}
        laneNote={drafts.length > 0
          ? (
            <span className="ct-cmd-note" title={`${onBoard} of the ${drafts.length} loaded drafts are visible on ${LANE_POSSESSIVE.risedtc} board`}>
              <b>{onBoard}</b>/{drafts.length} on his board
            </span>
          )
          : undefined}
        alert={
          <AlertChip drafts={alerts} extra={[]} open={alertOpen} onToggle={() => setAlertOpen(o => !o)} />
        }
        filter={
          <FilterRow
            prominent={prominent} demoted={demoted}
            state={filters} setState={setFilters} q={q} setQ={setQ}
            shown={shown.length} loaded={drafts.length} total={matched} noun="drafts"
            inline
          />
        }
      />
      {alertOpen && (
        <AlertBody drafts={alerts} lane="risedtc" refresh={refresh} onOpen={onOpen} openId={openId} extra={[]} />
      )}

      {shown.length === 0 && drafts.length > 0
        ? <FilteredEmpty noun="drafts" onClear={() => { setFilters({}); setQ('') }} />
        : BOARD_ORDER.map(g => {
          // boardGroupOf, never an inline `board_visible === true`: the grouping
          // and the count that heads the lane have to agree about NULL, and they
          // only can if they ask the same function.
          const rows = shown.filter(d => boardGroupOf(d) === g)
          if (rows.length === 0) return null
          const stages = groupByStage(rows)
          return ([...PIPELINE_STAGES, 'error', 'stuck', 'archived', 'other'] as ContentStage[])
            .filter(s => s !== 'ideas')
            .map(s => (
              <StageSection
                key={`${g}_${s}`} s={s} rows={stages[s]} lane="risedtc" group={g}
                refresh={refresh}
                onOpen={onOpen} openId={openId}
                // 🔴 Keyed by GROUP as well as stage. Both halves of the lane
                // hold a `review` section and they are different questions, so
                // collapsing one must not collapse the other — which a
                // stage-only key did.
                isOpen={stageOpen.isOpen(`${g}_${s}`)}
                toggle={() => stageOpen.toggle(`${g}_${s}`)}
              />
            ))
        })}

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
  const setFilters = (f: FilterState) => setSect(p => ({ ...p, filters: f }))
  const setQ = (q: string) => setSect(p => ({ ...p, q }))
  // Collapse state rides in the SAME per-lane section entry as the filters, so
  // "what I had open on Ivan's lane" cannot leak onto Mattan's — the same
  // keying argument the filters were given.
  const setOpenSections = (fn: (cur: string[]) => string[]) =>
    setSect(p => ({ ...p, open: fn(p.open) }))
  const switchLane = (l: ContentLane) => setLane(l)

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
          <CommandStrip lane={lane} setLane={switchLane} filter={null} />
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
            matched={matched} laneTotal={laneTotal}
            open={sect.open} setOpen={setOpenSections}
          />
        ) : (
          <MattanLane
            drafts={drafts} openId={openId} onOpen={onOpen} refresh={refresh}
            lane={lane} setLane={switchLane} onBoard={onBoard}
            filters={sect.filters} setFilters={setFilters} q={sect.q} setQ={setQ}
            matched={matched}
            open={sect.open} setOpen={setOpenSections}
          />
        )}
        <div style={{ height: 24 }} />
      </div>
    </>
  )
}
