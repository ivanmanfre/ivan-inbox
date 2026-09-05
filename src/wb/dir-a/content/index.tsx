/* ==========================================================================
   S03 Content flow + S04 Content calendar, Direction A.

   Copied from `src/exp/v2c/ContentList.tsx`. Every hook, every persisted key,
   every write, every window event and every string is the one that shipped;
   what is rebuilt is the frame the rows sit in.

   THE TWO LANES, and nothing else:

     Ivan            client_id IS NULL, plus the row sets that carry no tenancy
                     column at all and are therefore Ivan's by construction
     a client lane   client_id = the client's own id

   They are two VIEWS and not one filtered list because they obey different
   rules. The terminal fact of an Ivan row is whether it published; the terminal
   fact of a client row is whether it is on that client's board. On Ivan's lane
   `review` means "waiting on Ivan"; on a client's it means "available to be
   promoted", and most of the rows sit there — reading that lane through the
   pipeline's eyes produces "70 things waiting on you", which is false.

   So: Ivan groups by pipeline stage. A client groups by promotion state, with
   stage as the secondary key inside each group.

   THE COMMAND STRIP is the head plus one thin bar, and it carries what the old
   one carried: the lane switch, the view switch, the stage marks (calendar
   only), search and the filters. The lane switch is the ONE control that
   survives every data state, because the two lanes read different tables and an
   empty or broken client lane with no way back to Ivan is a dead surface. The
   lane COUNTS ride even there: they come from the shell's own cross-lane read,
   not from this lane's rows.
   ========================================================================== */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { usePullToRefresh } from '../../../hooks/usePullToRefresh'
import {
  useClientIdeas, useContent, useIdeaCandidates, useScheduledQueue,
} from '../../../hooks/useContent'
import {
  CONTENT_LANES, ERROR_ALARM_HOURS, LANE_LABEL, LANE_POSSESSIVE, PIPELINE_STAGES,
  STAGE_LABEL, STAGE_SHORT, boardGroupOf, clientStageLabel,
  countBoardVisible, countUndated, groupByLaneStage, groupByStage,
  isRecentError, isStuckGenerating, stageOfLane,
  type BoardGroup, type ContentDraft, type ContentLane, type ContentStage, type ContentStages,
} from '../../../lib/content'
import {
  applyFilters, applySearch, buildFacets, draftProminent, draftSpecs,
  DRAFT_PROMINENT, splitFacets,
  type FilterState,
} from '../../../lib/contentFilters'
import { useSectionState } from '../../../hooks/useSectionState'
import { draftFacetsActive } from '../../../exp/v2c/contentIdeas'
import { hasMock } from '../../../exp/v2c/mock'
import { Segmented, SkeletonRows, Tabs } from '../../../ds'
import { Bar, Body, Dot, Head, Screen } from '../kit'
import { CalmEmpty, Failed, FilteredEmpty, PullIndicator } from './parts'
import { FilterRow } from './filters'
import { StageTable, type OpenDraft } from './row'
import { ClientIdeasSection, IdeasSection } from './ideas'
import { InFlight, PillarMix, QueueStrip } from './queue'
import { ContentBulkBar } from './bulk'
import { ContentCalendar } from './calendar'
import './content.css'

// The Content area holds two views of the SAME rows, and the lane switch
// selects whose. Flow is the pipeline queue; Calendar is the month those rows
// are dated into. Both read one fetch and one filter state, so they can never
// disagree about what is scheduled.
export type ContentView = 'flow' | 'calendar'
const VIEW_KEY = 'wb-content-view'

export type { OpenDraft }

/** The two markers the keyboard layer reads off the DOM to know what its
    selection is scoped to. They are read, never seen. */
function Scope({ lane, tab }: { lane: ContentLane; tab?: string }) {
  return (
    <span className="a-ct-scopehost" aria-hidden>
      <span className="ct-cmd-lane on">{LANE_LABEL[lane]}</span>
      {tab && <span className="ct-tab on">{tab}</span>}
    </span>
  )
}

function CommandStrip({
  lane, setLane, view, setView, laneNote, laneCounts, stats, filter,
}: {
  lane: ContentLane
  setLane: (l: ContentLane) => void
  view?: ContentView
  setView?: (v: ContentView) => void
  laneNote?: ReactNode
  /** What each lane holds at REVIEW, from the shell's cross-lane read. Never
      from this surface's own rows, which only ever hold the selected lane. */
  laneCounts?: Partial<Record<ContentLane, number>>
  stats?: ReactNode
  filter?: ReactNode
}) {
  return (
    <>
      <Head>
        <div className="a-ct-headrow">
          {/* The lane switch is a VIEW switcher and keeps the grammar it has
              always had; it is not a filter. A zero is not printed: an empty
              lane says so by staying quiet, which is what lets a number mean
              something. */}
          <Segmented
            label="Lane"
            markerId="a-ct-lane"
            value={lane}
            onChange={k => setLane(k as ContentLane)}
            options={CONTENT_LANES.map(k => {
              const n = laneCounts?.[k] ?? 0
              return {
                id: k,
                label: <span title={n > 0 ? `${LANE_LABEL[k]}: ${n} at review` : undefined}>{LANE_LABEL[k]}</span>,
                count: n > 0 ? n : undefined,
              }
            })}
          />
          {/* The Flow/Calendar switch sits beside the lane switch because it
              answers the same kind of question: which view of this lane am I
              looking at. The lane it switches inside is the calendar's only
              selector. */}
          {view && setView && (
            <Segmented
              label="View"
              markerId="a-ct-view"
              value={view}
              onChange={v => setView(v as ContentView)}
              options={[
                { id: 'flow', label: <span className="ct-cmd-lane">Flow</span> },
                { id: 'calendar', label: <span className="ct-cmd-lane">Calendar</span> },
              ]}
            />
          )}
          {laneNote}
        </div>
      </Head>
      {stats && <Bar>{stats}</Bar>}
      {filter && <Bar>{filter}</Bar>}
    </>
  )
}

// THE PIPELINE, as marks that fit on the strip.
//
// PUBLISHED IS NOT A MARK — it is an archive count nobody acts on and the only
// stage that accumulates forever, so it would set the scale by itself.
function PipelineStats({ stages, onJump }: {
  stages: ContentStages
  onJump: (s: ContentStage) => void
}) {
  const parts = PIPELINE_STAGES
    .filter(s => s !== 'ideas' && s !== 'published')
    .map(s => ({ stage: s, n: stages[s].length }))
  const peak = Math.max(1, ...parts.map(p => p.n))
  // ONE WORD PER NUMBER. This sum is every PIPELINE stage, published included —
  // deliberately wider than the marks, so narrowing the drawing does not
  // silently restate the denominator. It is NOT the lane: error, stuck and
  // other are more rows it never counts, which is why the filter row's own
  // count says `loaded`.
  const inPipeline = PIPELINE_STAGES
    .filter(s => s !== 'ideas')
    .reduce((a, s) => a + stages[s].length, 0)
  const undated = countUndated(stages.approved)
  return (
    <div className="a-ct-stats">
      {parts.map(p => {
        const tone = p.stage === 'review' && p.n > 0
          ? 'attention'
          : p.stage === 'approved' && undated > 0 ? 'attention' : undefined
        const note = p.stage === 'review'
          ? `waiting on you · ${inPipeline} in pipeline`
          : p.stage === 'approved' && undated > 0
            ? `${undated} of them approved with no date — on no other surface`
            : `${inPipeline} in pipeline`
        return (
          <button
            key={p.stage}
            type="button"
            className="a-ct-stat"
            data-tone={tone}
            title={`${STAGE_LABEL[p.stage]}: ${p.n} · bar is ${p.n} of ${peak}, the largest stage · ${note}`}
            onClick={() => onJump(p.stage)}
          >
            <span className="a-ct-stat-h">
              <Dot tone={tone} off={p.n === 0} />
              <span className="a-ct-stat-l">{STAGE_SHORT[p.stage]}</span>
              <span className="a-ct-stat-n">{p.n}</span>
            </span>
            <span className="a-ct-stat-r"><i style={{ width: `${(peak > 0 ? p.n / peak : 0) * 100}%` }} /></span>
          </button>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// THE TABS — one stage on screen at a time
// ---------------------------------------------------------------------------
//
// What this deliberately keeps from the stacked sections it replaced: the row
// anatomy is untouched; the SUB-LINES survive per tab (the 48h error scope, the
// approved-with-no-date count, the past-due explanation), because those are the
// sentences that make a count mean something; and the publish queue still rides
// under Scheduled, because it answers the question that stage asks. What it
// drops is the per-section collapse state: a tab IS the open and closed answer.
type ContentTab = ContentStage | 'ideas'

// Render order of the bar, left to right in pipeline order, which is the order
// a row actually travels. `stuck`/`other` only appear when they have rows — an
// always-on tab reading zero spends a slot on a stage that does not exist
// today. `archived` is not on this bar at all: the rows still exist and are
// still filed, Content simply has no archived category any more.
const TAB_ORDER: ContentTab[] = [
  'ideas', 'review', 'generating', 'approved', 'scheduled', 'published',
  'error', 'stuck', 'other',
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

type StageTab = { key: string; label: string; n: number; mark?: boolean }

/** The stage strip. A count badge appears only where there is a count; the
    review tab carries the operator's own mark, which is never a warning: a
    backlog is not an alarm, it is the work. */
function StageTabs({ tabs, active, onSelect }: {
  tabs: StageTab[]
  active: string
  onSelect: (key: string) => void
}) {
  return (
    <div className="a-ct-tabsbar">
      <Tabs
        label="Stage"
        markerId="a-ct-stage"
        value={active}
        onChange={onSelect}
        options={tabs.map(t => ({
          id: t.key,
          label: (
            <span className="a-wrapline">
              {t.label}
              {t.mark && t.n > 0 && <Dot tone="accent" />}
            </span>
          ),
          count: t.n > 0 ? t.n : undefined,
        }))}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// LANE A — Ivan
// ---------------------------------------------------------------------------

function IvanLane({
  drafts, stages, openId, onOpen, refresh, filters, setFilters, q, setQ, matched,
  view, setView, lane, setLane, laneCounts, bodyRef, ptr,
}: {
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
  bodyRef: React.RefObject<HTMLDivElement | null>
  ptr: { pull: number; refreshing: boolean; trigger: number }
}) {
  // ONE TAB, persisted per lane. A view preference, so it keeps its own key
  // rather than riding in the section entry the filters use.
  const [tabRaw, setTab] = useStageTab('ivan', TAB_ORDER, 'review')
  const tab = tabRaw as ContentTab
  // Determinism under a filter: an ACTIVE stage filter selects its tab, so the
  // filter and the table can never be describing two stages.
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

  // The other end of the Ops jump ("Open them in Content").
  useEffect(() => {
    const on = () => setTab('error')
    window.addEventListener('wb-open-content-errors', on)
    return () => window.removeEventListener('wb-open-content-errors', on)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const specs = draftSpecs('ivan')
  // Counts are derived over EVERY loaded row, not over the current result: the
  // count is the fact the filter is being chosen against, and a count that
  // already reflects the choice you have not made yet is a moving target.
  const facets = buildFacets(drafts, specs)
  const { prominent, demoted } = splitFacets(facets, DRAFT_PROMINENT)
  // post_body is already in memory, so the search runs over it too: leaving it
  // out meant "where is that draft about margins" found one of the five drafts
  // that say margin. It is a substring scan over rows that are already here, so
  // it costs no fetch and no round trip.
  const shown = applySearch(applyFilters(drafts, specs, filters), q, d => [d.title, d.topic, d.post_body])
  const shownStages = groupByStage(shown)
  const ideasHidden = draftFacetsActive(filters, q)

  const tabs: StageTab[] = TAB_ORDER
    .map(t => ({
      key: t,
      label: t === 'ideas' ? 'Ideas' : STAGE_LABEL[t],
      // The ideas bank is a truncated slice of a different table, so its tab
      // prints the SERVER count: a truncated number beside complete ones reads
      // as a stage smaller than it is. Every other tab counts the rows the
      // click will produce.
      n: t === 'ideas'
        ? (ideas.counts.post ?? ideas.split.post.length)
        : shownStages[t].length,
      mark: t === 'review',
    }))
    .filter(t => TAB_ALWAYS.includes(t.key as ContentTab) || t.n > 0)

  return (
    <>
      <CommandStrip
        lane={lane} setLane={setLane} view={view} setView={setView}
        laneCounts={laneCounts}
        stats={
          // CALENDAR ONLY. In Flow the marks and the tab bar would print the
          // same four numbers one row apart, and the tabs win it: they carry
          // every stage rather than four, and the click SELECTS rather than
          // scrolls. The calendar has no tab bar, so there the marks keep their
          // job — count the lane, and take you back to the rows.
          view === 'calendar'
            ? <PipelineStats stages={stages} onJump={s => { setView('flow'); jump(s) }} />
            : undefined
        }
        filter={
          // idleCount={false}: an unfiltered total here was the figure the
          // strip printed two slots left, and that figure is gone. The FILTERED
          // line (`9 of 224 shown`) is the number doing work and is never
          // suppressed.
          <FilterRow
            prominent={prominent} demoted={demoted}
            state={filters} setState={setFilters} q={q} setQ={setQ}
            shown={shown.length} loaded={drafts.length} total={matched} noun="drafts"
            idleCount={false} inline
          />
        }
      />
      {view === 'flow' && <StageTabs tabs={tabs} active={tab} onSelect={k => setTab(k)} />}
      <Scope lane={lane} tab={view === 'flow' ? tabs.find(t => t.key === tab)?.label : undefined} />

      <Body innerRef={bodyRef}>
        <PullIndicator pull={ptr.pull} refreshing={ptr.refreshing} trigger={ptr.trigger} />
        {view === 'calendar' ? (
          // BOTH SOURCES, one refresh. The calendar draws drafts AND the
          // publish queue, so a move that re-read only the drafts would leave
          // half the grid on the copy it was mounted with — the stale half
          // being the one that changes on a clock.
          <ContentCalendar
            rows={shown} queue={queue.rows} onOpen={onOpen}
            refresh={() => { refresh(); queue.refresh() }}
          />
        ) : tab === 'ideas' ? (
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
            <StageTable
              s={tab} rows={shownStages[tab]} lane="ivan"
              refresh={refresh} onOpen={onOpen} openId={openId}
              sub={
                tab === 'approved' && countUndated(shownStages.approved) > 0
                  ? `${countUndated(shownStages.approved)} approved without a date — on no other surface`
                  // EVERY ERRORED ROW, not the old ones only. This table used
                  // to exclude the last 48 hours because that window belonged
                  // to an alarm band; the band went and the window survives as
                  // this sentence, which is where a time scope belongs once it
                  // is no longer a siren.
                  : tab === 'error'
                    ? (() => {
                      const recent = shownStages.error.filter(d => isRecentError(d)).length
                      return recent > 0
                        ? `${recent} of these errored inside the last ${ERROR_ALARM_HOURS} hours.`
                        : `Nothing has errored in the last ${ERROR_ALARM_HOURS} hours.`
                    })()
                    // PAST DUE — a scheduled row whose time came and went with
                    // nothing published. It keeps its own tab and its own
                    // sentence.
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
            {/* The pillar mix is a fact about the WHOLE lane, not about one
                stage, so it rides under the archive tab rather than under every
                table. */}
            {tab === 'published' && <PillarMix rows={drafts} />}
          </>
        )}
      </Body>

      {/* `stages`, not `shownStages`: the count is built from every loaded row,
          so a filter can narrow the list without hiding work that is in
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
// LANE B — a client
// ---------------------------------------------------------------------------
//
// ONE LEVEL, and one TAB BAR. The group level went when `clientStageLabel`
// started carrying the where instead ("On buffer · client board", "Client
// approved"), which is exactly what makes a FLAT bar possible here: every
// tab's label already says both whose turn it is and where the row sits.
//
// A CLIENT TAB IS GROUP-PLUS-STAGE, not a stage. `review` means two different
// things on this lane — ours means "Ivan has not decided whether the client
// should see it", his means "the client has it and has not answered" — so one
// Review tab holding both would be the collision the group labels exist to
// prevent.
const BOARD_ORDER: BoardGroup[] = ['internal', 'board']

// Every stage a client row can hold, in pipeline order. `ideas` is not here
// because a client idea is not a draft row at all: it lives in its own table
// and rides its own tab beside this composite set.
const CLIENT_STAGES: ContentStage[] = [
  'review', 'generating', 'approved', 'scheduled', 'published',
  'error', 'stuck', 'other',
]
const CLIENT_IDEAS_TAB = 'ideas'
const CLIENT_TAB_KEYS: string[] = [
  CLIENT_IDEAS_TAB,
  ...BOARD_ORDER.flatMap(g => CLIENT_STAGES.map(s => `${g}_${s}`)),
]
// The one tab that shows at zero. It is the decision the lane exists to ask
// for, and a bar that hid it on a quiet day would answer "is anything waiting
// on me" by omission.
const CLIENT_TAB_ALWAYS = 'internal_review'

function MattanLane({
  drafts, openId, onOpen, refresh, filters, setFilters, q, setQ, matched,
  view, setView, lane, setLane, onBoard, laneCounts, bodyRef, ptr,
}: {
  drafts: ContentDraft[]
  lane: ContentLane
  setLane: (l: ContentLane) => void
  /** The lane's one standing fact, beside the lane switch rather than under a
      display title: how much of what we hold he can actually see. */
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
  bodyRef: React.RefObject<HTMLDivElement | null>
  ptr: { pull: number; refreshing: boolean; trigger: number }
}) {
  // The lane opens on the decision it is asking for. Per-lane key, so each
  // client keeps its own answer.
  const [tab, setTab] = useStageTab(lane, CLIENT_TAB_KEYS, CLIENT_TAB_ALWAYS)
  // The lane's idea bank. Read on mount rather than on tab-select: the count is
  // ON the bar, and a tab that has to be clicked before it can say how many
  // rows it holds is not a count, it is a promise.
  const ideas = useClientIdeas(lane, true)
  // Same determinism rule as the Ivan lane. OURS first — a stage filter on this
  // lane is Ivan asking about work he still holds; if that half is empty the
  // effect falls through to the client's.
  const filterStage = filters.stage as ContentStage | undefined
  const specs = draftSpecs(lane)
  const facets = buildFacets(drafts, specs)
  // The same prominent axes as Ivan's lane, deliberately WITHOUT board
  // visibility: this lane is already GROUPED by it, so a board pill would be a
  // second control for a distinction the page structure already draws. It stays
  // available in the disclosure.
  const { prominent, demoted } = splitFacets(facets, draftProminent(lane))
  // Unfiltered, both board groups. `stageOfLane` rather than a status test, so
  // the kickoff's planned rows are counted as what they are.
  const inFlight = drafts.filter(d => stageOfLane(d, lane) === 'generating')
  const shown = applySearch(applyFilters(drafts, specs, filters), q, d => [d.title, d.topic, d.post_body])

  // The two halves, split ONCE. boardGroupOf, never an inline board_visible
  // test: the grouping and the count that heads the lane have to agree about
  // null, and they only can if they ask the same function.
  //
  // groupByLaneStage, not groupByStage. On this lane the DATE is the schedule:
  // the publisher takes a dated board row at `review` as well as one at
  // `scheduled`, so dated rows were sitting under "On buffer" while their
  // publish times were already set.
  const byGroup: Record<BoardGroup, ContentStages> = {
    internal: groupByLaneStage(shown.filter(d => boardGroupOf(d) === 'internal'), lane),
    board: groupByLaneStage(shown.filter(d => boardGroupOf(d) === 'board'), lane),
  }
  const stageTabs: StageTab[] = BOARD_ORDER.flatMap(g => CLIENT_STAGES.map(st => ({
    key: `${g}_${st}`,
    label: clientStageLabel(st, g),
    n: byGroup[g][st].length,
    // OUR review is the only tab that carries the waiting-on-you mark. A mark
    // on the rows the client is sitting on would point at work that is not his
    // to do or Ivan's to chase.
    mark: g === 'internal' && st === 'review',
  }))).filter(t => t.key === CLIENT_TAB_ALWAYS || t.n > 0)
  // Ideas FIRST, the same position the bank takes on Ivan's bar, and always on
  // — a staged-ideas count that goes quiet at zero is the one number that says
  // the miner has stopped feeding this lane.
  const tabs: StageTab[] = [
    { key: CLIENT_IDEAS_TAB, label: 'Ideas', n: ideas.rows.length, mark: false },
    ...stageTabs,
  ]

  // An active stage filter selects a tab that exists. Ours first, then the
  // client's.
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
  // table and the highlighted tab describing the same rows.
  const active = tabs.some(t => t.key === tab) ? tab : (tabs[0]?.key ?? CLIENT_TAB_ALWAYS)
  const onIdeas = active === CLIENT_IDEAS_TAB
  // The ideas tab has no group and no stage, so the split is only asked for
  // when there is one to make.
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
            <span className="a-ct-note" title={`${onBoard} of the ${drafts.length} loaded drafts are visible on ${LANE_POSSESSIVE[lane]} board`}>
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
      {view === 'flow' && <StageTabs tabs={tabs} active={active} onSelect={setTab} />}
      <Scope lane={lane} tab={view === 'flow' ? tabs.find(t => t.key === active)?.label : undefined} />

      <Body innerRef={bodyRef}>
        <PullIndicator pull={ptr.pull} refreshing={ptr.refreshing} trigger={ptr.trigger} />
        {view === 'calendar' ? (
          <ContentCalendar rows={shown} onOpen={onOpen} refresh={refresh} />
        ) : onIdeas ? (
          // The draft facets and the search box do NOT narrow these rows — they
          // are a different table — so the band says so rather than rendering a
          // filtered-looking list that ignored the filter.
          draftFacetsActive(filters, q) ? (
            <div className="a-ct-sub">
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
            <StageTable
              s={activeStage} rows={byGroup[activeGroup][activeStage]}
              // `lane`, not a hardcoded client id. This component draws every
              // client lane, and the row uses it to decide whether to print the
              // source and whether the review controls are legal.
              lane={lane}
              groupLabel={clientStageLabel(activeStage, activeGroup)}
              refresh={refresh} onOpen={onOpen} openId={openId}
              empty={active === CLIENT_TAB_ALWAYS
                ? 'Nothing is waiting on you.'
                : `Nothing at ${clientStageLabel(activeStage, activeGroup).toLowerCase()}.`}
            />
          )}
      </Body>

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
  /** The cross-lane review split, read once in the shell and handed down. It is
      deliberately NOT derived here: this fetch holds one lane at a time by
      construction, so a count computed from these rows could only ever restate
      the lane you are already looking at. */
  laneCounts?: Partial<Record<ContentLane, number>>
}) {
  const { drafts, stages, matched, laneTotal, loading, error, loadedAt, refresh } = useContent(lane)
  const rowsRef = useRef<HTMLDivElement>(null)
  const ptr = usePullToRefresh(rowsRef, () => refresh())
  // PERSISTENCE, and the reset it deliberately replaces. Filter state used to
  // be dropped on every lane switch and lost on every reload, with the stated
  // reason that the two lanes spell the same ideas differently and a carried
  // filter would silently hide rows. That reason is preserved by KEYING, not by
  // amnesia: the section key carries the lane, so a filter set on one lane can
  // never reach the other's vocabulary. Forgetting was never the safety
  // property — not crossing lanes was.
  const [sect, setSect] = useSectionState(`content.posts2.${lane}`)
  // FLOW vs CALENDAR. Deliberately NOT in the per-lane section entry: the view
  // is a property of how Ivan is working right now, not of a lane's vocabulary,
  // and switching lane inside the calendar has to keep him in the calendar —
  // that is what makes the lane switch the calendar's selector.
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

  // The Ops jump ("Open them in Content"). The errored rows are a FLOW thing —
  // the calendar draws dated posts, and an errored draft has no date to draw —
  // so the view flips before the tab is selected.
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
    <Screen className="a-ct">
      {(err || firstLoad || nothingMatched) ? (
        <>
          {/* The lane switch is the ONE control that must survive every data
              state. The strip drops its numbers here (there are none) and keeps
              its switch, and the LANE counts ride even here because they come
              from the shell's cross-lane read: a broken or empty lane still
              says where the work is. */}
          <CommandStrip
            lane={lane} setLane={switchLane} view={view} setView={setView}
            laneCounts={laneCounts}
          />
          <Scope lane={lane} />
          <Body innerRef={rowsRef}>
            <PullIndicator pull={ptr.pull} refreshing={ptr.refreshing} trigger={ptr.trigger} />
            {err ? (
              <Failed
                what="The content pipeline"
                message={err}
                onRetry={refresh}
                loadedAt={drafts.length > 0 ? loadedAt : null}
              />
            ) : firstLoad ? (
              <SkeletonRows rows={8} label="Reading the content pipeline" />
            ) : filteredAway ? (
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
            )}
          </Body>
        </>
      ) : lane === 'ivan' ? (
        <IvanLane
          drafts={drafts} stages={stages} openId={openId} onOpen={onOpen} refresh={refresh}
          lane={lane} setLane={switchLane}
          filters={sect.filters} setFilters={setFilters} q={sect.q} setQ={setQ}
          matched={matched} view={view} setView={setView}
          laneCounts={laneCounts}
          bodyRef={rowsRef} ptr={ptr}
        />
      ) : (
        <MattanLane
          drafts={drafts} openId={openId} onOpen={onOpen} refresh={refresh}
          lane={lane} setLane={switchLane} onBoard={onBoard}
          filters={sect.filters} setFilters={setFilters} q={sect.q} setQ={setQ}
          matched={matched} view={view} setView={setView}
          laneCounts={laneCounts}
          bodyRef={rowsRef} ptr={ptr}
        />
      )}
      {/* S24 — the selection bar, over the plate. */}
      <ContentBulkBar />
    </Screen>
  )
}
