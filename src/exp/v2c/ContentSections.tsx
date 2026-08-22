import { useState } from 'react'
import {
  decideIdea, deleteIdea, elapsedMinutes, ideaDecidable, IDEA_NOT_OURS,
  LANE_POSSESSIVE, STUCK_GENERATING_MINUTES,
  taxonomyFields, queueFailed,
  type ContentDraft, type ContentLane, type IdeaCandidate, type IdeaDecision,
  type ScheduledQueueRow,
} from '../../lib/content'
import {
  cleanStyleTitle, groupByLmStage, isStuckGeneratingLm, isStuckResource,
  LM_PIPELINE_STAGES, LM_STAGE_LABEL, normalizeLmStatus, previewKeyFor, previewsByStyle,
  stageOfLm,
  type LmStage, type Resource, type StylePrompt,
} from '../../lib/styles'
import {
  applyFilters, applySearch, buildFacets, IDEA_PROMINENT, IDEA_SPECS, QUEUE_PROMINENT,
  QUEUE_SPECS, RESOURCE_SPECS, RESOURCE_PROMINENT, STYLE_PROMINENT, splitFacets, styleSpecs,
  type FilterState,
} from '../../lib/contentFilters'
import { useSectionState } from '../../hooks/useSectionState'
import { withoutDecided } from './contentIdeas'
import type { AgentSummary } from '../../lib/agent'
import { FilteredEmpty, Figure, KeyRows } from './ContentBits'
import { FilterRow } from './FilterRow'
import { RowSelect } from './RowSelect'
import { absTime, relOrAhead, relTime, sourceLabel } from './fmt'
import { CalmEmpty, Failed, SectionHead, StageTabs } from './Surface'
import { label } from '../../lib/labels'

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

function IdeaCard({ i, onDeleted, onDecided }: {
  i: IdeaCandidate
  onDeleted: () => void
  // A decision LANDED. The caller drops the row on the spot and refetches
  // behind it (withoutDecided) — the row has left `reviewing` either way.
  onDecided: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  // Delete-with-confirm (usability-voice ask 3c, extended to idea rows).
  // deleteIdea() attempts the hard DELETE with representation and falls back
  // to status='archived' — a real value in this table — throwing honestly if
  // neither write landed. All clicks inside stopPropagation: the card's own
  // onClick is the expand toggle.
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  // Approve / Reject — the old board's two idea decisions (IdeaDetail.tsx:136-151),
  // through the same endpoint, with the same optional note ("steers the curator
  // / logs the reason", IdeaDetail.tsx:129-134 — reject writes it into
  // archived_reason).
  //
  // NEITHER GETS A CONFIRM SHEET, and that is the old board's shape, not
  // laziness: both decisions are reversible AT THE SAME ENDPOINT (`revert`
  // un-promotes, `rescue` un-archives), and this band exists to be triaged.
  // Delete keeps its confirm because delete is the one act nothing undoes.
  const [note, setNote] = useState('')
  const [deciding, setDeciding] = useState<IdeaDecision | null>(null)
  const decidable = ideaDecidable(i)
  const title = i.normalized_topic || i.raw_topic || 'Untitled idea'
  // source_ref is a LINK on some sources and the source row's own ULID on
  // others (claude_sessions, kyle_call). A ULID under a "TEXT" chip is a fact
  // about our storage, not about the idea, so only the link shape is drawn.
  const sourceUrl = i.source_ref && /^https?:/.test(i.source_ref) ? i.source_ref : null
  const runDelete = async () => {
    setBusy(true)
    setErr('')
    try {
      await deleteIdea(i.id)
      onDeleted()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not delete')
      setBusy(false)
    }
  }
  const runDecide = async (decision: IdeaDecision) => {
    setDeciding(decision)
    setErr('')
    try {
      await decideIdea(i, decision, note)
      onDecided(i.id)
    } catch (e) {
      setErr(e instanceof Error ? e.message : `Could not ${decision}`)
      setDeciding(null)
    }
  }
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
            {i.source && <span className="ct-chip">{sourceLabel(i.source)}</span>}
          </div>
        </div>
        {/* The timestamp rides in `.ct-tail`, OUTSIDE the meta flex, exactly as
            a draft row does (ContentList.tsx:204). `.ct-meta` carries a 14px
            trailing fade for chips that overflow it; the last child of that
            flex is always the thing the fade eats, which is how every idea row
            came to read "13d ag". The fade is right for chips and stays. */}
        {i.ingested_at && (
          <div className="ct-tail"><span className="ct-tm">{relTime(i.ingested_at)}</span></div>
        )}
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
            {i.content_type && <span className="ct-chip">{label(i.content_type)}</span>}
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
          {(sourceUrl || i.slack_permalink) && (
            <div className="ct-links">
              {sourceUrl && (
                <a className="dd-link" href={sourceUrl} target="_blank" rel="noreferrer">Source ↗</a>
              )}
              {i.slack_permalink && (
                <a className="dd-link" href={i.slack_permalink} target="_blank" rel="noreferrer">Slack ↗</a>
              )}
            </div>
          )}
          {i.scored_at && <div className="ct-ref">Scored {absTime(i.scored_at)}</div>}
          <div className="wb-delzone wb-delzone-idea" onClick={e => e.stopPropagation()}>
            {err && <div className="ops-err">{err}</div>}
            {decidable ? (
              <div className="ct-idea-decide">
                <input
                  className="ct-idea-note" type="text" value={note}
                  onChange={e => setNote(e.target.value)}
                  placeholder="Optional note — steers the curator, and is logged as the reject reason"
                  disabled={!!deciding}
                />
                <div className="ct-ac ct-ac-wide">
                  <button
                    type="button" className="btn s" disabled={busy || !!deciding}
                    onClick={() => runDecide('reject')}
                  >
                    {deciding === 'reject' ? 'Rejecting…' : 'Reject'}
                  </button>
                  <button
                    type="button" className="btn p" disabled={busy || !!deciding}
                    onClick={() => runDecide('approve')}
                  >
                    {deciding === 'approve' ? 'Approving…' : 'Approve'}
                  </button>
                </div>
                {/* Both consequences named, because neither is obvious from the
                    verb: approve does not just mark a row, it fires the promote
                    run that writes the draft. */}
                <div className="ct-ref">
                  Approve fires the curator's promote run and the draft appears in
                  Generating · Reject archives the idea. Both are reversible at the
                  same endpoint.
                </div>
              </div>
            ) : (
              // The guard, stated rather than a greyed button: this row carries a
              // workspace/campaign scope, and the decide endpoint has no client
              // check of its own to fall back on.
              <div className="ct-ref">{IDEA_NOT_OURS}</div>
            )}
            {confirming ? (
              <div className="wb-delconfirm">
                <span className="wb-delq">Delete this idea? This removes it permanently.</span>
                <div className="ct-ac">
                  <button type="button" className="btn s" disabled={busy} onClick={() => setConfirming(false)}>
                    Cancel
                  </button>
                  <button type="button" className="btn wb-btn-danger" disabled={busy} onClick={runDelete}>
                    {busy ? 'Deleting…' : 'Delete'}
                  </button>
                </div>
              </div>
            ) : (
              // 🔴 Shut while a decision is in flight. Approve fires the
              // curator's promote run and only THEN stamps the row; deleting
              // the candidate underneath that run leaves a promoted draft whose
              // idea no longer exists, and nothing reconciles the two.
              <button
                type="button" className="wb-delbtn" disabled={!!deciding}
                onClick={() => setConfirming(true)}
              >
                Delete idea
              </button>
            )}
          </div>
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
export function IdeasSection({
  ideas, kind, count, loading, error, loadedAt, refresh, n, title, unclassified,
  hiddenByFilter, isOpen, onToggle,
}: {
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
  // A DRAFT facet or the draft search box is set. These rows are
  // lm_idea_candidates — a different table from the drafts those controls run
  // over — so no facet can ever narrow them, and a band that cannot answer the
  // question being asked must not be the first thing under it. The header, the
  // count and the reason stay; the rows do not.
  hiddenByFilter?: boolean
  // Open/closed, owned by the caller when the caller has somewhere to persist
  // it. Both are optional so a lane with no store keeps the local flag.
  isOpen?: boolean
  onToggle?: () => void
}) {
  const [filters, setFilters] = useState<FilterState>({})
  // Open by default (Ivan, 2026-08-04: "LOOK HOW ANNOYING IS NOW TO OPEN
  // EVERYTHING" — dashboard-v2 shows the ideas table directly). The DEFAULT was
  // his ruling; the non-persistence never was, and it is what made the collapse
  // feel useless — every reload re-expanded 74 rows. A caller that can persist
  // the flag passes it in; this local state is the fallback.
  const [localOpen, setLocalOpen] = useState(true)
  const open = isOpen ?? localOpen
  const toggle = onToggle ?? (() => setLocalOpen(o => !o))
  // Rows decided in this session leave the band on the click, not on the
  // refetch — the rule and the reason it cannot poison a re-ingest are in
  // contentIdeas.ts (withoutDecided). Every count below reads the same filtered
  // arrays, so the header never disagrees with the rows under it.
  const [decided, setDecided] = useState<ReadonlySet<string>>(() => new Set())
  const markDecided = (id: string) => {
    setDecided(cur => new Set(cur).add(id))
    refresh()
  }
  const kindRows = withoutDecided(ideas, decided)
  const otherRows = withoutDecided(unclassified ?? [], decided)
  const all = [...kindRows, ...otherRows]
  const { prominent: ideaProminent, demoted: ideaDemoted } =
    splitFacets(buildFacets(all, IDEA_SPECS), IDEA_PROMINENT)
  const shown = applyFilters(all, IDEA_SPECS, filters)
  return (
    <div id={kind === 'post' ? 'wb-s-ideas' : 'wb-s-lm-ideas'}>
      <SectionHead
        n={n} title={title ?? 'Ideas'} count={all.length}
        open={open} onToggle={toggle} sticky
      />
      {!open ? null : hiddenByFilter ? (
        <div className="ct-subtle">
          Hidden while a draft filter is on. These {all.length} rows are{' '}
          <code>lm_idea_candidates</code> — a different table from the drafts the
          facets and the search box run over, so no filter here can narrow them.
          Clear the filter to read them.
        </div>
      ) : error ? (
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
          {/* The "read-only here (promotion lives in Client Ops)" line that used
              to close this sentence was TRUE ONLY WHILE THE BAND HAD NO DECIDE
              BUTTON, and it is the sentence Ivan was reading when he said "i
              cant even approve the ideas". Promotion never lived in Client Ops
              for these rows either — Client Ops is the CLIENT lane's gate, and
              lm_idea_candidates has no client lane. */}
          {/* ONE BAND LINE, not three.
              The provenance sentence and the filter row were two stacked
              blocks under a section head that already prints the count — 3
              lines of chrome on the phone above the first idea. They share a
              line now: the fact on the left, the control on the right, and the
              sentence keeps every clause it had (the `reviewing` stage, the
              database total when it exceeds the page, the no-content_type
              stragglers) because each of those is a thing that would be a
              silent omission.

              D9 — ONE FILTER SYSTEM. This band used to render `FilterBar`, a
              permanently-expanded chip browser over the same facet contract
              the drafts above it drive with pills: 238px of a second grammar
              stacked under the first at 390. The STATE stays its own (these
              are lm_idea_candidates, a different table, and no draft facet can
              narrow them), so the disclosure carries its scope in its NAME
              rather than pretending to be the strip's. */}
          <div className="ct-bandline">
            <div className="ct-subtle ct-bandline-t">
              {kindRows.length} {kind === 'post' ? 'post' : 'lead-magnet'} rows waiting for review
              {count !== null && count > kindRows.length ? ` of ${count} in the database` : ''}
              {otherRows.length > 0
                ? ` · plus ${otherRows.length} with no content_type, shown here rather than dropped`
                : ''} ·
              open one to approve or reject it
            </div>
            <FilterRow
              prominent={ideaProminent} demoted={ideaDemoted}
              state={filters} setState={setFilters}
              shown={shown.length} loaded={all.length} total={count} noun="ideas"
              inline idleCount={false} label="Idea filters"
            />
          </div>
          {shown.length === 0
            ? <FilteredEmpty noun="ideas" onClear={() => setFilters({})} />
            : shown.map(i => (
              <IdeaCard key={i.id} i={i} onDeleted={refresh} onDecided={markDecided} />
            ))}
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
          {label(r.status)}
        </span>
        {r.post_kind && <span className="ct-chip">{label(r.post_kind)}</span>}
        {r.platform && <span className="ct-chip">{label(r.platform)}</span>}
        {r.is_repost === true && <span className="ct-chip">repost</span>}
        {r.unipile_share_url && (
          <a className="ct-ref-l" href={r.unipile_share_url} target="_blank" rel="noreferrer">live ↗</a>
        )}
      </div>
      {/* Outside the meta flex and its 14px chip fade — same move as the idea
          row above, and for the same reason: this timestamp is the value, not
          the overflow. */}
      <div className="ct-tail">
        {r.posted_at
          ? <span className="ct-tm">posted {relTime(r.posted_at)}</span>
          : r.scheduled_at && <span className="ct-tm">{relOrAhead(r.scheduled_at)}</span>}
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
  const { prominent: queueProminent, demoted: queueDemoted } =
    splitFacets(buildFacets(rows, QUEUE_SPECS), QUEUE_PROMINENT)
  const shown = applyFilters(rows, QUEUE_SPECS, filters)
  if (error) return <Failed what="The publish queue" message={error} onRetry={refresh} loadedAt={null} />
  if (loading && rows.length === 0) return <div className="ct-subtle">Reading scheduled_posts…</div>
  if (rows.length === 0) return <CalmEmpty line="Nothing in the publish queue." loadedAt={loadedAt} />
  return (
    <>
      {/* 🔴 A mirror of the n8n bridge's output, never a control: flipping a
          draft to 'scheduled' is what makes yzXqLDIpuNzuhUQq publish it, so
          nothing in this section writes that status. That rule is a fact about
          the CODE and it stays here, where a future editor reads it.
          THE ON-SCREEN PARAGRAPH IS GONE (2026-08-20, Ivan: "delete this we
          dont need this extra text bothering"). It explained the table's
          provenance to a reader who has read it a hundred times, above the rows
          it was explaining, every single visit. The rows say what they are. */}
      <FilterRow
        prominent={queueProminent} demoted={queueDemoted}
        state={filters} setState={setFilters}
        shown={shown.length} loaded={rows.length} total={null} noun="queue rows"
        inline
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
// Same contract as the Content side: opening a row hands the window the SECTION
// it was opened from, so j/k and the rail walk what Ivan can see.
export type OpenMagnet = (id: string, label: string, queue: Resource[]) => void

function LmRow({ r, onOpen, queue }: { r: Resource; onOpen?: OpenMagnet; queue: Resource[] }) {
  const stage = stageOfLm(r)
  const stalled = isStuckGeneratingLm(r)
  const stuck = isStuckResource(r)
  const mins = stalled ? elapsedMinutes(r.updated_at) : null
  return (
    <div
      className={`ct-card ct-res-row${stuck || stalled ? ' bad' : ''}${onOpen ? ' ct-tap' : ''}`}
      onClick={onOpen ? () => onOpen(r.id, r.topic ?? 'Untitled', queue) : undefined}
    >
      <div className="ct-anchor" data-st={stage}>
        {/* The row's registration with the command layer: j/k walks it and x
            selects it. Inside the anchor, for the grid reason in RowSelect. A
            lead magnet has no bulk write of its own, so it declares no
            capabilities and the bar says so in words rather than offering a
            button that would refuse. */}
        <RowSelect id={r.id} kind="magnet" label={r.topic ?? 'Untitled'} caps={[]} />
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
// One LM stage's rows. No header and no chevron: the tab above it is both
// (2026-08-20, Ivan: "u can delete all of this and make horizontal the
// stages"). An empty stage says so rather than rendering nothing — on a tabbed
// surface, "nothing here" and "I clicked the wrong thing" look identical on a
// blank screen.
function LmStageTable({ s, rows, onOpen }: {
  s: LmStage; rows: Resource[]; onOpen?: OpenMagnet
}) {
  return (
    <div id={`wb-s-lm-${s}`}>
      {rows.length === 0
        ? <CalmEmpty line={`Nothing at ${LM_STAGE_LABEL[s].toLowerCase()}.`} loadedAt={null} />
        : rows.map(r => <LmRow key={r.id} r={r} onOpen={onOpen} queue={rows} />)}
    </div>
  )
}

// The tab order IS the lifecycle, idea first. The old sections had the same
// rule for a measured reason: the first pass appended idea AFTER published,
// which put the largest stage in the lane underneath the terminal ones and read
// as a bug. The three off-pipeline stages ride at the end and only when they
// have rows.
const LM_TAB_ORDER: LmStage[] = [...LM_PIPELINE_STAGES, 'error', 'archived', 'other']
const LM_TAB_ALWAYS: LmStage[] = [...LM_PIPELINE_STAGES]
const LM_TAB_KEY = (lane: ContentLane) => `wb-lm-tab-${lane}`

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
  onOpen?: OpenMagnet
}) {
  // The LM lane is a SEPARATE working list with its own facets, so it gets its
  // own filter row and its own persisted key — the post lane's `Stage: Review`
  // has nothing to say about `lm_drafts_v2.status`, and one shared key would let
  // one lane's answer appear over the other's rows.
  const [sect, setSect] = useSectionState(`content.lm.${lane}`)
  const filters = sect.filters
  const setFilters = (f: FilterState) => setSect(p => ({ ...p, filters: f }))
  const setQ = (q: string) => setSect(p => ({ ...p, q }))
  // One tab, persisted per lane — the same shape the post lane's bar uses.
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
  // 🔴 Built from the UNFILTERED rows, exactly as the post lane's strip is: a
  // filter may narrow the flow, it may never hide a broken row.
  const stalled = rows.filter(isStuckGeneratingLm)
  const errored = rows.filter(r => stageOfLm(r) === 'error')
  // ⚠ REMOVED FROM THE ALARM, 2026-08-03, Ivan: "delete this warning is normal
  // '1 errored · 34 terminal with no landing URL' bc we used not to have
  // landing." The early lead magnets predate landing pages, so a terminal row
  // with no landing URL is HISTORY, not a defect — 34 of them fired an alarm
  // nobody will ever clear, which is how a strip trains you to stop reading it.
  // `isStuckResource` still exists and still marks the individual row (:323),
  // where it is a property of that row rather than a claim on Ivan's day.
  // THE TEST an alert has to pass: it names something actionable TODAY.

  // THE PIPELINE CARD IS GONE (2026-08-20, Ivan: "u can delete all of this and
  // make horizontal the stages"). It drew a capsule per stage, a big
  // waiting-on-you numeral, a legend about folded legacy values and a lane
  // total — four chrome objects above the rows, all of them answering "how many
  // are at each stage", which is the ONE question the tab bar answers by
  // existing. `jump` went with it: a tab does not scroll, it selects.
  //
  // What the legend said is not lost, it is just no longer said four times: the
  // per-row title on a folded stage still reads "Idea — folded from the
  // database value 'pending'" (LmRow), which is where a reader meets the fold.

  return (
    <div id="wb-lm-lane" className="ct-lane-b">
      {/* THE LANE HEADER AND ITS BLURB ARE GONE (2026-08-20). Magnets is its
          own job in the rail — it has been since 08-03 — so a header naming the
          lane sat under a nav item naming the same lane, over a paragraph
          explaining which table it reads to the one person who built it. The
          tab bar carries the counts the header carried. */}
      {error ? (
        <Failed what="Lead magnets" message={error} onRetry={refresh} loadedAt={null} />
      ) : loading && rows.length === 0 ? (
        <div className="ct-subtle">Reading lm_drafts_v2…</div>
      ) : rows.length === 0 ? (
        <CalmEmpty line={`No lead magnets in ${LANE_POSSESSIVE[lane]} lane.`} loadedAt={loadedAt} />
      ) : (
        <>
          {(errored.length + stalled.length) > 0 && (
            <div className="ct-alert">
              <span className="ct-alert-n">{errored.length + stalled.length}</span>
              <span className="ct-alert-t">
                {[
                  errored.length > 0 && `${errored.length} errored`,
                  stalled.length > 0 && `${stalled.length} generating past ${STUCK_GENERATING_MINUTES}m`,
                ].filter(Boolean).join(' · ')}
              </span>
            </div>
          )}

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

          <StageTabs
            active={tab} onSelect={k => setTab(k as LmStage)}
            tabs={LM_TAB_ORDER
              .map(st => ({
                key: st,
                label: LM_STAGE_LABEL[st],
                // Counts over the FILTERED rows: the tab promises the number
                // you land on, so a filter that empties a stage empties its tab.
                n: stages[st].length,
                mark: st === 'review',
              }))
              .filter(t => LM_TAB_ALWAYS.includes(t.key) || t.n > 0)}
          />

          {shown.length === 0
            ? <FilteredEmpty noun="lead magnets" onClear={() => setSect(cur => ({ ...cur, filters: {}, q: '' }))} />
            : (
              <>
                <LmStageTable s={tab} rows={stages[tab]} onOpen={onOpen} />
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

// The inline markdown a prompt body is written in. STRIPPED, never rendered:
// this is a card blurb, not a document, and the shipped card printed
// "**Version 3.0 — 2026-07-10 Black Box rewrite…**" asterisks and all.
// 🔴 A lone `_` is deliberately left alone — these bodies are full of
// snake_case column names, and unpairing those would corrupt real values.
function stripMarkdown(line: string): string {
  return line.replace(/\*\*/g, '').replace(/__/g, '').replace(/`/g, '').trim()
}

// First ~2 non-heading lines of the prompt body, ≤180 chars, as StylesLive does.
// Heading and rule lines are still DROPPED whole (they are structure, not
// prose); the strip above only cleans what survives that filter.
function blurbOf(body: string | null): string | null {
  if (!body) return null
  const lines = body.split('\n').map(l => l.trim())
    .filter(l => l && !l.startsWith('#') && !l.startsWith('---'))
    .map(stripMarkdown)
    .filter(Boolean)
  const s = lines.slice(0, 2).join(' ')
  return s ? (s.length > 180 ? `${s.slice(0, 179)}…` : s) : null
}

// A Google Drive /file/…/view URL is a SHARE PAGE — HTML, not an image — so the
// browser blocks it (ERR_BLOCKED_BY_ORB) and the <img> draws the broken glyph.
// Six of the sixteen example thumbs on this surface were exactly that. The row
// is not repaired here (image_urls is written elsewhere); the thumb is dropped,
// because a broken glyph claims a published example that cannot be shown.
function drawableThumb(u: string): boolean {
  return !/^https?:\/\/(?:[a-z0-9-]+\.)*drive\.google\.com\/file\//i.test(u)
}

export function StyleRoster({ roster, laneRows, lane, loading, error, refresh, bare }: {
  roster: StylePrompt[]
  laneRows: ContentDraft[]
  lane: ContentLane
  loading: boolean
  error: string | null
  refresh: () => void
  // The Styles JOB renders this directly open, no Collapsible — it IS the
  // surface there (Ivan, 2026-08-04: "STYLES SHOULD BE A TAB").
  bare?: boolean
}) {
  const [filters, setFilters] = useState<FilterState>({})
  // Computed from the PUBLISHED rows of the lane you are in, so the same roster
  // reads differently per lane — which is the honest outcome.
  const previews = previewsByStyle(laneRows)
  const specs = styleSpecs(previews as Map<string, unknown>, previewKeyFor)
  const { prominent: styleProminent, demoted: styleDemoted } =
    splitFacets(buildFacets(roster, specs), STYLE_PROMINENT)
  const shown = applyFilters(roster, specs, filters)
  const body = (
    <>
      {error ? (
        // Never a hardcoded fallback list: three historical hardcoded catalogues
        // were each wrong the day after they were written.
        <Failed what="The style roster" message={error} onRetry={refresh} loadedAt={null} />
      ) : loading && roster.length === 0 ? (
        <div className="ct-subtle">Reading the style roster…</div>
      ) : (
        <>
          {/* Named the table here until 2026-08-22. `content_prompts` is where
              the roster lives, not a fact a reader of this screen has any use
              for, and a live scan of the rendered text found it as the last raw
              table name printed at the user anywhere in the workbench. The
              sentence keeps the claim it was making (this list is read fresh,
              nothing here is a hardcoded catalogue) and drops the storage
              detail. */}
          <div className="ct-subtle">
            Read fresh every time, never a fixed list. Examples come from{' '}
            {LANE_POSSESSIVE[lane]} published rows, so an empty preview is a
            designed state — a wrong one would be a lie.
          </div>
          <FilterRow
            prominent={styleProminent} demoted={styleDemoted}
            state={filters} setState={setFilters}
            shown={shown.length} loaded={roster.length} total={null} noun="styles"
            inline
          />
          {shown.length === 0
            ? <FilteredEmpty noun="styles" onClear={() => setFilters({})} />
            : shown.map(p => {
              // 🔴 previewKeyFor, never normalizeStyleKey: the families collide
              // on 'before-after' and a family-blind key hands the image
              // family's examples to the structure card.
              const pv = previews.get(previewKeyFor(p))
              const thumbs = pv ? pv.imageUrls.filter(drawableThumb) : []
              return (
                <div className="ct-style" key={p.slug}>
                  <div className="ct-meta">
                    <span className="ct-chip">{p.family}</span>
                    <span className="ct-style-t">{cleanStyleTitle(p.title)}</span>
                  </div>
                  {/* Out of the meta flex, same as the idea and queue rows: the
                      14px chip fade was eating "27d ago" on every style card. */}
                  <div className="ct-tail"><span className="ct-tm">{relTime(p.updated_at)}</span></div>
                  {blurbOf(p.body) && <div className="ct-style-b">{blurbOf(p.body)}</div>}
                  {pv
                    ? <>
                      <div className="ct-ref">{pv.count} published {pv.count === 1 ? 'post' : 'posts'}</div>
                      {thumbs.length > 0 && (
                        <div className="ct-style-i">
                          {/* Second guard, because the first one only knows the
                              shapes we have already met: anything else that
                              fails to decode removes ITSELF rather than leaving
                              a broken-image glyph in the strip. */}
                          {thumbs.map((u, i) => (
                            <img
                              src={u} alt="" key={`${u}-${i}`}
                              onError={e => { e.currentTarget.style.display = 'none' }}
                            />
                          ))}
                        </div>
                      )}
                    </>
                    : <div className="ct-ref">No published example in this lane yet.</div>}
                </div>
              )
            })}
        </>
      )}
    </>
  )
  if (bare) return body
  return <Collapsible title="Styles" count={roster.length}>{body}</Collapsible>
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

export function SummariesSection({ rows, defaultOpen }: { rows: AgentSummary[]; defaultOpen?: boolean }) {
  if (rows.length === 0) return null
  return (
    <Collapsible title="Daily summaries" count={rows.length} defaultOpen={defaultOpen}>
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
