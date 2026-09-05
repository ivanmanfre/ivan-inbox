import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { PullIndicator } from '../../../components/PullIndicator'
import { usePullToRefresh } from '../../../hooks/usePullToRefresh'
import {
  useClientIdeas, useContent, useIdeaCandidates, useScheduledQueue,
} from '../../../hooks/useContent'
import {
  CONTENT_LANES, ERROR_ALARM_HOURS, LANE_LABEL, LANE_POSSESSIVE, PIPELINE_STAGES,
  STAGE_LABEL, STAGE_SHORT, boardGroupOf, clientStageLabel,
  countBoardVisible, countUndated, draftExcerpt,
  canPromote, draftFailure, elapsedMinutes, generatingSince, groupByLaneStage, groupByStage,
  isRecentError, stageOfLane,
  isStuckGenerating,
  reviewActionable, stageOf, taxonomyValue,
  type BoardGroup, type ContentDraft, type ContentLane, type ContentStage, type ContentStages,
} from '../../../lib/content'
import { label } from '../../../lib/labels'
import {
  applyFilters, applySearch, buildFacets, draftProminent, draftScore, draftSpecs,
  DRAFT_PROMINENT, splitFacets,
  type FilterState,
} from '../../../lib/contentFilters'
import { useSectionState } from '../../../hooks/useSectionState'
import { draftFacetsActive } from '../../../exp/v2c/contentIdeas'
import { FilterRow } from '../../../exp/v2c/FilterRow'
import type { RowCap } from '../../../exp/v2c/commandStore'
import { sourceHues } from '../../../lib/clientIdeas'
import { postTime, relTime, sourceLabel, tagLabel, typeLabel } from '../../../exp/v2c/fmt'
import { hasMock } from '../../../exp/v2c/mock'
import type { OpenDraft } from '../../../exp/v2c/ContentList'
import {
  Avatar, Badge, Card, Chip, SkeletonRows, Tabs, cx, list, rise, spring,
} from '../../../ds'
import { DirB, Block } from '../shell'
import { CalmEmpty, Failed, FilteredEmpty } from './bits'
import { PromoteRow, RetryDraft, ReviewActions, RowDelete } from './actions'
import { RowSelect } from './rowSelect'
import { ClientIdeasSection, IdeasSection, InFlight, PillarMix, QueueStrip } from './sections'
import { ContentCalendar } from './calendar'
import './content.css'

// ===========================================================================
// S03 CONTENT FLOW + S04 CONTENT CALENDAR — Direction B ("surface").
//
// A port of `src/exp/v2c/ContentList.tsx`, `ContentSections.tsx`,
// `ContentBits.tsx`, `ContentCalendar.tsx` and `CalPopover.tsx`. The data layer
// is untouched: same hooks in the same order, same writes, same guards, same
// strings, same keyboard bindings. Only the view is rebuilt.
//
// Content holds TWO KINDS OF LANE, and nothing else.
//
//   Ivan            client_id IS NULL, plus three row sets that carry no
//                   tenancy column at all and are therefore Ivan's
//   Mattan Danino   client_id = 'risedtc'   (and every other client lane)
//
// They are two VIEWS and not one filtered list because they obey different
// rules. The terminal fact of an Ivan row is whether it published; the terminal
// fact of a client row is whether it is on the client's board. On Ivan's lane
// `review` means "waiting on Ivan"; on a client's it means "available to be
// promoted", and reading that lane through the pipeline's eyes produces
// "70 things waiting on you", which is false.
//
// So: Ivan groups by pipeline stage. A client lane groups by promotion state,
// with stage as the secondary key inside each group.
//
// 'risedtc' is a database value and never reaches a label (LANE_LABEL).
//
// THE DIRECTION B MOVES, and where each came from:
//   · the board is a DECK — one stage on screen, drawn as a Block with a
//     dot-coded header and a round count badge, with the deck's peeked edges
//     behind the column (ref: Kanban, haydenbleasel; Kanban Board, arihantcodes
//     — the count-badge-next-to-title convention appeared independently in 3 of
//     4 kanban candidates);
//   · a row is a Card with `.dirb-lift` and a `layoutId`, so opening the draft
//     window grows out of the card that was tapped (ref: Morphing Dialog,
//     ibelick);
//   · the calendar is a STACK of day cards on the phone and the SAME cards as a
//     7-across grid on the desktop, with the "+N more" affordance opening the
//     existing day dialog (ref: fullscreen-calendar).
//
// 🔴 THE STAGE COLOURS ARE TOKENS NOW. The shipped file carried a hex map
// (`STAGE_COLOR`); the census forbids a colour literal, so the stage's identity
// moved to `data-st` and the six colours are severity/text tokens in
// content.css. Nothing else about what a colour MEANS changed.
// ===========================================================================

export type ContentView = 'flow' | 'calendar'
const VIEW_KEY = 'wb-content-view'

// ---------------------------------------------------------------------------
// The row
// ---------------------------------------------------------------------------

// Opening a draft hands the window the QUEUE it was opened from, so j/k and the
// window's rail walk exactly the rows Ivan is looking at.
function DraftCard({ d, lane, refresh, onOpen, active, queue, glance, srcHue, index }: {
  d: ContentDraft; lane: ContentLane; refresh: () => void
  onOpen: OpenDraft; active: boolean
  // The source's colour, dealt across the whole lane by the caller so the same
  // source is the same colour on every row (sourceHues). Client lanes only.
  srcHue?: number | null
  // The rows of the SECTION this card sits in, in render order. That order is
  // what j/k walks and what the window's rail draws, so the queue is the list
  // Ivan can actually see — filters, search and collapse state included.
  queue: ContentDraft[]
  // AT-A-GLANCE. The body excerpt and the armed date, on the row, so a decision
  // can be made without opening it.
  //
  // 🔴 NEEDS-REVIEW ONLY, and the scope is the point. This is the section where
  // Ivan is deciding, so it is the one section worth spending a third line on.
  glance?: boolean
  index: number
}) {
  const thumb = d.image_urls?.[0]
  const title = d.title || d.topic || 'Untitled'
  const score = draftScore(d)
  const stage = stageOf(d)
  const qa = d.qa_verdict?.trim().toUpperCase()
  // The corner dot carries the QA verdict in three states — green a literal
  // PASS, amber anything that is not (FAIL / NEEDS_REGENERATE / REWRITE_OK),
  // grey no verdict at all. Grey is the honest third state: "not judged" is not
  // "judged fine".
  const qaState = qa ? (qa === 'PASS' ? 'pass' : 'fail') : 'none'
  // A generation that died mid-run. Amber, and its count joins the in-flight
  // mark.
  const stalled = isStuckGenerating(d)
  const genMins = stalled ? elapsedMinutes(generatingSince(d)) : null
  const src = taxonomyValue(d.taxonomy, 'source')
  const pillar = taxonomyValue(d.taxonomy, 'pillar')
  const funnel = d.funnel_stage?.trim() || null
  const excerpt = glance ? draftExcerpt(d.post_body) : null
  // THE REASON, ON EVERY ERRORED ROW. It reads the TERMINAL agent_log entry
  // rather than the stamp: the old order printed a watchdog stall the log denies
  // on 28 of 55 live error rows and echoed the QA chip's own verdict back at the
  // reader on 21 more.
  const failure = stage === 'error' ? draftFailure(d) : null
  // WHAT A BULK ACTION MAY DO TO THIS ROW. Declared here because this is the
  // only place that knows the row's status, its lane and whether it sits on a
  // client board; the bulk bar never infers a capability. Both rules are the
  // ones the single-row controls already obey, read from the same functions.
  const caps: RowCap[] = [
    ...(reviewActionable(d.status, lane) ? (['approve', 'skip'] as RowCap[]) : []),
    // `canPromote` is the RPC's OWN predicate, read from the same function the
    // takeover's button reads, so the row and the bar and the database cannot
    // disagree about who may be promoted.
    ...(canPromote(d.status, lane) && boardGroupOf(d) !== 'board' ? (['promote'] as RowCap[]) : []),
    ...(lane === 'ivan' || boardGroupOf(d) !== 'board' ? (['delete'] as RowCap[]) : []),
  ]
  return (
    <motion.div
      // THE LIFT. `layoutId` is the shared-layout handle the draft window grows
      // out of; `.dirb-lift` is the hover, CSS only, 120ms.
      layoutId={`dirb-draft-${d.id}`}
      className={cx('dirb-card dirb-lift', stalled && 'dirb-stalled')}
      variants={rise}
      custom={index}
      layout
      transition={spring}
    >
      <Card
        selected={active}
        onClick={() => onOpen(d.id, title, queue)}
        className="dirb-tap"
        lead={
          <span className="dirb-lead">
            {/* The row's registration with the command layer: it writes
                data-wbrow on the card, which is what j/k walks and what x
                selects. */}
            <RowSelect
              id={d.id} kind="draft" label={title} caps={caps}
              taxonomy={d.taxonomy} lane={lane}
            />
            {thumb
              ? <Avatar src={thumb} name={title} size="md" />
              : <span className="dirb-lead-blank" aria-hidden />}
            <span
              className="dirb-qadot" data-st={stage} data-qa={qaState}
              title={qa ? `QA ${label(d.qa_verdict)}` : 'no QA verdict on this row'}
            />
          </span>
        }
        title={title}
        sub={
          <span className="dirb-row-wrap">
            {/* SLOT #1 — the fact you scan a 70-row review list for. Rows with no
                verdict still spend the slot, so the column stays a column. On a
                stalled generation the slot carries the age instead: for that
                row, that IS the verdict. */}
            {stalled
              ? <Chip tone="attention" icon="timer">{genMins}m</Chip>
              : (
                <Chip tone={qa ? (qa === 'PASS' ? 'clear' : 'attention') : 'quiet'}>
                  {d.qa_verdict ? `${label(d.qa_verdict)}${score !== null ? ` ${score}` : ''}` : '—'}
                </Chip>
              )}
            <Chip tone="quiet">{typeLabel(d.type)}</Chip>
            {/* Only when the row HAS a date, and it shows the CLOCK, not
                "in 2d": the question asked of an armed row is which day and what
                time. */}
            {d.scheduled_at && (
              <span title={`Scheduled for ${d.scheduled_at}`}>
                <Chip icon="scheduled">{postTime(d.scheduled_at)}</Chip>
              </span>
            )}
          </span>
        }
        tail={<span className="ds-t-meta dirb-dim">{relTime(d.updated_at)}</span>}
        foot={
          <span className="dirb-row-wrap dirb-grow" onClick={e => e.stopPropagation()}>
            {/* The two review controls, the client lane's promote, and the
                delete. They are mutually exclusive by lane. */}
            {reviewActionable(d.status, lane) && (
              <ReviewActions id={d.id} onDone={refresh} compact demoteApprove={stage === 'error'} />
            )}
            {boardGroupOf(d) !== 'board' && <PromoteRow d={d} lane={lane} onDone={refresh} />}
            <span className="dirb-grow" />
            <RowDelete d={d} lane={lane} onDone={refresh} />
          </span>
        }
      >
        {/* The line the old board never made him open a row for. Absent — not
            blank — when the body has not been generated yet. */}
        {glance && excerpt && <div className="ds-t-body dirb-quiet dirb-clamp2">{excerpt}</div>}
        {/* SOURCE LEGIBILITY, client lanes only. `source_label` is the richer
            source (a whole sentence, on 91% of his drafts). It carries the
            source's own colour, the same hue the Ideas tab deals it, so a 29-row
            list clusters by eye before any filter is touched. */}
        {lane !== 'ivan' && d.source_label && (
          <div
            className="dirb-src dirb-truncate" title={d.source_label}
            style={typeof srcHue === 'number'
              ? ({ '--src-h': srcHue } as React.CSSProperties)
              : undefined}
          >{d.source_label}</div>
        )}
        {/* THE THREE FACTS. They were fixed desktop-only columns; on a card they
            are chips that keep their tooltips and their em-dash-free absence
            marker, so the fact survives at every width instead of folding away
            below 1300px. */}
        <div className="dirb-row-wrap dirb-facts">
          <span title={pillar ? `Pillar: ${tagLabel(pillar)}` : undefined}>
            <Chip tone="quiet">{pillar ? tagLabel(pillar) : '—'}</Chip>
          </span>
          <span title={funnel ? `Funnel stage: ${tagLabel(funnel)}` : undefined}>
            <Chip tone="quiet">{funnel ? tagLabel(funnel) : '—'}</Chip>
          </span>
          <span title={src ? `Source: ${sourceLabel(src)}` : undefined}>
            <Chip tone="quiet">{src ? sourceLabel(src) : '—'}</Chip>
          </span>
        </div>
        {/* The sentence and the one thing to do about it are the same thought,
            so they share a line. `data-kind` is the machine reading of the same
            fact the sentence carries in words. */}
        {failure && (
          <div className="dirb-row-wrap" onClick={e => e.stopPropagation()}>
            <div className="ds-t-meta dirb-reason dirb-grow dirb-truncate" data-kind={failure.kind} title={failure.reason}>
              {failure.reason}
            </div>
            <RetryDraft d={d} lane={lane} onDone={refresh} />
          </div>
        )}
      </Card>
    </motion.div>
  )
}

// ---------------------------------------------------------------------------
// The command strip
// ---------------------------------------------------------------------------

// It replaces, on one band, five stacked ones: the display hero, the alert
// strip, the pipeline chart card, the cadence line and the filter block. The
// numbers did not go away — every one of them is still on this strip, drawn as a
// mark small enough to sit beside the work instead of above it.
//
// The rules it keeps:
//   · ONE WORD PER NUMBER — `in pipeline`, `in the lane` and `loaded` are three
//     different denominators and each is stated where it is used;
//   · the ideas bank is NOT folded into the pipeline marks — the lane renders a
//     truncated slice of lm_idea_candidates and a truncated series beside a
//     complete one draws a proportion that does not exist;
//   · published keeps its slot as a lane fact, never as a pipeline mark.
//
// 🔴 THE COUNT THAT BELONGS ABOVE THE TABS IS THE LANE'S, NOT THE STAGE'S. The
// tab bar already prints every stage and its numeral. What is hidden above the
// tabs is the LANE: `carousel_drafts` at review splits Ivan / Mattan / Davorin,
// and the lane pills printed none of it. The pills report; they were already the
// control, so this adds no second control and no second row.
//
// 🔴 THE PILLS KEEP THE CLASSES `ct-cmd-lanes` / `ct-cmd-lane`. They are the
// lane switch and the view switch, they carry `aria-current` rather than a tab
// role, and the screenshot recipe reaches the calendar through
// `.ct-cmd-lane:has-text("Calendar")`. Direction B restyles them from its own
// sheet at a higher specificity; it does not rename them.
function CommandStrip({
  lane, setLane, view, setView, laneNote, laneCounts, stats, filter,
}: {
  lane: ContentLane
  setLane: (l: ContentLane) => void
  view?: ContentView
  setView?: (v: ContentView) => void
  laneNote?: React.ReactNode
  // What each lane holds at REVIEW, from the shell's cross-lane read. Never from
  // this surface's own rows, which only ever hold the selected lane.
  laneCounts?: Partial<Record<ContentLane, number>>
  stats?: React.ReactNode
  filter: React.ReactNode
}) {
  return (
    <div className="dirb-sticky dirb-cmd">
      <div className="dirb-spread dirb-row-wrap">
        <div className="dirb-row-wrap">
          {/* The lane switch is a VIEW switcher, so it keeps the pill grammar it
              has always had; it is not a filter. */}
          <div className="ct-cmd-lanes dirb-pills">
            {CONTENT_LANES.map(k => {
              const n = laneCounts?.[k] ?? 0
              return (
                <button
                  type="button" key={k}
                  className={cx('ct-cmd-lane', 'dirb-pill', lane === k && 'on')}
                  aria-current={lane === k ? 'true' : undefined}
                  onClick={() => setLane(k)}
                  title={n > 0 ? `${LANE_LABEL[k]}: ${n} at review` : undefined}
                >
                  {LANE_LABEL[k]}
                  {/* A zero is not printed. An empty lane says so by staying
                      quiet, which is what lets a number mean something. */}
                  {n > 0 && <Badge variant="ring">{n}</Badge>}
                </button>
              )
            })}
          </div>
          {/* The Flow/Calendar switch sits INSIDE the id cluster, beside the lane
              pills, because it answers the same kind of question: which view of
              this lane am I looking at. The lane it switches inside is the
              calendar's only selector. */}
          {view && setView && (
            <div className="ct-cmd-lanes dirb-pills">
              {(['flow', 'calendar'] as const).map(v => (
                <button
                  type="button" key={v}
                  className={cx('ct-cmd-lane', 'dirb-pill', view === v && 'on')}
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
      {filter}
    </div>
  )
}

// The pipeline, as marks that fit on the strip.
//
// PUBLISHED IS NOT A MARK — it is an archive count he never acts on and the only
// stage that accumulates forever, so it would set the scale by itself.
function PipelineStats({ stages, onJump }: {
  stages: ContentStages
  onJump: (s: ContentStage) => void
}) {
  const parts = PIPELINE_STAGES
    .filter(s => s !== 'ideas' && s !== 'published')
    .map(s => ({ stage: s, n: stages[s].length }))
  // 🔴 ONE WORD PER NUMBER. This sum is every PIPELINE stage, published
  // included — deliberately wider than the marks, so narrowing the drawing does
  // not silently restate the denominator.
  const inPipeline = PIPELINE_STAGES
    .filter(s => s !== 'ideas')
    .reduce((a, s) => a + stages[s].length, 0)
  const undated = countUndated(stages.approved)
  return (
    <div className="dirb-row-wrap">
      {parts.map(p => (
        <span
          key={p.stage}
          title={p.stage === 'review'
            ? `waiting on you · ${inPipeline} in pipeline`
            : p.stage === 'approved' && undated > 0
              ? `${undated} of them approved with no date — on no other surface`
              : `${inPipeline} in pipeline`}
        >
          <Chip
            className="dirb-stat" tone={
              p.stage === 'review' && p.n > 0
                ? 'attention'
                : p.stage === 'approved' && undated > 0 ? 'attention' : 'quiet'
            }
            count={p.n}
            onClick={() => onJump(p.stage)}
          >
            <span className="dirb-stagedot" data-st={p.stage} aria-hidden />
            <span title={STAGE_LABEL[p.stage]}>{STAGE_SHORT[p.stage]}</span>
          </Chip>
        </span>
      ))}
    </div>
  )
}

function LoadingRows() {
  return (
    <div aria-hidden>
      <SkeletonRows rows={8} label="Reading the content pipeline" />
    </div>
  )
}

// ---------------------------------------------------------------------------
// THE TABS — one stage on screen at a time
// ---------------------------------------------------------------------------
//
// The pile was nine collapsible headers down one scroller, so reaching Errors or
// Published meant scrolling past every stage above it and the answer to "how
// much is at this stage" was a number you had to scroll to find. The tab bar
// states all of them at once — the counts are the bar — and the deck below it is
// ONE stage, full height, starting at the top of the screen.
//
// What it keeps from the piles: the row anatomy, and the SUB-LINES per tab (the
// 48h error scope, the approved-with-no-date count, the past-due explanation).
// Those are the sentences that make a count mean something. What it drops: the
// per-section collapse state. A tab IS the open/closed answer.
type ContentTab = ContentStage | 'ideas'

// Render order of the bar. `stuck`/`other` only appear when they have rows.
// 🔴 `archived` came OFF this bar on 2026-08-23 — the rows still exist and
// `stageOf` still files them; Content simply has no archived category any more.
const TAB_ORDER: ContentTab[] = [
  'ideas', 'review', 'generating', 'approved', 'scheduled', 'published',
  'error', 'stuck', 'other',
]
const TAB_ALWAYS: ContentTab[] = ['ideas', 'review', 'generating', 'approved', 'scheduled', 'published', 'error']

// ONE KEY PER LANE. Ivan's lane and the client lanes do not even share a tab
// VOCABULARY — his are stages, theirs are group-plus-stage — so a single key
// would restore a tab that does not exist on the lane being opened.
function tabStoreKey(lane: ContentLane): string { return `wb-content-tab-${lane}` }

function readTab(lane: ContentLane, valid: readonly string[], fallback: string): string {
  try {
    const v = localStorage.getItem(tabStoreKey(lane))
    return v && valid.includes(v) ? v : fallback
  } catch { return fallback }
}

// The tab, persisted. Returned as [value, set] so both lanes state the rule
// once: writing the answer to storage is part of selecting a tab.
function useStageTab(lane: ContentLane, valid: readonly string[], fallback: string) {
  const [tab, setTabState] = useState<string>(() => readTab(lane, valid, fallback))
  const setTab = (t: string) => {
    setTabState(t)
    try { localStorage.setItem(tabStoreKey(lane), t) } catch { /* private mode */ }
  }
  // The lane switch changes the vocabulary underfoot. Re-read for the new lane
  // rather than carrying the old lane's answer into a bar that has no such tab.
  const laneRef = useRef(lane)
  useEffect(() => {
    if (laneRef.current === lane) return
    laneRef.current = lane
    setTabState(readTab(lane, valid, fallback))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lane])
  return [laneRef.current === lane ? tab : readTab(lane, valid, fallback), setTab] as const
}

// ONE STAGE'S ROWS AS A DECK. No chevron: the tab above it is the open/closed
// answer, and the Block's dot-coded head plus its round count badge is what the
// section header used to say. An empty stage says so in a sentence rather than
// rendering nothing, because in tab mode "nothing there" and "I clicked the
// wrong thing" look identical on a blank screen.
function StageDeck({ s, rows, lane, refresh, onOpen, openId, sub, empty, hues, heading }: {
  s: ContentStage
  rows: ContentDraft[]
  lane: ContentLane
  refresh: () => void
  onOpen: OpenDraft
  openId: string | null
  sub?: string | null
  empty?: string
  // Dealt once per LANE, never per stage: the same source has to be the same
  // colour on the Waiting-on-you tab and on the Scheduled tab.
  hues?: Map<string, number>
  heading: string
}) {
  return (
    <div id={`wb-s-${s}`}>
      <Block
        label={
          <span className="dirb-row">
            <span className="dirb-stagedot" data-st={s} aria-hidden />
            {heading}
          </span>
        }
        tail={<Badge variant="ring">{rows.length}</Badge>}
      >
        {sub && <div className="ds-t-meta dirb-dim">{sub}</div>}
        {rows.length === 0
          ? <CalmEmpty line={empty ?? `Nothing at ${STAGE_LABEL[s].toLowerCase()}.`} loadedAt={null} />
          : (
            <div className={cx('dirb-deck', rows.length > 2 && 'dirb-deck-on')}>
              <motion.div className="dirb-cards" variants={list} initial="hidden" animate="show">
                <AnimatePresence initial={false}>
                  {rows.map((d, i) => (
                    <DraftCard
                      key={d.id} d={d} lane={lane} refresh={refresh} onOpen={onOpen}
                      active={openId === d.id} queue={rows} index={i}
                      srcHue={d.source_label ? hues?.get(d.source_label) ?? null : null}
                      // The decision surface, and only it.
                      glance={s === 'review'}
                    />
                  ))}
                </AnimatePresence>
              </motion.div>
              {/* The deck's peeked edges: the count is visible as a physical
                  stack before a single card is read. Inert. */}
              {rows.length > 2 && (
                <>
                  <span className="dirb-deck-peek" data-i="1" aria-hidden />
                  <span className="dirb-deck-peek" data-i="2" aria-hidden />
                </>
              )}
            </div>
          )}
      </Block>
    </div>
  )
}

// ---------------------------------------------------------------------------
// LANE A — Ivan
// ---------------------------------------------------------------------------

function IvanLane({ drafts, stages, openId, onOpen, refresh, filters, setFilters, q, setQ, matched, view, setView, lane, setLane, laneCounts }: {
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
  laneCounts?: Partial<Record<ContentLane, number>>
}) {
  // ONE TAB, persisted per lane. A view preference, so it keeps its own
  // localStorage key rather than riding in the section entry the filters use.
  const [tabRaw, setTab] = useStageTab('ivan', TAB_ORDER, 'review')
  const tab = tabRaw as ContentTab
  // Determinism under a filter: an ACTIVE stage filter selects its tab, so the
  // filter and the deck can never be describing two stages.
  const filterStage = filters.stage as ContentStage | undefined
  useEffect(() => {
    if (filterStage) setTab(filterStage)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterStage])
  const ideas = useIdeaCandidates(true)
  const queue = useScheduledQueue(true)

  // A stage mark on the strip SELECTS its tab. It used to open a section and
  // scroll to it; with one stage on screen the scroll has nothing left to do.
  const jump = (s: ContentStage) => setTab(s)

  // The other end of Ops' jump ("Open them in Content").
  useEffect(() => {
    const on = () => setTab('error')
    window.addEventListener('wb-open-content-errors', on)
    return () => window.removeEventListener('wb-open-content-errors', on)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const specs = draftSpecs('ivan')
  // Counts are derived over EVERY loaded row, not over the current result: a
  // count that already reflects the choice you have not made yet is a moving
  // target.
  const facets = buildFacets(drafts, specs)
  const { prominent, demoted } = splitFacets(facets, DRAFT_PROMINENT)
  // post_body is ALREADY selected and was already in memory; leaving it out of
  // the search found 1 of the 5 drafts that say margin on Ivan's lane. It is a
  // substring scan over rows that are already here, so it costs no fetch.
  const shown = applySearch(applyFilters(drafts, specs, filters), q, d => [d.title, d.topic, d.post_body])
  const shownStages = groupByStage(shown)
  const ideasHidden = draftFacetsActive(filters, q)

  return (
    <>
      <CommandStrip
        lane={lane} setLane={setLane} view={view} setView={setView}
        laneCounts={laneCounts}
        stats={
          // CALENDAR ONLY. On the flow view the marks and the tab bar print the
          // same four numbers one row apart, and the tabs win it: they carry
          // every stage rather than four, and the click SELECTS rather than
          // scrolls. The calendar has no tab bar, so there the marks keep their
          // job — count the lane, and take you back to the rows.
          view === 'calendar'
            ? <PipelineStats stages={stages} onJump={s => { setView('flow'); jump(s) }} />
            : undefined
        }
        filter={
          // idleCount={false}: the FILTERED line (`9 of 224 shown`) is the
          // number doing work, and it is never suppressed.
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
        // the grid on the copy it was mounted with.
        <ContentCalendar
          rows={shown} queue={queue.rows} onOpen={onOpen}
          refresh={() => { refresh(); queue.refresh() }}
        />
      ) : (
        <>
          <Tabs
            label="Content stages"
            markerId="dirb-content-tabs"
            value={tab}
            onChange={k => setTab(k)}
            options={TAB_ORDER
              .map(t => ({
                key: t,
                label: t === 'ideas' ? 'Ideas' : STAGE_LABEL[t],
                // The ideas bank is a truncated slice of lm_idea_candidates, so
                // its tab prints the SERVER count: a truncated number beside
                // nine complete ones reads as a stage smaller than it is.
                n: t === 'ideas'
                  ? (ideas.counts.post ?? ideas.split.post.length)
                  : shownStages[t].length,
                mark: t === 'review',
              }))
              .filter(t => TAB_ALWAYS.includes(t.key as ContentTab) || t.n > 0)
              .map(t => ({
                id: t.key,
                label: t.label,
                count: t.n,
                sev: t.mark && t.n > 0 ? ('attention' as const) : undefined,
              }))}
          />

          {/* The POST side of the content_type partition only. Rows with no
              content_type ride here too, labelled, rather than vanishing from
              both lanes. While a draft facet is on it keeps its header and its
              count and drops its rows. */}
          {tab === 'ideas' ? (
            <IdeasSection
              ideas={ideas.split.post} kind="post" count={ideas.counts.post}
              unclassified={ideas.split.other}
              loading={ideas.loading}
              error={ideas.error} loadedAt={ideas.loadedAt} refresh={ideas.refresh}
              hiddenByFilter={ideasHidden}
            />
          ) : shown.length === 0 && drafts.length > 0 ? (
            /* The filter matched nothing ANYWHERE — said once, with the one
               control that undoes it. A per-tab "nothing at this stage" would be
               true and useless here: the stage is not the reason. */
            <FilteredEmpty noun="drafts" onClear={() => { setFilters({}); setQ('') }} />
          ) : (
            <>
              <StageDeck
                s={tab} rows={shownStages[tab]} lane="ivan" heading={STAGE_LABEL[tab]}
                refresh={refresh} onOpen={onOpen} openId={openId}
                sub={
                  tab === 'approved' && countUndated(shownStages.approved) > 0
                    ? `${countUndated(shownStages.approved)} approved without a date — on no other surface`
                    // 🔴 EVERY ERRORED ROW, not the old ones only. The 48-hour
                    // window survives as this sentence, which is where a time
                    // scope belongs once it is no longer a siren.
                    : tab === 'error'
                      ? (() => {
                        const recent = shownStages.error.filter(d => isRecentError(d)).length
                        return recent > 0
                          ? `${recent} of these errored inside the last ${ERROR_ALARM_HOURS} hours.`
                          : `Nothing has errored in the last ${ERROR_ALARM_HOURS} hours.`
                      })()
                      // PAST DUE — a scheduled row whose time came and went with
                      // no `source_post_id`.
                      : tab === 'stuck'
                        ? 'Their time passed and no published post came back — they never went out.'
                        : null
                }
                empty={tab === 'review' ? 'Nothing is waiting on you.' : undefined}
              />
              {/* The publish queue rides INSIDE the Scheduled tab: it answers
                  the one question the drafts deck cannot — did the thing that
                  was scheduled actually go out. */}
              {tab === 'scheduled' && (
                <QueueStrip
                  rows={queue.rows} loading={queue.loading} error={queue.error}
                  loadedAt={queue.loadedAt} refresh={queue.refresh}
                />
              )}
              {/* The pillar mix is a fact about the WHOLE lane, not about one
                  stage, so it rides under the published tab. */}
              {tab === 'published' && <PillarMix rows={drafts} />}
            </>
          )}
        </>
      )}
      {/* 🔴 `stages`, not `shownStages`: the count is built from every loaded
          row, so a filter can narrow the list without hiding work that is in
          flight. */}
      <InFlight
        n={stages.generating.length}
        stalled={stages.generating.filter(d => isStuckGenerating(d)).length}
        onOpen={() => { setView('flow'); setTab('generating') }}
      />
    </>
  )
}

// ---------------------------------------------------------------------------
// LANE B — a client lane
// ---------------------------------------------------------------------------
//
// ONE LEVEL, and one TAB BAR. The old render nested a "Waiting on you" stage
// section inside a "Not on his board" group header — two headers stacked over
// the same rows. The group level went, and clientStageLabel carries the where
// instead ("On buffer · client board", "Client approved"), which is what makes a
// FLAT tab bar possible here: every tab's label already says both whose turn it
// is and where the row sits.
//
// 🔴 A CLIENT TAB IS GROUP-PLUS-STAGE, not a stage. `review` means two different
// things on this lane — ours means "Ivan has not decided whether the client
// should see it", his means "the client has it and has not answered".
const BOARD_ORDER: BoardGroup[] = ['internal', 'board']

// Every stage a client row can hold, in pipeline order. `ideas` is not here
// because a client idea is not a `carousel_drafts` row at all — it lives in
// `client_ideas` and rides its own tab. `archived` is GONE.
const CLIENT_STAGES: ContentStage[] = [
  'review', 'generating', 'approved', 'scheduled', 'published',
  'error', 'stuck', 'other',
]
const CLIENT_IDEAS_TAB = 'ideas'
const CLIENT_TAB_KEYS: string[] = [
  CLIENT_IDEAS_TAB,
  ...BOARD_ORDER.flatMap(g => CLIENT_STAGES.map(s => `${g}_${s}`)),
]
// The one tab that shows at zero. It is the decision the lane exists to ask for,
// and a bar that hid it on a quiet day would answer "is anything waiting on me"
// by omission.
const CLIENT_TAB_ALWAYS = 'internal_review'

function MattanLane({ drafts, openId, onOpen, refresh, filters, setFilters, q, setQ, matched, view, setView, lane, setLane, onBoard, laneCounts }: {
  drafts: ContentDraft[]
  lane: ContentLane
  setLane: (l: ContentLane) => void
  // The lane's one standing fact, and it belongs on the strip beside the lane
  // switch: how much of what we hold he can actually see.
  onBoard: number
  laneCounts?: Partial<Record<ContentLane, number>>
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
  // The lane's idea bank. Read on mount rather than on tab-select: a tab that
  // has to be clicked before it can say how many rows it holds is not a count,
  // it is a promise.
  const ideas = useClientIdeas(lane, true)
  const filterStage = filters.stage as ContentStage | undefined
  const specs = draftSpecs(lane)
  const facets = buildFacets(drafts, specs)
  // The same prominent axes as Ivan's lane, deliberately WITHOUT `board`: this
  // lane is already GROUPED by board visibility.
  const { prominent, demoted } = splitFacets(facets, draftProminent(lane))
  // 🔴 Dealt from EVERY loaded row in the lane, not from the filtered set and
  // not per stage — a deal that moved with the filter would make the colour a
  // fact about the filter.
  const hues = sourceHues(drafts.map(d => d.source_label ?? null))
  // Unfiltered, both board groups. `stageOfLane` rather than a status test, so
  // the kickoff's 'planned' rows are counted as what they are.
  const inFlight = drafts.filter(d => stageOfLane(d, lane) === 'generating')
  const shown = applySearch(applyFilters(drafts, specs, filters), q, d => [d.title, d.topic, d.post_body])

  // The two halves, split ONCE. boardGroupOf, never an inline
  // `board_visible === true`: the grouping and the count that heads the lane
  // have to agree about NULL, and they only can if they ask the same function.
  //
  // 🔴 groupByLaneStage, not groupByStage. On this lane the DATE is the
  // schedule: the publisher takes a dated board row at `review` as well as one
  // at `scheduled`.
  const byGroup: Record<BoardGroup, ContentStages> = {
    internal: groupByLaneStage(shown.filter(d => boardGroupOf(d) === 'internal'), lane),
    board: groupByLaneStage(shown.filter(d => boardGroupOf(d) === 'board'), lane),
  }
  const stageTabs = BOARD_ORDER.flatMap(g => CLIENT_STAGES.map(st => ({
    key: `${g}_${st}`,
    label: clientStageLabel(st, g),
    n: byGroup[g][st].length,
    // OUR review is the only tab that carries the waiting-on-you dot. A mark on
    // the rows the client is sitting on would point at work that is not his to
    // do or Ivan's to chase.
    mark: g === 'internal' && st === 'review',
  }))).filter(t => t.key === CLIENT_TAB_ALWAYS || t.n > 0)
  // Ideas FIRST, the same position the bank takes on Ivan's bar, and always on —
  // a staged-ideas count that goes quiet at zero is the one number that says the
  // call miner has stopped feeding this lane.
  const tabs = [
    { key: CLIENT_IDEAS_TAB, label: 'Ideas', n: ideas.rows.length, mark: false },
    ...stageTabs,
  ]

  // An active stage filter selects a tab that exists. Ours first, then the
  // client's — a stage filter here is Ivan asking about work he still holds.
  useEffect(() => {
    if (!filterStage) return
    const wanted = [`internal_${filterStage}`, `board_${filterStage}`]
      .find(k => tabs.some(t => t.key === k))
    if (wanted) setTab(wanted)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterStage])

  // The tab a reload restored can be a stage that has since emptied, and the bar
  // drops empty tabs — so the selection is resolved against what is on the bar
  // RIGHT NOW rather than trusted.
  const active = tabs.some(t => t.key === tab) ? tab : (tabs[0]?.key ?? CLIENT_TAB_ALWAYS)
  const onIdeas = active === CLIENT_IDEAS_TAB
  // The ideas tab has no group and no stage, so the split is only asked for when
  // there is one to make.
  const [activeGroup, activeStage] = (() => {
    const key = onIdeas ? CLIENT_TAB_ALWAYS : active
    const i = key.indexOf('_')
    return [key.slice(0, i) as BoardGroup, key.slice(i + 1) as ContentStage]
  })()

  return (
    <>
      <CommandStrip
        lane={lane} setLane={setLane} view={view} setView={setView}
        laneCounts={laneCounts}
        laneNote={drafts.length > 0
          ? (
            <span className="ds-t-meta dirb-dim" title={`${onBoard} of the ${drafts.length} loaded drafts are visible on ${LANE_POSSESSIVE.risedtc} board`}>
              <b>{onBoard}</b>/{drafts.length} on his board
            </span>
          )
          : undefined}
        filter={
          // idleCount={false}, matching Ivan's lane. The FILTERED line is
          // untouched — that one is the number doing work.
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
          <Tabs
            label="Content stages"
            markerId="dirb-content-tabs"
            value={active}
            onChange={setTab}
            options={tabs.map(t => ({
              id: t.key,
              label: t.label,
              count: t.n,
              sev: t.mark && t.n > 0 ? ('attention' as const) : undefined,
            }))}
          />
          {onIdeas ? (
            // 🔴 The draft facets and the search box do NOT narrow these rows —
            // they are `client_ideas`, a different table — so the band says so
            // rather than rendering a filtered-looking list that ignored the
            // filter.
            draftFacetsActive(filters, q) ? (
              <div className="ds-t-meta dirb-dim">
                Hidden while a draft filter is on. These {ideas.rows.length} rows are{' '}
                <code>client_ideas</code> — a different table from the drafts the facets
                and the search box run over, so no filter here can narrow them. Clear the
                filter to read them.
              </div>
            ) : (
              <ClientIdeasSection
                ideas={ideas.rows} lane={lane}
                loading={ideas.loading} error={ideas.error}
                loadedAt={ideas.loadedAt} refresh={ideas.refresh}
              />
            )
          ) : shown.length === 0 && drafts.length > 0
            ? <FilteredEmpty noun="drafts" onClear={() => { setFilters({}); setQ('') }} />
            : (
              <StageDeck
                s={activeStage} rows={byGroup[activeGroup][activeStage]}
                heading={clientStageLabel(activeStage, activeGroup)}
                // 🔴 `lane`, not a hardcoded 'risedtc'. This component draws
                // every client lane (ARCH included), and the row uses it to
                // decide whether to print source_label and whether the review
                // controls are legal.
                lane={lane} hues={hues}
                refresh={refresh} onOpen={onOpen} openId={openId}
                empty={active === CLIENT_TAB_ALWAYS
                  ? 'Nothing is waiting on you.'
                  : `Nothing at ${clientStageLabel(activeStage, activeGroup).toLowerCase()}.`}
              />
            )}
        </>
      )}

      {/* Same mark as Ivan's lane, and the count is the LANE's — both board
          groups, unfiltered. Which group an in-flight draft is in is not a
          question anyone asks while it is running; how many are running is. */}
      <InFlight
        n={inFlight.length}
        stalled={inFlight.filter(d => isStuckGenerating(d)).length}
        onOpen={() => {
          setView('flow')
          setTab(`${boardGroupOf(inFlight[0]) === 'board' ? 'board' : 'internal'}_generating`)
        }}
      />
    </>
  )
}

// ---------------------------------------------------------------------------

export function ContentList({ lane, setLane, openId, onOpen, laneCounts }: {
  lane: ContentLane
  setLane: (l: ContentLane) => void
  openId: string | null
  onOpen: OpenDraft
  // The cross-lane review split, read once in the shell and handed down. It is
  // deliberately NOT derived here: useContent(lane) holds one lane at a time by
  // construction, so a count computed from these rows could only ever restate
  // the lane you are already looking at.
  laneCounts?: Partial<Record<ContentLane, number>>
}) {
  const { drafts, stages, matched, laneTotal, loading, error, loadedAt, refresh } = useContent(lane)
  const rowsRef = useRef<HTMLDivElement>(null)
  const ptr = usePullToRefresh(rowsRef, () => refresh())
  // PERSISTENCE, by KEYING rather than by amnesia. The section key carries the
  // lane (`content.posts2.ivan` vs `content.posts2.risedtc`), so a filter set on
  // one lane can never reach the other's vocabulary; coming BACK to a lane
  // restores the answer you left there. Forgetting was never the safety
  // property — not crossing lanes was.
  const [sect, setSect] = useSectionState(`content.posts2.${lane}`)
  // FLOW vs CALENDAR. Deliberately NOT in the per-lane section entry: the view
  // is a property of how Ivan is working right now, not of a lane's vocabulary,
  // and switching lane inside the calendar has to keep him in the calendar.
  const [view, setViewState] = useState<ContentView>(() => {
    try { return localStorage.getItem(VIEW_KEY) === 'calendar' ? 'calendar' : 'flow' } catch { return 'flow' }
  })
  const setView = (v: ContentView) => {
    setViewState(v)
    try { localStorage.setItem(VIEW_KEY, v) } catch { /* private mode */ }
  }
  const setFilters = (f: FilterState) => setSect(p => ({ ...p, filters: f }))
  const setQ = (q: string) => setSect(p => ({ ...p, q }))
  const switchLane = (l: ContentLane) => setLane(l)

  // Ops' "Open them in Content". The errored rows are a FLOW thing — the
  // calendar draws dated posts, and an errored draft has no date to draw — so
  // the view flips before the section is jumped to.
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
    <DirB>
      <div className="dirb-surface rows ct-rows" ref={rowsRef}>
        <PullIndicator pull={ptr.pull} refreshing={ptr.refreshing} trigger={ptr.trigger} />
        {/* 🔴 The lane switch is the ONE control that must survive every data
            state. The two kinds of lane read different tables, so an empty or
            broken client lane with no way back to Ivan is a dead surface. The
            strip drops its numbers here (there are none) and keeps its switch.
            🔴 The LANE counts are the exception and they ride even here: they
            come from the shell's own cross-lane read, so a broken or empty Ivan
            lane still says where the work is. */}
        {(err || firstLoad || nothingMatched) && (
          <CommandStrip
            lane={lane} setLane={switchLane} view={view} setView={setView}
            laneCounts={laneCounts} filter={null}
          />
        )}
        {err ? (
          <Failed
            what="The content pipeline"
            message={err}
            onRetry={refresh}
            loadedAt={drafts.length > 0 ? loadedAt : null}
          />
        ) : firstLoad ? (
          <LoadingRows />
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
            laneCounts={laneCounts}
          />
        ) : (
          <MattanLane
            drafts={drafts} openId={openId} onOpen={onOpen} refresh={refresh}
            lane={lane} setLane={switchLane} onBoard={onBoard}
            filters={sect.filters} setFilters={setFilters} q={sect.q} setQ={setQ}
            matched={matched} view={view} setView={setView}
            laneCounts={laneCounts}
          />
        )}
      </div>
    </DirB>
  )
}

export default ContentList
