/* ==========================================================================
   S05 — MAGNETS. The lead-magnet pipeline as its own job.

   Copied from `src/exp/v2c/MagnetsList.tsx` and the `ResourceLane`, `LmRow`
   and `LmStageTable` pieces of `src/exp/v2c/ContentSections.tsx`. Every hook,
   every fetch, every persisted key, every string and the whole stage
   vocabulary are the ones those files had; only the view is rebuilt, on the
   design system and on the same parts the post lane uses.

   The point of the rebuild: a lead magnet and a draft are two rows of the same
   working list, so they get ONE anatomy. The anchor carries the cover and the
   stage, the meta line never reflows, the landing link rides in the row's own
   actions, and the stage strip is the ds `Tabs` the post lane already reads.
   ========================================================================== */
import { useRef, useState } from 'react'
import { usePullToRefresh } from '../../hooks/usePullToRefresh'
import { useIdeaCandidates, useResources } from '../../hooks/useContent'
import { useSectionState } from '../../hooks/useSectionState'
import {
  CONTENT_LANES, elapsedMinutes, LANE_LABEL, LANE_POSSESSIVE, STUCK_GENERATING_MINUTES,
  type ContentLane, type IdeaCandidate,
} from '../../lib/content'
import {
  groupByLmStage, isStuckGeneratingLm, isStuckResource,
  LM_PIPELINE_STAGES, LM_STAGE_LABEL, normalizeLmStatus, stageOfLm,
  type LmStage, type Resource,
} from '../../lib/styles'
import {
  applyFilters, applySearch, buildFacets, RESOURCE_PROMINENT, RESOURCE_SPECS,
  splitFacets, type FilterState,
} from '../../lib/contentFilters'
import { relTime } from '../../exp/v2c/fmt'
import { Banner, Icon, Segmented, Tabs } from '../../ds'
import { Body, Dot, Group, Head, Row, Rows, Screen, Sep } from '../kit'
import { CalmEmpty, Failed, FilteredEmpty, PullIndicator } from './parts'
import { FilterRow } from './filters'
import { IdeasSection } from './ideas'
import { RowSelect, useRowState } from './select'
import './content.css'

/** Opening a lead magnet hands the window the SECTION it was opened from, so
    j/k and the window's rail walk exactly the rows Ivan can see. */
export type OpenMagnet = (id: string, label: string, queue: Resource[]) => void

// The tab order IS the lifecycle, idea first: the first cut of the old sections
// appended idea AFTER published, which put the largest stage in the lane under
// the terminal ones and read as a bug. The three off-pipeline stages ride at
// the end and only when they have rows.
const LM_TAB_ORDER: LmStage[] = [...LM_PIPELINE_STAGES, 'error', 'archived', 'other']
const LM_TAB_ALWAYS: LmStage[] = [...LM_PIPELINE_STAGES]
const LM_TAB_KEY = (lane: ContentLane) => `wb-lm-tab-${lane}`

// ---------------------------------------------------------------------------
// One lead-magnet row
// ---------------------------------------------------------------------------

function LmRow({ r, onOpen, queue }: { r: Resource; onOpen?: OpenMagnet; queue: Resource[] }) {
  const stage = stageOfLm(r)
  const stalled = isStuckGeneratingLm(r)
  const stuck = isStuckResource(r)
  const mins = stalled ? elapsedMinutes(r.updated_at) : null
  const title = r.topic ?? 'Untitled'
  const { selected, focused } = useRowState(r.id)
  // The fold stays auditable from the row: a reader can find out that "Idea" is
  // thirty-seven rows the database still calls `pending` without a mark being
  // spent on it.
  const folded = normalizeLmStatus(r.status) !== r.status
  const stageTitle = folded
    ? `${LM_STAGE_LABEL[stage]} — folded from the database value "${r.status}"`
    : `${LM_STAGE_LABEL[stage]} (status: ${r.status})`

  return (
    <Row
      className="a-ct-row"
      selected={selected}
      focused={focused}
      sev={stalled || stuck ? 'attention' : undefined}
      onClick={onOpen ? () => onOpen(r.id, title, queue) : undefined}
      lead={
        <span className="a-ct-anchor" data-st={stage} data-qa="none">
          {/* A lead magnet has no bulk write of its own, so it declares no
              capabilities and the bar says so in words rather than offering a
              button that would refuse. */}
          <RowSelect id={r.id} kind="magnet" label={title} caps={[]} />
          {r.cover_url
            ? <img className="a-ct-thumb" src={r.cover_url} alt="" />
            : <span className="a-ct-thumb" aria-hidden />}
          <span className="a-ct-qa" data-qa="none" title="lead-magnet rows carry no QA column" />
        </span>
      }
      title={title}
      meta={
        <>
          {/* SLOT ONE, fixed x. On the post lane this is the QA verdict; an LM
              row has none, so it is the FORMAT — the one fact that varies row to
              row INSIDE a stage section. It is deliberately not the stage: the
              section and the anchor dot already carry that, and printing it here
              drew "IDEA" thirty-seven times down one column. On a stalled run it
              carries the age instead, because for that row that IS the fact. */}
          {stalled
            ? (
              <span className="a-wrapline a-sev-attention">
                <Icon name="alert" size={16} />
                <span>{mins}m</span>
              </span>
            )
            : (
              <span className={stuck ? 'a-sev-attention' : undefined} title={stageTitle}>
                {r.format ?? LM_STAGE_LABEL[stage]}
              </span>
            )}
          <Sep />
          <span className="a-dim-2">{LM_STAGE_LABEL[stage]}</span>
        </>
      }
      tail={<span className="a-dim">{relTime(r.updated_at)}</span>}
      actions={
        r.landing_url
          ? (
            <a
              className="a-link a-wrapline" href={r.landing_url}
              target="_blank" rel="noreferrer"
              onClick={e => e.stopPropagation()}
            >
              <span>landing</span>
              <Icon name="external" size={16} />
            </a>
          )
          : <span className="a-dim-2">no landing URL</span>
      }
    />
  )
}

/** One stage's rows. No header and no chevron: the tab above it is both. An
    empty stage says so rather than rendering nothing — on a tabbed surface,
    "nothing here" and "I clicked the wrong thing" look identical on a blank
    screen. */
function LmStageTable({ s, rows, onOpen }: {
  s: LmStage; rows: Resource[]; onOpen?: OpenMagnet
}) {
  return (
    <div id={`wb-s-lm-${s}`} className="a-stack">
      {rows.length === 0
        ? <CalmEmpty line={`Nothing at ${LM_STAGE_LABEL[s].toLowerCase()}.`} loadedAt={null} />
        : (
          <Group label={<LmStageMark stage={s} />} tail={rows.length} stickyHead>
            <Rows>
              {rows.map(r => <LmRow key={r.id} r={r} onOpen={onOpen} queue={rows} />)}
            </Rows>
          </Group>
        )}
    </div>
  )
}

function LmStageMark({ stage }: { stage: LmStage }) {
  return (
    <span className="a-wrapline">
      <Dot
        tone={stage === 'review' ? 'accent' : stage === 'error' ? 'attention' : undefined}
        off={stage === 'published' || stage === 'archived'}
      />
      <span>{LM_STAGE_LABEL[stage]}</span>
    </span>
  )
}

// ---------------------------------------------------------------------------
// The lane
// ---------------------------------------------------------------------------

function ResourceLane({ rows, lane, ideas, ideaCount, loading, error, loadedAt, refresh, ideaState, onOpen }: {
  rows: Resource[]
  lane: ContentLane
  /** The lead-magnet side of the idea partition. Only the Ivan lane has one:
      lm_idea_candidates carries no tenancy column at all. */
  ideas: IdeaCandidate[] | null
  ideaCount: number | null
  loading: boolean
  error: string | null
  loadedAt: string | null
  refresh: () => void
  ideaState?: { loading: boolean; error: string | null; loadedAt: string | null; refresh: () => void }
  onOpen?: OpenMagnet
}) {
  // The LM lane is a SEPARATE working list with its own facets, so it keeps its
  // own persisted key: the post lane's `Stage: Review` has nothing to say about
  // an lm_drafts_v2 status, and one shared key would let one lane's answer
  // appear over the other's rows.
  const [sect, setSect] = useSectionState(`content.lm.${lane}`)
  const filters = sect.filters
  const setFilters = (f: FilterState) => setSect(p => ({ ...p, filters: f }))
  const setQ = (q: string) => setSect(p => ({ ...p, q }))
  const [tab, setTabState] = useState<LmStage>(() => {
    try {
      const v = localStorage.getItem(LM_TAB_KEY(lane))
      return (LM_TAB_ORDER as string[]).includes(v ?? '') ? (v as LmStage) : 'review'
    } catch { return 'review' }
  })
  const setTab = (t: LmStage) => {
    setTabState(t)
    try { localStorage.setItem(LM_TAB_KEY(lane), t) } catch { /* private mode */ }
  }
  const facets = buildFacets(rows, RESOURCE_SPECS)
  const { prominent, demoted } = splitFacets(facets, RESOURCE_PROMINENT)
  const shown = applySearch(applyFilters(rows, RESOURCE_SPECS, filters), sect.q, r => [r.topic])
  const stages = groupByLmStage(shown)
  // Built from the UNFILTERED rows, exactly as the post lane's marks are: a
  // filter may narrow the flow, it may never hide a broken row.
  const stalled = rows.filter(isStuckGeneratingLm)
  const errored = rows.filter(r => stageOfLm(r) === 'error')

  if (error) return <Failed what="Lead magnets" message={error} onRetry={refresh} loadedAt={null} />
  if (loading && rows.length === 0) return <div className="a-ct-sub">Reading the lead-magnet pipeline…</div>
  if (rows.length === 0) {
    return <CalmEmpty line={`No lead magnets in ${LANE_POSSESSIVE[lane]} lane.`} loadedAt={loadedAt} />
  }

  const tabs = LM_TAB_ORDER
    .map(st => ({ key: st, label: LM_STAGE_LABEL[st], n: stages[st].length, mark: st === 'review' }))
    .filter(t => LM_TAB_ALWAYS.includes(t.key) || t.n > 0)

  return (
    <div id="wb-lm-lane" className="a-stack">
      {/* The alert names something actionable TODAY, and nothing else: the 34
          terminal rows with no landing URL predate landing pages and were an
          alarm nobody would ever clear. */}
      {(errored.length + stalled.length) > 0 && (
        <Banner
          tone="attention"
          icon="alert"
          title={[
            errored.length > 0 && `${errored.length} errored`,
            stalled.length > 0 && `${stalled.length} generating past ${STUCK_GENERATING_MINUTES}m`,
          ].filter(Boolean).join(' · ')}
        />
      )}

      <FilterRow
        prominent={prominent} demoted={demoted}
        state={filters} setState={setFilters} q={sect.q} setQ={setQ}
        shown={shown.length} loaded={rows.length} total={null} noun="lead magnets"
        placeholder="Search lead magnets by topic…"
        inline
      />

      {ideas && ideaState && (
        <IdeasSection
          ideas={ideas} kind="lead_magnet" count={ideaCount}
          loading={ideaState.loading} error={ideaState.error}
          loadedAt={ideaState.loadedAt} refresh={ideaState.refresh}
          title="Lead-magnet ideas"
        />
      )}

      <div className="a-ct-tabsbar">
        <Tabs
          label="Stage"
          markerId="a-lm-stage"
          value={tab}
          onChange={k => setTab(k as LmStage)}
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

      {shown.length === 0
        ? <FilteredEmpty noun="lead magnets" onClear={() => setSect(cur => ({ ...cur, filters: {}, q: '' }))} />
        : <LmStageTable s={tab} rows={stages[tab]} onOpen={onOpen} />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// The surface
// ---------------------------------------------------------------------------

export function MagnetsList({ lane, setLane, onOpen }: {
  lane: ContentLane
  setLane: (l: ContentLane) => void
  onOpen?: OpenMagnet
}) {
  const resources = useResources(lane)
  // Ivan lane only: the LM side of the content_type partition. The hook is
  // enabled per lane so a client view never pays the fetch for a row set it is
  // forbidden to render.
  const ideas = useIdeaCandidates(lane === 'ivan')
  const rowsRef = useRef<HTMLDivElement>(null)
  const ptr = usePullToRefresh(rowsRef, () => resources.refresh())

  return (
    <Screen className="a-ct">
      <Head
        title="Lead magnets"
        tail={
          <Segmented
            label="Lane"
            markerId="a-lm-lane"
            value={lane}
            onChange={k => setLane(k as ContentLane)}
            options={CONTENT_LANES.map(k => ({ id: k, label: LANE_LABEL[k] }))}
          />
        }
      />
      <Body innerRef={rowsRef}>
        <PullIndicator pull={ptr.pull} refreshing={ptr.refreshing} trigger={ptr.trigger} />
        {lane === 'ivan' ? (
          <ResourceLane
            rows={resources.rows} lane="ivan"
            ideas={ideas.split.lead_magnet} ideaCount={ideas.counts.lead_magnet}
            ideaState={ideas}
            loading={resources.loading}
            error={resources.error} loadedAt={resources.loadedAt} refresh={resources.refresh}
            onOpen={onOpen}
          />
        ) : (
          <ResourceLane
            rows={resources.rows} lane={lane} ideas={null} ideaCount={null}
            loading={resources.loading}
            error={resources.error} loadedAt={resources.loadedAt} refresh={resources.refresh}
            onOpen={onOpen}
          />
        )}
      </Body>
    </Screen>
  )
}
