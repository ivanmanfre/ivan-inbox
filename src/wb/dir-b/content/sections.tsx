import { useState } from 'react'
import {
  decideIdea, deleteIdea, ideaDecidable, IDEA_NOT_OURS,
  LANE_LABEL, LANE_POSSESSIVE, STUCK_GENERATING_MINUTES,
  taxonomyFields, queueFailed, unpublishPost,
  type ContentDraft, type ContentLane, type IdeaCandidate, type IdeaDecision,
  type ScheduledQueueRow,
} from '../../../lib/content'
import { useConfirm } from '../../../components/ConfirmSheet'
import {
  decideClientIdea, ideaWhy, quoteLabel, sourceHues,
  type ClientIdea, type ClientIdeaDecision,
} from '../../../lib/clientIdeas'
import {
  applyFilters, buildFacets, CLIENT_IDEA_SPECS, IDEA_PROMINENT, IDEA_SPECS,
  QUEUE_PROMINENT, QUEUE_SPECS, splitFacets,
  type FilterState,
} from '../../../lib/contentFilters'
import { withoutDecided } from '../../../exp/v2c/contentIdeas'
import { FilterRow } from '../../../exp/v2c/FilterRow'
import { absTime, relOrAhead, relTime, sourceLabel } from '../../../exp/v2c/fmt'
import { label } from '../../../lib/labels'
import { AnimatePresence, motion } from 'motion/react'
import {
  Badge, Button, Card, Chip, Icon, IconButton, Input, cx,
  fade, list, rise, spring,
} from '../../../ds'
import { Block } from '../shell'
import { CalmEmpty, Failed, FilteredEmpty, Figure } from './bits'
import './content.css'

// Direction B — the row sets that live INSIDE a lane. Copied from
// `src/exp/v2c/ContentSections.tsx` (post-lane parts only: IdeasSection,
// ClientIdeasSection, InFlight, QueueStrip, PillarMix). Every hook, every write,
// every guard and every string is the one that shipped; the JSX is rebuilt on
// `src/ds`, so a row is a Card, a mark is a Chip and a count is a Badge.

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
  // deleteIdea() attempts the hard DELETE with representation and falls back to
  // status='archived', throwing honestly if neither write landed. All clicks
  // inside stopPropagation: the card's own onClick is the expand toggle.
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  // Approve / Reject through the same endpoint, with the same optional note.
  // NEITHER GETS A CONFIRM SHEET: both decisions are reversible AT THE SAME
  // ENDPOINT, and this band exists to be triaged. Delete keeps its confirm
  // because delete is the one act nothing undoes.
  const [note, setNote] = useState('')
  const [deciding, setDeciding] = useState<IdeaDecision | null>(null)
  const decidable = ideaDecidable(i)
  const title = i.normalized_topic || i.raw_topic || 'Untitled idea'
  // source_ref is a LINK on some sources and the source row's own ULID on
  // others. A ULID under a "TEXT" chip is a fact about our storage, not about
  // the idea, so only the link shape is drawn.
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
    <motion.div variants={rise} className="dirb-lift" layout transition={spring}>
      <Card
        className="dirb-idea dirb-tap"
        onClick={() => setOpen(o => !o)}
        // The composite score IS this row's anchor mark — one mark, fixed width,
        // on the same rail every other row in the lane uses.
        lead={<span className="dirb-scoremark ds-t-figure">{i.composite_score !== null ? i.composite_score : '—'}</span>}
        title={title}
        sub={
          // CHIP DIET. ONE chip survives on the closed row: `source`. Since the
          // list is split by content_type the TYPE is constant within a section,
          // so source carries all the information.
          i.source ? <Chip tone="quiet">{sourceLabel(i.source)}</Chip> : null
        }
        tail={i.ingested_at ? <span className="ds-t-meta dirb-dim">{relTime(i.ingested_at)}</span> : undefined}
      >
        <AnimatePresence initial={false}>
          {open && (
            <motion.div
              key="body" className="dirb-col" variants={fade} initial="hidden" animate="show" exit="exit"
            >
              <div className="dirb-row-wrap">
                {scoreLine(i).filter(([, v]) => v !== null).map(([k, v]) => (
                  <Chip key={k} tone="quiet"><span className="dirb-dim">{k}</span>{v}</Chip>
                ))}
              </div>
              {/* The three marks the diet took off the closed row. Nothing was
                  deleted; it moved one click down. */}
              <div className="dirb-row-wrap">
                {i.content_type && <Chip>{label(i.content_type)}</Chip>}
                {i.ivan_engaged === true && <Chip tone="accent">engaged</Chip>}
                {i.raw_topic && i.raw_topic !== i.normalized_topic && (
                  <span className="ds-t-meta dirb-dim">{i.raw_topic}</span>
                )}
              </div>
              {/* The scorer's own rubric, under its own names. */}
              {i.why_score && <div className="ds-t-body dirb-quiet">{i.why_score}</div>}
              {i.post_angle && <div className="ds-t-body dirb-quiet"><b>Angle · </b>{i.post_angle}</div>}
              {i.format_recommendation && (
                <div className="dirb-row-wrap"><Chip>{i.format_recommendation}</Chip></div>
              )}
              {(sourceUrl || i.slack_permalink) && (
                <div className="dirb-row-wrap">
                  {sourceUrl && (
                    <a className="dirb-link" href={sourceUrl} target="_blank" rel="noreferrer">
                      Source <Icon name="external" size={16} />
                    </a>
                  )}
                  {i.slack_permalink && (
                    <a className="dirb-link" href={i.slack_permalink} target="_blank" rel="noreferrer">
                      Slack <Icon name="external" size={16} />
                    </a>
                  )}
                </div>
              )}
              {i.scored_at && <div className="ds-t-meta dirb-dim">Scored {absTime(i.scored_at)}</div>}
              <div className="dirb-inset dirb-col" onClick={e => e.stopPropagation()}>
                {err && <div className="dirb-err">{err}</div>}
                {decidable ? (
                  <div className="dirb-col">
                    <Input
                      label="Note" labelHidden type="text" value={note}
                      onChange={e => setNote(e.target.value)}
                      placeholder="Optional note — steers the curator, and is logged as the reject reason"
                      disabled={!!deciding}
                    />
                    <div className="dirb-row-wrap">
                      <Button variant="outline" disabled={busy || !!deciding} onClick={() => runDecide('reject')}>
                        {deciding === 'reject' ? 'Rejecting…' : 'Reject'}
                      </Button>
                      <Button variant="primary" busy={deciding === 'approve'} disabled={busy || !!deciding} onClick={() => runDecide('approve')}>
                        {deciding === 'approve' ? 'Approving…' : 'Approve'}
                      </Button>
                    </div>
                    {/* Both consequences named, because neither is obvious from
                        the verb: approve does not just mark a row, it fires the
                        promote run that writes the draft. */}
                    <div className="ds-t-meta dirb-dim">
                      Approve fires the curator's promote run and the draft appears in
                      Generating · Reject archives the idea. Both are reversible at the
                      same endpoint.
                    </div>
                  </div>
                ) : (
                  // The guard, stated rather than a greyed button: this row
                  // carries a workspace/campaign scope, and the decide endpoint
                  // has no client check of its own to fall back on.
                  <div className="ds-t-meta dirb-dim">{IDEA_NOT_OURS}</div>
                )}
                {confirming ? (
                  <div className="dirb-row-wrap">
                    <span className="ds-t-meta">Delete this idea? This removes it permanently.</span>
                    <Button variant="outline" disabled={busy} onClick={() => setConfirming(false)}>Cancel</Button>
                    <Button variant="danger" busy={busy} disabled={busy} onClick={runDelete}>
                      {busy ? 'Deleting…' : 'Delete'}
                    </Button>
                  </div>
                ) : (
                  // 🔴 Shut while a decision is in flight. Approve fires the
                  // curator's promote run and only THEN stamps the row; deleting
                  // the candidate underneath that run leaves a promoted draft
                  // whose idea no longer exists, and nothing reconciles the two.
                  <Button variant="quiet" disabled={!!deciding} onClick={() => setConfirming(true)}>
                    Delete idea
                  </Button>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </Card>
    </motion.div>
  )
}

export function IdeasSection({
  ideas, kind, count, loading, error, loadedAt, refresh, title, unclassified,
  hiddenByFilter, isOpen, onToggle,
}: {
  ideas: IdeaCandidate[]
  kind: 'post' | 'lead_magnet'
  count: number | null
  loading: boolean
  error: string | null
  loadedAt: string | null
  refresh: () => void
  n?: string
  title?: string
  // Rows whose content_type is NULL or unrecognised. They ride on the POST lane
  // with a label rather than being filtered out of both.
  unclassified?: IdeaCandidate[]
  // A DRAFT facet or the draft search box is set. These rows are
  // lm_idea_candidates — a different table from the drafts those controls run
  // over — so no facet can ever narrow them.
  hiddenByFilter?: boolean
  isOpen?: boolean
  onToggle?: () => void
}) {
  const [filters, setFilters] = useState<FilterState>({})
  // Open by default. A caller that can persist the flag passes it in; this local
  // state is the fallback.
  const [localOpen, setLocalOpen] = useState(true)
  const open = isOpen ?? localOpen
  const toggle = onToggle ?? (() => setLocalOpen(o => !o))
  // Rows decided in this session leave the band on the click, not on the
  // refetch. Every count below reads the same filtered arrays, so the header
  // never disagrees with the rows under it.
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
      <Block
        label={
          <span className="dirb-row">
            <span className="dirb-stagedot" data-st="ideas" aria-hidden />
            {title ?? 'Ideas'}
          </span>
        }
        tail={
          <span className="dirb-row">
            <Badge variant="ring">{all.length}</Badge>
            <IconButton
              icon={open ? 'discloseUp' : 'disclose'}
              label={open ? 'Collapse ideas' : 'Expand ideas'}
              size="sm" onClick={toggle}
            />
          </span>
        }
      >
        {!open ? null : hiddenByFilter ? (
          <div className="ds-t-meta dirb-dim">
            Hidden while a draft filter is on. These {all.length} rows are{' '}
            <code>lm_idea_candidates</code> — a different table from the drafts the
            facets and the search box run over, so no filter here can narrow them.
            Clear the filter to read them.
          </div>
        ) : error ? (
          <Failed what="The idea queue" message={error} onRetry={refresh} loadedAt={null} />
        ) : loading && all.length === 0 ? (
          <div className="ds-t-meta dirb-dim">Reading lm_idea_candidates…</div>
        ) : all.length === 0 ? (
          <CalmEmpty line="No ideas waiting to be scored." loadedAt={loadedAt} />
        ) : (
          <>
            {/* ONE BAND LINE, not three: the fact on the left, the control on the
                right, and the sentence keeps every clause it had. The filter
                STATE stays its own (these are lm_idea_candidates, a different
                table), so the disclosure carries its scope in its NAME. */}
            <div className="dirb-spread dirb-row-wrap">
              <div className="ds-t-meta dirb-dim dirb-grow">
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
              : (
                <motion.div className="dirb-cards" variants={list} initial="hidden" animate="show">
                  <AnimatePresence initial={false}>
                    {shown.map(i => (
                      <IdeaCard key={i.id} i={i} onDeleted={refresh} onDecided={markDecided} />
                    ))}
                  </AnimatePresence>
                </motion.div>
              )}
          </>
        )}
      </Block>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Ideas, CLIENT LANE — client_ideas at status='staged', per client_id
// ---------------------------------------------------------------------------
//
// Same shell as the card above on purpose. What is deliberately NOT copied over:
// no DELETE (there is no client-idea delete RPC) and no note field
// (`client_ideas` has no `archived_reason` column, so a note box would collect
// text and drop it).
function ClientIdeaCard({ i, lane, hue, onDecided }: {
  i: ClientIdea
  lane: ContentLane
  // Dealt by the section from the whole set on screen, never computed per row —
  // the separation guarantee is a property of the SET (sourceHues).
  hue: number | null
  onDecided: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [deciding, setDeciding] = useState<ClientIdeaDecision | null>(null)
  const [err, setErr] = useState('')
  const title = i.title || i.hook || 'Untitled idea'
  const why = ideaWhy(i.score_breakdown)
  const quote = quoteLabel(i)
  const sourceUrl = i.source_ref && /^https?:/.test(i.source_ref) ? i.source_ref : null
  const run = async (decision: ClientIdeaDecision) => {
    setDeciding(decision)
    setErr('')
    try {
      await decideClientIdea(i.id, decision)
      onDecided(i.id)
    } catch (e) {
      setErr(e instanceof Error ? e.message : `Could not ${decision === 'approved' ? 'approve' : 'reject'}`)
      setDeciding(null)
    }
  }
  return (
    <motion.div variants={rise} className="dirb-lift" layout transition={spring}>
      <Card
        className="dirb-idea dirb-tap"
        onClick={() => setOpen(o => !o)}
        // The client-ICP score IS this row's anchor mark, on the same rail the
        // composite score takes on Ivan's. Same width, same column.
        lead={<span className="dirb-scoremark ds-t-figure">{i.icp_score !== null ? i.icp_score : '—'}</span>}
        title={title}
        sub={
          // ONE chip closed, and it is the SOURCE. It sits a tier below the
          // title, and the colour is DERIVED from the label rather than mapped:
          // the ingestors mint new source labels without asking.
          i.source_label ? (
            <span
              className="dirb-hue"
              style={hue !== null ? ({ '--src-h': hue } as React.CSSProperties) : undefined}
            >
              <Chip className="dirb-srcchip">{i.source_label}</Chip>
            </span>
          ) : null
        }
        tail={i.created_at ? <span className="ds-t-meta dirb-dim">{relTime(i.created_at)}</span> : undefined}
      >
        <AnimatePresence initial={false}>
          {open && (
            <motion.div key="body" className="dirb-col" variants={fade} initial="hidden" animate="show" exit="exit">
              {/* The hook is the SENTENCE the writer would open with, and the
                  title is the filed version of it. Shown only when they differ. */}
              {i.hook && i.hook !== title && <div className="ds-t-body dirb-quiet">{i.hook}</div>}
              <div className="dirb-row-wrap">
                {i.pillar && <Chip>{label(i.pillar)}</Chip>}
                {i.format && <Chip>{label(i.format)}</Chip>}
                {/* The funnel stage is decided HERE, not after generation: the
                    kickoff copies this exact value onto the draft and stamps
                    funnel_source='declared'. A row with none says so. */}
                <span title="Funnel stage, carried onto the draft as declared">
                  <Chip>{i.funnel_stage ? label(i.funnel_stage) : 'no funnel stage'}</Chip>
                </span>
              </div>
              {/* 🔴 THE LINE FROM THE CALL, named as one. `score_breakdown.why`
                  holds `evidence_quote`, copied verbatim from a single
                  transcript line, so it is drawn as a quote with the attribution
                  the ingestor's own voice tag supports and no more. Rows from
                  any other source keep the plain treatment — their `why` really
                  is a rationale, and calling it a quote is the one claim this
                  card must never get wrong. */}
              {why && (quote ? (
                <blockquote
                  className="dirb-quote"
                  style={hue !== null ? ({ '--src-h': hue } as React.CSSProperties) : undefined}
                >
                  <div>{why}</div>
                  <div className="ds-t-meta dirb-dim">{quote}</div>
                </blockquote>
              ) : (
                <div className="ds-t-body dirb-quiet">{why}</div>
              ))}
              {sourceUrl && (
                <div className="dirb-row-wrap">
                  <a className="dirb-link" href={sourceUrl} target="_blank" rel="noreferrer">
                    Source <Icon name="external" size={16} />
                  </a>
                </div>
              )}
              <div className="dirb-inset dirb-col" onClick={e => e.stopPropagation()}>
                {err && <div className="dirb-err">{err}</div>}
                <div className="dirb-row-wrap">
                  <Button variant="outline" disabled={!!deciding} onClick={() => run('rejected')}>
                    {deciding === 'rejected' ? 'Rejecting…' : 'Reject'}
                  </Button>
                  <Button variant="primary" busy={deciding === 'approved'} disabled={!!deciding} onClick={() => run('approved')}>
                    {deciding === 'approved' ? 'Approving…' : 'Approve'}
                  </Button>
                </div>
                {/* Both consequences named, and the boundary with them: nothing
                    here reaches the client. */}
                <div className="ds-t-meta dirb-dim">
                  Approve hands it to the generation run and the draft comes back at
                  Needs review, still internal · Reject files it and the curator
                  stops offering it. Neither one reaches {LANE_LABEL[lane]}.
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </Card>
    </motion.div>
  )
}

export function ClientIdeasSection({ ideas, lane, loading, error, loadedAt, refresh }: {
  ideas: ClientIdea[]
  lane: ContentLane
  loading: boolean
  error: string | null
  loadedAt: string | null
  refresh: () => void
}) {
  // Decided in this session leaves the list on the click: the RPC has already
  // moved the row out of `staged`, so the refetch behind it cannot bring it
  // back, and waiting for that round trip is a second of a row that is not there.
  const [decided, setDecided] = useState<ReadonlySet<string>>(() => new Set())
  const [filters, setFilters] = useState<FilterState>({})
  const markDecided = (id: string) => {
    setDecided(cur => new Set(cur).add(id))
    refresh()
  }
  const rows = ideas.filter(i => !decided.has(i.id))
  // THE SUBFILTER, built through the app's own facet mechanism rather than a
  // bespoke pill strip, so a facet is DERIVED from the rows currently loaded,
  // never from a hardcoded list.
  // 🔴 Dealt from the UNFILTERED rows, or the colour would be a fact about the
  // current filter rather than about the source.
  const hues = sourceHues(rows.map(i => i.source_label))
  const { prominent, demoted } = splitFacets(buildFacets(rows, CLIENT_IDEA_SPECS), ['source'])
  const shown = applyFilters(rows, CLIENT_IDEA_SPECS, filters)
  if (error) return <Failed what="The idea bank" message={error} onRetry={refresh} loadedAt={null} />
  if (loading && rows.length === 0) return <div className="ds-t-meta dirb-dim">Reading the idea bank…</div>
  if (rows.length === 0) {
    return <CalmEmpty line={`Nothing staged for ${LANE_POSSESSIVE[lane]} lane.`} loadedAt={loadedAt} />
  }
  return (
    <>
      <div className="dirb-spread dirb-row-wrap">
        <div className="ds-t-meta dirb-dim dirb-grow">
          {rows.length} staged, highest client-ICP first — open one to approve or reject it.
        </div>
        <FilterRow
          prominent={prominent} demoted={demoted}
          state={filters} setState={setFilters}
          shown={shown.length} loaded={rows.length} total={null} noun="ideas"
          inline idleCount={false} label="Idea filters"
        />
      </div>
      {shown.length === 0
        ? <FilteredEmpty noun="ideas" onClear={() => setFilters({})} />
        : (
          <motion.div className="dirb-cards" variants={list} initial="hidden" animate="show">
            <AnimatePresence initial={false}>
              {shown.map(i => (
                <ClientIdeaCard
                  key={i.id} i={i} lane={lane} onDecided={markDecided}
                  hue={i.source_label ? hues.get(i.source_label) ?? null : null}
                />
              ))}
            </AnimatePresence>
          </motion.div>
        )}
    </>
  )
}

// ---------------------------------------------------------------------------
// IN FLIGHT — the floating count, on every tab
// ---------------------------------------------------------------------------
//
// 🔴 BUILT FROM THE UNFILTERED ROWS: a filter may narrow the list, it may never
// hide work that is in flight. And it renders NOTHING at zero — a permanent
// "0 generating" is the shelf this surface has twice deleted.
export function InFlight({ n, stalled, onOpen }: {
  n: number
  // How many of them have been running past the stall threshold. The pill is
  // calm while a run is normal and says so when one is not.
  stalled: number
  onOpen: () => void
}) {
  return (
    <AnimatePresence>
      {n > 0 && (
        <motion.button
          key="inflight"
          type="button"
          className={cx('dirb-inflight', stalled > 0 && 'bad')}
          variants={rise} initial="hidden" animate="show" exit="exit"
          onClick={onOpen}
          title={stalled > 0
            ? `${stalled} of them have been running past ${STUCK_GENERATING_MINUTES}m — open Generating`
            : 'Open Generating'}
        >
          <Icon name="running" size={16} />
          <b>{n}</b>
          <span>{stalled > 0 ? `generating · ${stalled} stalled` : `generating`}</span>
        </motion.button>
      )}
    </AnimatePresence>
  )
}

// ---------------------------------------------------------------------------
// The publish queue — scheduled_posts, its OWN status vocabulary
// ---------------------------------------------------------------------------

function QueueRow({ r, refresh }: { r: ScheduledQueueRow; refresh: () => void }) {
  const text = (r.post_text ?? '').trim().split('\n')[0] || 'No post text'
  const confirm = useConfirm()
  const [pulling, setPulling] = useState(false)
  const [pullErr, setPullErr] = useState('')
  // Unpublish cannot trigger a send; the edge fn also refuses anything that is
  // not already 'posted'.
  async function onUnpublish() {
    const ok = await confirm({
      title: 'Take this post off LinkedIn?',
      message: 'Deletes it from your feed for everyone, likes and comments included. The row moves to cancelled here. This cannot be undone.',
      confirmText: 'Unpublish',
      danger: true,
    })
    if (!ok) return
    setPulling(true); setPullErr('')
    try { await unpublishPost(r.id); refresh() }
    catch (e) { setPullErr(e instanceof Error ? e.message : String(e)) }
    finally { setPulling(false) }
  }
  return (
    <motion.div variants={rise} className="dirb-lift" layout transition={spring}>
      <Card
        className={cx('dirb-qrow', queueFailed(r) && 'bad')}
        title={text.slice(0, 120)}
        tail={
          r.posted_at
            ? <span className="ds-t-meta dirb-dim">posted {relTime(r.posted_at)}</span>
            : r.scheduled_at ? <span className="ds-t-meta dirb-dim">{relOrAhead(r.scheduled_at)}</span> : undefined
        }
      >
        <div className="dirb-row-wrap">
          <Chip tone={r.status === 'posted' ? 'clear' : queueFailed(r) ? 'urgent' : 'neutral'}>
            {label(r.status)}
          </Chip>
          {r.post_kind && <Chip tone="quiet">{label(r.post_kind)}</Chip>}
          {r.platform && <Chip tone="quiet">{label(r.platform)}</Chip>}
          {r.is_repost === true && <Chip tone="quiet">repost</Chip>}
          {r.unipile_share_url && (
            <a className="dirb-link" href={r.unipile_share_url} target="_blank" rel="noreferrer">
              live <Icon name="external" size={16} />
            </a>
          )}
          {r.status === 'posted' && r.unipile_share_url && (
            <Button
              size="sm" variant="danger" disabled={pulling}
              onClick={pulling ? undefined : onUnpublish}
            >
              {pulling ? 'Removing…' : 'unpublish'}
            </Button>
          )}
        </div>
        {r.error_message && <div className="dirb-err">{r.error_message}</div>}
        {pullErr && <div className="dirb-err">{pullErr}</div>}
      </Card>
    </motion.div>
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
  if (loading && rows.length === 0) return <div className="ds-t-meta dirb-dim">Reading scheduled_posts…</div>
  if (rows.length === 0) return <CalmEmpty line="Nothing in the publish queue." loadedAt={loadedAt} />
  return (
    <Block label="Publish queue" tail={<Badge variant="ring">{rows.length}</Badge>}>
      {/* 🔴 A mirror of the n8n bridge's output, never a control: flipping a
          draft to 'scheduled' is what makes the bridge publish it, so nothing in
          this section writes that status. */}
      <FilterRow
        prominent={queueProminent} demoted={queueDemoted}
        state={filters} setState={setFilters}
        shown={shown.length} loaded={rows.length} total={null} noun="queue rows"
        inline
      />
      {shown.length === 0
        ? <FilteredEmpty noun="queue rows" onClear={() => setFilters({})} />
        : (
          <motion.div className="dirb-cards" variants={list} initial="hidden" animate="show">
            <AnimatePresence initial={false}>
              {shown.slice(0, 60).map(r => <QueueRow key={r.id} r={r} refresh={refresh} />)}
            </AnimatePresence>
          </motion.div>
        )}
      {shown.length > 60 && (
        <div className="ds-t-meta dirb-dim">Showing the 60 most recent of {shown.length} matching rows.</div>
      )}
    </Block>
  )
}

// ---------------------------------------------------------------------------
// Pillar mix — Ivan lane only, with its own denominator
// ---------------------------------------------------------------------------

// The dashboard's target constant is Title Case; the stored values are lowercase
// snake. 🔴 Keying on the raw value and mapping to a label is the whole fix —
// comparing to the constant directly scores every pillar at 0%.
const PILLAR_TARGETS: [string, string, number][] = [
  ['translator', 'Translator', 30],
  ['methodology', 'Methodology', 25],
  ['teardown', 'Teardown', 15],
  ['case_study', 'Case Study', 20],
  ['personal', 'Personal', 10],
]

export function PillarMix({ rows }: { rows: ContentDraft[] }) {
  const [open, setOpen] = useState(false)
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
    <Block
      label="Pillar mix"
      tail={
        <span className="dirb-row">
          <Figure n={withPillar} of={rows.length} label="rows carry a pillar" />
          <IconButton
            icon={open ? 'discloseUp' : 'disclose'}
            label={open ? 'Collapse pillar mix' : 'Expand pillar mix'}
            size="sm" onClick={() => setOpen(o => !o)}
          />
        </span>
      }
    >
      <AnimatePresence initial={false}>
        {open && (
          <motion.div key="mix" className="dirb-col" variants={fade} initial="hidden" animate="show" exit="exit">
            <div className="dirb-col">
              {[...PILLAR_TARGETS.map(([raw, lab, target]) => ({ raw, label: lab, target })),
              ...extra.map(raw => ({ raw, label: raw, target: null as number | null }))].map(p => {
                const n = counts.get(p.raw) ?? 0
                const pct = Math.round((n / withPillar) * 100)
                return (
                  <div className="dirb-spread dirb-mixrow" key={p.raw}>
                    <span className="ds-t-body dirb-mixk">{p.label}</span>
                    <span className="dirb-mast-bar dirb-mixbar" aria-hidden>
                      <span className="dirb-mast-seg" data-k="approve" style={{ width: `${pct}%` }} />
                    </span>
                    <span className="ds-t-meta dirb-mixn">{n} · {pct}%</span>
                    {p.target !== null && <span className="ds-t-meta dirb-dim">target {p.target}%</span>}
                  </div>
                )
              })}
            </div>
            {/* A percentage that hides its own denominator is a fabricated number. */}
            <div className="ds-t-meta dirb-dim">
              Percentages are of the {withPillar} rows that carry a pillar, not of all{' '}
              {rows.length}. Targets are Ivan's editorial strategy and are advisory —
              nothing here gates, warns or scores.
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Block>
  )
}
