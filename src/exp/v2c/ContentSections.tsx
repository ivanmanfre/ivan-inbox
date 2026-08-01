import { useState } from 'react'
import {
  LANE_POSSESSIVE, taxonomyFields, queueFailed,
  type ContentDraft, type ContentLane, type IdeaCandidate, type ScheduledQueueRow,
} from '../../lib/content'
import {
  cleanStyleTitle, isStuckResource, previewKeyFor, previewsByStyle,
  type Resource, type StylePrompt,
} from '../../lib/styles'
import {
  applyFilters, buildFacets, IDEA_SPECS, QUEUE_SPECS, RESOURCE_SPECS, styleSpecs,
  type FilterState,
} from '../../lib/contentFilters'
import type { AgentSummary } from '../../lib/agent'
import { FilterBar, FilteredEmpty, Figure, KeyRows } from './ContentBits'
import { absTime, relOrAhead, relTime } from './fmt'
import { CalmEmpty, Failed, SectionHead } from './Surface'

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
          {/* raw_topic rides IN the meta line rather than on a third line of its
              own: a third line put this row at an 80px content box against a
              40-60 band, and 59 idea rows is exactly where the band matters. */}
          <div className="ct-meta">
            {i.source && <span className="ct-chip">{i.source}</span>}
            {i.content_type && <span className="ct-chip">{i.content_type}</span>}
            {i.ivan_engaged === true && <span className="ct-lane">engaged</span>}
            {i.raw_topic && i.raw_topic !== i.normalized_topic && (
              <span className="ct-topic">{i.raw_topic}</span>
            )}
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

export function IdeasSection({ ideas, count, loading, error, loadedAt, refresh }: {
  ideas: IdeaCandidate[]
  count: number | null
  loading: boolean
  error: string | null
  loadedAt: string | null
  refresh: () => void
}) {
  const [filters, setFilters] = useState<FilterState>({})
  const facets = buildFacets(ideas, IDEA_SPECS)
  const shown = applyFilters(ideas, IDEA_SPECS, filters)
  return (
    <div id="wb-s-ideas">
      <SectionHead n="01" title="Ideas" count={ideas.length} open onToggle={undefined} />
      {error ? (
        <Failed what="The idea queue" message={error} onRetry={refresh} loadedAt={null} />
      ) : loading && ideas.length === 0 ? (
        <div className="ct-subtle">Reading lm_idea_candidates…</div>
      ) : ideas.length === 0 ? (
        <CalmEmpty line="No ideas waiting to be scored." loadedAt={loadedAt} />
      ) : (
        <>
          {/* 🔴 "N rows", never "N distinct topics": an idea's identity derives
              from the LLM's own title, so a re-worded re-ingest is a different
              row and nothing dedups it. */}
          <div className="ct-subtle">
            {ideas.length} rows at <code>reviewing</code>
            {count !== null && count > ideas.length ? ` of ${count} in the database` : ''} ·
            read-only here (promotion lives in Client Ops)
          </div>
          <FilterBar
            facets={facets} state={filters} setState={setFilters}
            shown={shown.length} loaded={ideas.length} total={count} noun="ideas"
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

export function ResourcesSection({ rows, lane, loading, error, loadedAt, refresh }: {
  rows: Resource[]
  lane: ContentLane
  loading: boolean
  error: string | null
  loadedAt: string | null
  refresh: () => void
}) {
  const [filters, setFilters] = useState<FilterState>({})
  const facets = buildFacets(rows, RESOURCE_SPECS)
  const shown = applyFilters(rows, RESOURCE_SPECS, filters)
  return (
    <Collapsible title="Resources" count={rows.length} defaultOpen={rows.length <= 8}>
      {error ? (
        <Failed what="Resources" message={error} onRetry={refresh} loadedAt={null} />
      ) : loading && rows.length === 0 ? (
        <div className="ct-subtle">Reading lm_drafts_v2…</div>
      ) : rows.length === 0 ? (
        <CalmEmpty line={`No lead magnets in ${LANE_POSSESSIVE[lane]} lane.`} loadedAt={loadedAt} />
      ) : (
        <>
          {/* 🔴 Read-only on purpose: whether the publish watcher treats
              status='approved' as a trigger is unverifiable from either repo, so
              no affordance here may turn out to publish a page. */}
          <div className="ct-subtle">
            Read-only. An approve here might be a publish — the watcher that owns
            this table is not readable from this app.
          </div>
          <FilterBar
            facets={facets} state={filters} setState={setFilters}
            shown={shown.length} loaded={rows.length} total={null} noun="resources"
          />
          {shown.length === 0
            ? <FilteredEmpty noun="resources" onClear={() => setFilters({})} />
            : shown.map(r => (
              <div className={`ct-res${isStuckResource(r) ? ' bad' : ''}`} key={r.id}>
                {r.cover_url && <img className="ct-res-c" src={r.cover_url} alt="" />}
                <div className="ct-mid">
                  <div className="ct-res-t">{r.topic ?? 'Untitled'}</div>
                  <div className="ct-meta">
                    <span className={`ct-chip${isStuckResource(r) ? ' ct-chip-bad' : ''}`}>{r.status}</span>
                    {r.format && <span className="ct-chip">{r.format}</span>}
                    <span className="ct-tm">{relTime(r.updated_at)}</span>
                    {r.resource_url && (
                      <a className="ct-ref-l" href={r.resource_url} target="_blank" rel="noreferrer">asset ↗</a>
                    )}
                    {r.landing_url
                      ? <a className="ct-ref-l" href={r.landing_url} target="_blank" rel="noreferrer">landing ↗</a>
                      : <span className="ct-ref">no landing URL</span>}
                  </div>
                </div>
              </div>
            ))}
        </>
      )}
    </Collapsible>
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
  return (
    <div className="ct-subtle ct-warn">
      {olderUnsent} unacknowledged pipeline {olderUnsent === 1 ? 'alert' : 'alerts'}, all older
      than the 14-day window. Their task ids are ClickUp-era, so no draft link exists
      and none is faked — and nothing here acknowledges them.
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
