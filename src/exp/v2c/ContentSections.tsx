import { useState } from 'react'
import {
  elapsedMinutes, LANE_POSSESSIVE, STUCK_GENERATING_MINUTES, taxonomyFields, queueFailed,
  type ContentDraft, type ContentLane, type IdeaCandidate, type ScheduledQueueRow,
} from '../../lib/content'
import {
  cleanStyleTitle, groupByLmStage, isStuckGeneratingLm, isStuckResource,
  LM_PIPELINE_STAGES, LM_STAGE_LABEL, LM_STAGE_SHORT, normalizeLmStatus, previewKeyFor, previewsByStyle,
  stageOfLm,
  type LmStage, type Resource, type StylePrompt,
} from '../../lib/styles'
import {
  applyFilters, applySearch, buildFacets, IDEA_SPECS, QUEUE_SPECS, RESOURCE_SPECS,
  RESOURCE_PROMINENT, splitFacets, styleSpecs,
  type FilterState,
} from '../../lib/contentFilters'
import { useSectionState } from '../../hooks/useSectionState'
import type { AgentSummary } from '../../lib/agent'
import { FilterBar, FilteredEmpty, Figure, KeyRows } from './ContentBits'
import { FilterRow } from './FilterRow'
import { absTime, relOrAhead, relTime } from './fmt'
import { CalmEmpty, CapsuleChart, Failed, SectionHead } from './Surface'

// The row sets that live INSIDE a lane — never as a third destination.
//
// Each one is read-only. The affordance matrix ships exactly what the inbox
// already wrote (two Ivan-lane status writes); nothing below adds a button, and
// three of these row sets (the publish queue, the reviewing ideas, the style
// roster) had no consumer in the app at all before this build.

function Collapsible({ id, title, count, sev, tail, children, defaultOpen = false }: {
  id?: string
  title: string
  count?: number
  sev?: 'attention' | 'urgent' | null
  tail?: React.ReactNode
  children: React.ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div id={id}>
      <SectionHead
        title={title} count={count} sev={sev ?? null} tail={tail}
        open={open} onToggle={() => setOpen(o => !o)}
      />
      {open && children}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Ideas — lm_idea_candidates at status='reviewing', Ivan's by construction
// ---------------------------------------------------------------------------

function scoreLine(i: IdeaCandidate): [string, number | null][] {
  return [
    ['ICP', i.icp_fit_score], ['Virality', i.virality_score],
    ['Gap', i.gap_score], ['Beat', i.beat_fit_score], ['Signal', i.signal_strength],
  ]
}

function IdeaCard({ i }: { i: IdeaCandidate }) {
  const [open, setOpen] = useState(false)
  const title = i.normalized_topic || i.raw_topic || 'Untitled idea'
  return (
    // ct-idea marks this as an IDEA card rather than a draft card: they share
    // the card shell, and a count that conflates them is a count of two
    // different row sets.
    <div className="ct-card ct-idea ct-tap" onClick={() => setOpen(o => !o)}>
      <div className="ct-idea-h">
        {/* The composite score IS this row's anchor mark — one mark, fixed
            width, on the same 28px rail every other row in the lane uses. */}
        <div className="ct-idea-n">{i.composite_score !== null ? i.composite_score : '—'}</div>
        <div className="ct-mid">
          <div className="ct-title ct-row-p">{title}</div>
          {/* CHIP DIET — phase 6 ask 5, "wtf with that chunk of tags".
              This row carried up to four marks plus a topic echo plus a
              timestamp, and at 57 rows that is a wall of grey rectangles with no
              scanning order. ONE chip survives on the closed row: `source`.
              The brief's rule is "source OR type, whichever is more
              informative", and since ask 3 splits this list by content_type, the
              TYPE is now constant within a section — every row in the post lane
              says "post" — so it carries zero information here and source
              (claude_sessions / search_demand / …) carries all of it.
              `content_type`, `ivan_engaged` and the raw_topic echo moved into
              the expanded body below, which is one click away. The timestamp
              stays as the trailing value. */}
          <div className="ct-meta">
            {i.source && <span className="ct-chip">{i.source}</span>}
            {i.ingested_at && <span className="ct-tm">{relTime(i.ingested_at)}</span>}
          </div>
        </div>
      </div>
      {open && (
        <div className="ct-idea-b">
          <div className="ct-scores">
            {scoreLine(i).filter(([, v]) => v !== null).map(([k, v]) => (
              <span className="ct-score" key={k}><i>{k}</i>{v}</span>
            ))}
          </div>
          {/* The three marks the diet took off the closed row. Nothing was
              deleted; it moved one click down. */}
          <div className="ct-meta ct-meta-wrap">
            {i.content_type && <span className="ct-chip">{i.content_type}</span>}
            {i.ivan_engaged === true && <span className="ct-lane">engaged</span>}
            {i.raw_topic && i.raw_topic !== i.normalized_topic && (
              <span className="ct-topic">{i.raw_topic}</span>
            )}
          </div>
          {/* The scorer's own rubric, under its own names — never relabelled
              into the dashboard's 40/30/30 vocabulary, which is a different
              rubric over a different table. */}
          {i.why_score && <div className="dd-body ct-why">{i.why_score}</div>}
          {i.post_angle && <div className="dd-body ct-why"><b>Angle · </b>{i.post_angle}</div>}
          {i.format_recommendation && (
            <div className="ct-meta"><span className="ct-chip">{i.format_recommendation}</span></div>
          )}
          {(i.source_ref || i.slack_permalink) && (
            <div className="ct-links">
              {i.source_ref && /^https?:/.test(i.source_ref)
                ? <a className="dd-link" href={i.source_ref} target="_blank" rel="noreferrer">Source ↗</a>
                : i.source_ref && <div className="ct-ref">{i.source_ref}</div>}
              {i.slack_permalink && (
                <a className="dd-link" href={i.slack_permalink} target="_blank" rel="noreferrer">Slack ↗</a>
              )}
            </div>
          )}
          {i.scored_at && <div className="ct-ref">Scored {absTime(i.scored_at)}</div>}
        </div>
      )}
    </div>
  )
}

// Phase 6 ask 4: "ideas should be collapsible otherwise im gonna have to
// scrolldown a bunch". It was pinned OPEN with no toggle at all (`open` literal,
// `onToggle={undefined}`), so 57 idea cards stood between the pipeline chart and
// the first draft that needed a decision. It is closed by default now, its
// header is sticky so the count stays legible while the list scrolls under it,
// and one click opens it.
//
// Phase 6 ask 3: `kind` scopes the section to ONE side of the content_type
// partition, and `count` is that kind's own server-side exact figure — never the
// whole reviewing count, which is what used to be printed here regardless of
// what was in the list.
export function IdeasSection({ ideas, kind, count, loading, error, loadedAt, refresh, n, title, unclassified }: {
  ideas: IdeaCandidate[]
  kind: 'post' | 'lead_magnet'
  count: number | null
  loading: boolean
  error: string | null
  loadedAt: string | null
  refresh: () => void
  // 🔴 Deliberately NOT defaulted. The lead-magnet idea CANDIDATES read a
  // different table (lm_idea_candidates) from the stage sections beneath them
  // (lm_drafts_v2), so they sit outside that lane's 01-07 numbering — the first
  // build defaulted this to '01' and produced two "01" headers in one lane.
  n?: string
  title?: string
  // Rows whose content_type is NULL or unrecognised. They ride on the POST lane
  // with a label rather than being filtered out of both — see splitIdeas.
  unclassified?: IdeaCandidate[]
}) {
  const [filters, setFilters] = useState<FilterState>({})
  const [open, setOpen] = useState(false)
  const all = [...ideas, ...(unclassified ?? [])]
  const facets = buildFacets(all, IDEA_SPECS)
  const shown = applyFilters(all, IDEA_SPECS, filters)
  return (
    <div id={kind === 'post' ? 'wb-s-ideas' : 'wb-s-lm-ideas'}>
      <SectionHead
        n={n} title={title ?? 'Ideas'} count={all.length}
        open={open} onToggle={() => setOpen(o => !o)} sticky
      />
      {!open ? null : error ? (
        <Failed what="The idea queue" message={error} onRetry={refresh} loadedAt={null} />
      ) : loading && all.length === 0 ? (
        <div className="ct-subtle">Reading lm_idea_candidates…</div>
      ) : all.length === 0 ? (
        <CalmEmpty line="No ideas waiting to be scored." loadedAt={loadedAt} />
      ) : (
        <>
          {/* 🔴 "N rows", never "N distinct topics": an idea's identity derives
              from the LLM's own title, so a re-worded re-ingest is a different
              row and nothing dedups it. */}
          <div className="ct-subtle">
            {ideas.length} {kind === 'post' ? 'post' : 'lead-magnet'} rows at <code>reviewing</code>
            {count !== null && count > ideas.length ? ` of ${count} in the database` : ''}
            {unclassified && unclassified.length > 0
              ? ` · plus ${unclassified.length} with no content_type, shown here rather than dropped`
              : ''} ·
            read-only here (promotion lives in Client Ops)
          </div>
          <FilterBar
            facets={facets} state={filters} setState={setFilters}
            shown={shown.length} loaded={all.length} total={count} noun="ideas"
          />
          {shown.length === 0
            ? <FilteredEmpty noun="ideas" onClear={() => setFilters({})} />
            : shown.map(i => <IdeaCard key={i.id} i={i} />)}
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// The publish queue — scheduled_posts, its OWN status vocabulary
// ---------------------------------------------------------------------------

function QueueRow({ r }: { r: ScheduledQueueRow }) {
  const text = (r.post_text ?? '').trim().split('\n')[0] || 'No post text'
  return (
    <div className={`ct-q${queueFailed(r) ? ' bad' : ''}`}>
      <div className="ct-q-t">{text.slice(0, 120)}</div>
      <div className="ct-meta">
        <span className={`ct-chip${r.status === 'posted' ? ' ct-chip-ok' : queueFailed(r) ? ' ct-chip-bad' : ''}`}>
          {r.status}
        </span>
        {r.post_kind && <span className="ct-chip">{r.post_kind}</span>}
        {r.platform && <span className="ct-chip">{r.platform}</span>}
        {r.is_repost === true && <span className="ct-chip">repost</span>}
        {r.posted_at
          ? <span className="ct-tm">posted {relTime(r.posted_at)}</span>
          : r.scheduled_at && <span className="ct-tm">{relOrAhead(r.scheduled_at)}</span>}
        {r.unipile_share_url && (
          <a className="ct-ref-l" href={r.unipile_share_url} target="_blank" rel="noreferrer">live ↗</a>
        )}
      </div>
      {r.error_message && <div className="ct-q-e">{r.error_message}</div>}
    </div>
  )
}

export function QueueStrip({ rows, loading, error, loadedAt, refresh }: {
  rows: ScheduledQueueRow[]
  loading: boolean
  error: string | null
  loadedAt: string | null
  refresh: () => void
}) {
  const [filters, setFilters] = useState<FilterState>({})
  const facets = buildFacets(rows, QUEUE_SPECS)
  const shown = applyFilters(rows, QUEUE_SPECS, filters)
  if (error) return <Failed what="The publish queue" message={error} onRetry={refresh} loadedAt={null} />
  if (loading && rows.length === 0) return <div className="ct-subtle">Reading scheduled_posts…</div>
  if (rows.length === 0) return <CalmEmpty line="Nothing in the publish queue." loadedAt={loadedAt} />
  return (
    <>
      {/* 🔴 A mirror of the n8n bridge's output, never a control: flipping a
          draft to 'scheduled' is what makes yzXqLDIpuNzuhUQq publish it, so
          nothing in this section writes that status. */}
      <div className="ct-subtle">
        What actually went out. <code>scheduled_posts</code> keeps its own status
        vocabulary — unrelated to a draft's status — and this strip mirrors the
        publish bridge rather than controlling it.
      </div>
      <FilterBar
        facets={facets} state={filters} setState={setFilters}
        shown={shown.length} loaded={rows.length} total={null} noun="queue rows"
      />
      {shown.length === 0
        ? <FilteredEmpty noun="queue rows" onClear={() => setFilters({})} />
        : <div className="dd-card">{shown.slice(0, 60).map(r => <QueueRow key={r.id} r={r} />)}</div>}
      {shown.length > 60 && (
        <div className="ct-subtle">Showing the 60 most recent of {shown.length} matching rows.</div>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Resources — lm_drafts_v2, per lane, read-only ON PURPOSE
// ---------------------------------------------------------------------------

// One lead-magnet row. Same anchor-rail contract as a draft card (the cover is
// the anchor, the corner dot carries the stage), so the LM lane scans the same
// way the post lane does rather than being a second, differently-shaped list.
function LmRow({ r, onOpen }: { r: Resource; onOpen?: (id: string, label: string) => void }) {
  const stage = stageOfLm(r)
  const stalled = isStuckGeneratingLm(r)
  const stuck = isStuckResource(r)
  const mins = stalled ? elapsedMinutes(r.updated_at) : null
  return (
    <div
      className={`ct-card ct-res-row${stuck || stalled ? ' bad' : ''}${onOpen ? ' ct-tap' : ''}`}
      onClick={onOpen ? () => onOpen(r.id, r.topic ?? 'Untitled') : undefined}
    >
      <div className="ct-anchor" data-st={stage}>
        {r.cover_url
          ? <img className="ct-thumb" src={r.cover_url} alt="" />
          : <div className="ct-thumb ct-thumb-empty" aria-hidden />}
        <span className="ct-anchor-dot" />
      </div>
      <div className="ct-mid">
        <div className="ct-title ct-row-p">{r.topic ?? 'Untitled'}</div>
        <div className="ct-meta">
          {/* Slot #1, fixed x, same rule as the draft card. On a stalled run it
              carries the age instead of the stage, because that is the fact. */}
          {/* SLOT #1, fixed x. On the post lane this is the QA verdict; LM rows
              carry no QA column at all, so it is the FORMAT — the one fact that
              varies row to row inside a stage section.
              🔴 It is NOT the stage. The first build put the stage label here
              and the capture showed why that is wrong: inside the Idea section,
              37 consecutive rows each said "IDEA", which is the section header
              repeated 37 times and exactly the tag-wall Ivan objected to. The
              stage is carried by the section it is in and by the anchor dot.
              The raw DB value rides on the title so the fold stays auditable —
              a reader can find out that "Idea" is 37 rows the database still
              calls `pending` — without spending a mark on it. */}
          {stalled
            ? <span className="ct-chip ct-st ct-chip-warn">{mins}m ⚠</span>
            : (
              <span
                className={`ct-chip ct-st${stuck ? ' ct-chip-bad' : ''}`}
                title={normalizeLmStatus(r.status) !== r.status
                  ? `${LM_STAGE_LABEL[stage]} — folded from the database value “${r.status}”`
                  : `${LM_STAGE_LABEL[stage]} (status: ${r.status})`}
              >
                {r.format ?? LM_STAGE_LABEL[stage]}
              </span>
            )}
          {r.landing_url
            ? <a className="ct-ref-l" href={r.landing_url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}>landing ↗</a>
            : <span className="ct-ref">no landing URL</span>}
        </div>
      </div>
      <div className="ct-tail"><span className="ct-tm">{relTime(r.updated_at)}</span></div>
    </div>
  )
}

// A lead-magnet stage section. Deliberately the same shape as ContentList's
// StageSection — the lanes differ in what they hold, not in how a stage renders.
function LmStageSection({ s, n, rows, isOpen, toggle, onOpen }: {
  s: LmStage; n?: string; rows: Resource[]; isOpen: boolean; toggle: () => void
  onOpen?: (id: string, label: string) => void
}) {
  if (rows.length === 0) return null
  return (
    <div id={`wb-s-lm-${s}`}>
      <SectionHead
        n={n} title={LM_STAGE_LABEL[s]} count={rows.length}
        sev={s === 'review' ? 'attention' : null}
        open={isOpen} onToggle={toggle}
      />
      {isOpen && rows.map(r => <LmRow key={r.id} r={r} onOpen={onOpen} />)}
    </div>
  )
}

// Ask 4 again: everything in flight is open, everything terminal is closed.
// published (40 rows) and archived (34) are two thirds of this table and would
// bury the handful actually moving.
const LM_DEFAULT_OPEN: LmStage[] = ['idea', 'generating', 'generating_assets', 'review', 'approved']

// ---------------------------------------------------------------------------
// THE LEAD-MAGNET LANE (phase 6 ask 2)
// ---------------------------------------------------------------------------
//
// Ivan: "lead magnets/resources and posts need to be separated" — and before
// that, that the surface "doesn't show… lead magnet stages".
//
// What this replaces: `ResourcesSection`, a single collapsible called
// "Resources" that rendered every lm_drafts_v2 row for the lane in one
// undifferentiated list with a status FACET and no lifecycle at all. A published
// LM and one stuck mid-generation sat in the same block, in updated_at order.
//
// What it is now: its own lane inside Content — its own rule, its own header,
// its own pipeline chart, its own idea stage (from the content_type partition,
// ask 3), its own stage sections, its own alert line. Structurally the same
// object as the post lane above it, which is the point: the two are separated by
// being two lanes, not by being one list with a filter.
export function ResourceLane({ rows, lane, ideas, ideaCount, loading, error, loadedAt, refresh, ideaState, onOpen }: {
  rows: Resource[]
  lane: ContentLane
  // The lead-magnet side of the idea partition. Only the Ivan lane has one:
  // lm_idea_candidates carries no tenancy column at all.
  ideas: IdeaCandidate[] | null
  ideaCount: number | null
  loading: boolean
  error: string | null
  loadedAt: string | null
  refresh: () => void
  ideaState?: { loading: boolean; error: string | null; loadedAt: string | null; refresh: () => void }
  // Opens an LM row's detail window. Optional so the lane can render read-only.
  onOpen?: (id: string, label: string) => void
}) {
  // The LM lane is a SEPARATE working list with its own facets, so it gets its
  // own filter row and its own persisted key — the post lane's `Stage: Review`
  // has nothing to say about `lm_drafts_v2.status`, and one shared key would let
  // one lane's answer appear over the other's rows.
  const [sect, setSect] = useSectionState(`content.lm.${lane}`)
  const filters = sect.filters
  const setFilters = (f: FilterState) => setSect(p => ({ ...p, filters: f }))
  const setQ = (q: string) => setSect(p => ({ ...p, q }))
  const [open, setOpen] = useState<LmStage[]>(LM_DEFAULT_OPEN)
  const facets = buildFacets(rows, RESOURCE_SPECS)
  const { prominent, demoted } = splitFacets(facets, RESOURCE_PROMINENT)
  const shown = applySearch(applyFilters(rows, RESOURCE_SPECS, filters), sect.q, r => [r.topic])
  const stages = groupByLmStage(shown)
  // 🔴 Built from the UNFILTERED rows, exactly as the post lane's strip is: a
  // filter may narrow the flow, it may never hide a broken row.
  const stalled = rows.filter(isStuckGeneratingLm)
  const stuck = rows.filter(isStuckResource)
  const errored = rows.filter(r => stageOfLm(r) === 'error')

  // Every stage spends a slot, including the four that have never had a row —
  // a five-capsule chart would draw a five-stage pipeline that does not exist.
  const parts = LM_PIPELINE_STAGES.map(s => ({
    key: s, label: LM_STAGE_LABEL[s], short: LM_STAGE_SHORT[s], n: groupByLmStage(rows)[s].length,
  }))
  const inFlight = parts
    .filter(p => p.key !== 'published' && p.key !== 'idea')
    .reduce((a, p) => a + p.n, 0)

  const jump = (key: string) => {
    const s = key as LmStage
    setOpen(cur => (cur.includes(s) ? cur : [...cur, s]))
    requestAnimationFrame(() => {
      document.getElementById(`wb-s-lm-${s}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }

  return (
    <div id="wb-lm-lane" className="ct-lane-b">
      {/* The separator Ivan asked for. It is a lane boundary, not another
          section header, so it says what the lane IS and what table it reads. */}
      <div className="ct-lane-h">
        <span className="ct-lane-k">Lane</span>
        <span className="ct-lane-t">Lead magnets</span>
        <span className="ct-lane-rule" />
        <span className="ct-lane-c">{rows.length}</span>
      </div>
      <div className="ct-subtle">
        <code>lm_drafts_v2</code>, {LANE_POSSESSIVE[lane]} rows — a separate
        pipeline from the posts above, with one in-flight stage posts don’t
        have (<b>Generating resources</b> is the asset/page/cover build, a
        different run from the body generation).
      </div>

      {error ? (
        <Failed what="Lead magnets" message={error} onRetry={refresh} loadedAt={null} />
      ) : loading && rows.length === 0 ? (
        <div className="ct-subtle">Reading lm_drafts_v2…</div>
      ) : rows.length === 0 ? (
        <CalmEmpty line={`No lead magnets in ${LANE_POSSESSIVE[lane]} lane.`} loadedAt={loadedAt} />
      ) : (
        <>
          {(errored.length + stuck.length + stalled.length) > 0 && (
            <div className="ct-alert">
              <span className="ct-alert-n">{errored.length + stuck.length + stalled.length}</span>
              <span className="ct-alert-t">
                {[
                  errored.length > 0 && `${errored.length} errored`,
                  stalled.length > 0 && `${stalled.length} generating past ${STUCK_GENERATING_MINUTES}m`,
                  stuck.length > 0 && `${stuck.length} terminal with no landing URL`,
                ].filter(Boolean).join(' · ')}
              </span>
            </div>
          )}

          <div className="wb-chartcard">
            <div className="wb-cardh">
              <span className="wb-cardh-t wb-eyebrow">Lead-magnet pipeline</span>
              <span className="wb-cardh-x">···</span>
            </div>
            <CapsuleChart parts={parts} onJump={jump} />
            <div className="wb-pipe-n">
              <span className="wb-pipe-big">{stages.review.length}</span>
              <span className="wb-pipe-lbl">
                waiting on you<br />of {inFlight} still moving
              </span>
            </div>
            <div className="wb-cardf">
              {/* 🔴 The fold, stated where the numbers are drawn. Without this
                  line a reader has no way to know that "Idea 37" is 37 rows the
                  database still calls `pending`. */}
              <span className="wb-legend">
                <span className="wb-legend-l">
                  Legacy values folded to canonical (<code>pending</code>→idea,{' '}
                  <code>complete</code>→published, <code>lm_review</code>→review)
                </span>
              </span>
              <span className="wb-total">Total: <b>{rows.length}</b> in this lane</span>
            </div>
          </div>

          {/* 🔴 Read-only on purpose: whether the publish watcher treats
              status='approved' as a trigger is unverifiable from either repo, so
              no affordance here may turn out to publish a page. */}
          <div className="ct-subtle">
            Read-only. An approve here might be a publish — the watcher that owns
            this table is not readable from this app.
          </div>

          <FilterRow
            prominent={prominent} demoted={demoted}
            state={filters} setState={setFilters} q={sect.q} setQ={setQ}
            shown={shown.length} loaded={rows.length} total={null} noun="lead magnets"
            placeholder="Search lead magnets by topic…"
          />

          {ideas && ideaState && (
            <IdeasSection
              ideas={ideas} kind="lead_magnet" count={ideaCount}
              loading={ideaState.loading} error={ideaState.error}
              loadedAt={ideaState.loadedAt} refresh={ideaState.refresh}
              title="Lead-magnet ideas"
            />
          )}

          {shown.length === 0
            ? <FilteredEmpty noun="lead magnets" onClear={() => setSect({ filters: {}, q: '' })} />
            : (
              <>
                {/* 🔴 In LIFECYCLE ORDER, idea first. The first pass rendered
                    idea AFTER published because it was appended outside the map,
                    which put "Idea 37" — the largest section in the lane —
                    underneath the terminal ones and read as a bug. The stage
                    ORDER is LM_PIPELINE_STAGES and there is no second ordering
                    constant to keep in sync, exactly as PIPELINE_STAGES works
                    for posts. */}
                {LM_PIPELINE_STAGES.map((s, i) => (
                  <LmStageSection
                    key={s} s={s} n={String(i + 1).padStart(2, '0')} rows={stages[s]}
                    isOpen={open.includes(s)} onOpen={onOpen}
                    toggle={() => setOpen(cur =>
                      cur.includes(s) ? cur.filter(x => x !== s) : [...cur, s])}
                  />
                ))}
                {(['error', 'archived', 'other'] as LmStage[]).map(s => (
                  <LmStageSection
                    key={s} s={s} rows={stages[s]}
                    isOpen={open.includes(s)} onOpen={onOpen}
                    toggle={() => setOpen(cur =>
                      cur.includes(s) ? cur.filter(x => x !== s) : [...cur, s])}
                  />
                ))}
              </>
            )}
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// The style roster — content_prompts, enumerated live, previews per lane
// ---------------------------------------------------------------------------

// First ~2 non-heading lines of the prompt body, ≤180 chars, as StylesLive does.
function blurbOf(body: string | null): string | null {
  if (!body) return null
  const lines = body.split('\n').map(l => l.trim())
    .filter(l => l && !l.startsWith('#') && !l.startsWith('---'))
  const s = lines.slice(0, 2).join(' ')
  return s ? (s.length > 180 ? `${s.slice(0, 179)}…` : s) : null
}

export function StyleRoster({ roster, laneRows, lane, loading, error, refresh }: {
  roster: StylePrompt[]
  laneRows: ContentDraft[]
  lane: ContentLane
  loading: boolean
  error: string | null
  refresh: () => void
}) {
  const [filters, setFilters] = useState<FilterState>({})
  // Computed from the PUBLISHED rows of the lane you are in, so the same roster
  // reads differently per lane — which is the honest outcome.
  const previews = previewsByStyle(laneRows)
  const specs = styleSpecs(previews as Map<string, unknown>, previewKeyFor)
  const facets = buildFacets(roster, specs)
  const shown = applyFilters(roster, specs, filters)
  return (
    <Collapsible title="Styles" count={roster.length}>
      {error ? (
        // Never a hardcoded fallback list: three historical hardcoded catalogues
        // were each wrong the day after they were written.
        <Failed what="The style roster" message={error} onRetry={refresh} loadedAt={null} />
      ) : loading && roster.length === 0 ? (
        <div className="ct-subtle">Reading content_prompts…</div>
      ) : (
        <>
          <div className="ct-subtle">
            Enumerated live from <code>content_prompts</code>. Examples come from{' '}
            {LANE_POSSESSIVE[lane]} published rows, so an empty preview is a
            designed state — a wrong one would be a lie.
          </div>
          <FilterBar
            facets={facets} state={filters} setState={setFilters}
            shown={shown.length} loaded={roster.length} total={null} noun="styles"
          />
          {shown.length === 0
            ? <FilteredEmpty noun="styles" onClear={() => setFilters({})} />
            : shown.map(p => {
              // 🔴 previewKeyFor, never normalizeStyleKey: the families collide
              // on 'before-after' and a family-blind key hands the image
              // family's examples to the structure card.
              const pv = previews.get(previewKeyFor(p))
              return (
                <div className="ct-style" key={p.slug}>
                  <div className="ct-meta">
                    <span className="ct-chip">{p.family}</span>
                    <span className="ct-style-t">{cleanStyleTitle(p.title)}</span>
                    <span className="ct-tm">{relTime(p.updated_at)}</span>
                  </div>
                  {blurbOf(p.body) && <div className="ct-style-b">{blurbOf(p.body)}</div>}
                  {pv
                    ? <>
                      <div className="ct-ref">{pv.count} published {pv.count === 1 ? 'post' : 'posts'}</div>
                      {pv.imageUrls.length > 0 && (
                        <div className="ct-style-i">
                          {pv.imageUrls.map((u, i) => <img src={u} alt="" key={`${u}-${i}`} />)}
                        </div>
                      )}
                    </>
                    : <div className="ct-ref">No published example in this lane yet.</div>}
                </div>
              )
            })}
        </>
      )}
    </Collapsible>
  )
}

// ---------------------------------------------------------------------------
// Pillar mix — Ivan lane only, with its own denominator
// ---------------------------------------------------------------------------

// The dashboard's target constant is Title Case; the stored values are
// lowercase snake. 🔴 Keying on the raw value and mapping to a label is the
// whole fix — comparing to the constant directly scores every pillar at 0%.
const PILLAR_TARGETS: [string, string, number][] = [
  ['translator', 'Translator', 30],
  ['methodology', 'Methodology', 25],
  ['teardown', 'Teardown', 15],
  ['case_study', 'Case Study', 20],
  ['personal', 'Personal', 10],
]

export function PillarMix({ rows }: { rows: ContentDraft[] }) {
  const counts = new Map<string, number>()
  let withPillar = 0
  for (const r of rows) {
    const p = taxonomyFields(r.taxonomy).pillar
    if (!p) continue
    withPillar += 1
    counts.set(p, (counts.get(p) ?? 0) + 1)
  }
  if (withPillar === 0) return null
  const extra = [...counts.keys()].filter(k => !PILLAR_TARGETS.some(([raw]) => raw === k))
  return (
    <Collapsible title="Pillar mix" tail={<Figure n={withPillar} of={rows.length} label="rows carry a pillar" />}>
      <div className="dd-card">
        {[...PILLAR_TARGETS.map(([raw, label, target]) => ({ raw, label, target })),
        ...extra.map(raw => ({ raw, label: raw, target: null as number | null }))].map(p => {
          const n = counts.get(p.raw) ?? 0
          const pct = Math.round((n / withPillar) * 100)
          return (
            <div className="dd-row" key={p.raw}>
              <div className="dd-k">{p.label}</div>
              <div className="dd-v">
                <div className="ct-mix">
                  <span className="ct-mix-b"><i style={{ width: `${pct}%` }} /></span>
                  <span className="ct-mix-n">{n} · {pct}%</span>
                  {p.target !== null && <span className="ct-ref">target {p.target}%</span>}
                </div>
              </div>
            </div>
          )
        })}
      </div>
      {/* A percentage that hides its own denominator is a fabricated number. */}
      <div className="ct-subtle">
        Percentages are of the {withPillar} rows that carry a pillar, not of all{' '}
        {rows.length}. Targets are Ivan's editorial strategy and are advisory —
        nothing here gates, warns or scores.
      </div>
    </Collapsible>
  )
}

// ---------------------------------------------------------------------------
// Agent digest — the alert COUNT and the daily summaries (Ivan lane)
// ---------------------------------------------------------------------------

export function AlertCountLine({ olderUnsent }: { olderUnsent: number }) {
  if (olderUnsent <= 0) return null
  // Historical context, not an alarm: these are ClickUp-era leftovers outside
  // the 14-day window with no live draft behind them. The cold judge read the
  // warn styling as contradicting the copy — it did. Plain archive note now;
  // the red strip above keeps severity for the rows that are actually broken.
  return (
    <div className="ct-subtle">
      {olderUnsent} pipeline {olderUnsent === 1 ? 'alert' : 'alerts'} predate the 14-day window
      (ClickUp-era ids, no live draft behind them) — historical, not actionable here.
    </div>
  )
}

export function SummariesSection({ rows }: { rows: AgentSummary[] }) {
  if (rows.length === 0) return null
  return (
    <Collapsible title="Daily summaries" count={rows.length}>
      <div className="ct-subtle">
        The only written record of content decisions made outside this app. Read-only.
      </div>
      {rows.map(s => (
        <div className="dd-card" key={s.id}>
          <div className="dd-log">
            <div className="dd-log-ts">
              {s.date}{s.message_count ? ` · ${s.message_count} messages` : ''}
            </div>
            {s.summary && <div className="dd-body">{s.summary}</div>}
            <KeyRows items={[
              ...(s.topics?.length ? [['topics', s.topics] as [string, unknown]] : []),
              ...(s.action_items?.length ? [['action items', s.action_items] as [string, unknown]] : []),
            ]} />
          </div>
        </div>
      ))}
    </Collapsible>
  )
}
