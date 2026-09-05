/* ==========================================================================
   THE TWO IDEA BANKS.

   Copied from `src/exp/v2c/ContentSections.tsx` (IdeaCard / IdeasSection /
   ClientIdeaCard / ClientIdeasSection). Same shell for both on purpose: an
   idea is an idea whichever lane it belongs to, and the two differ in what
   they hold, not in how a row is read.

   What is deliberately NOT copied onto the client side stays uncopied: no
   delete (there is no client-idea delete call), and no note field (the client
   table has no column for one, so a box here would collect text and drop it).
   ========================================================================== */
import { useState } from 'react'
import {
  decideIdea, deleteIdea, ideaDecidable, IDEA_NOT_OURS, LANE_LABEL, LANE_POSSESSIVE,
  type ContentLane, type IdeaCandidate, type IdeaDecision,
} from '../../../lib/content'
import {
  decideClientIdea, ideaWhy, quoteLabel,
  type ClientIdea, type ClientIdeaDecision,
} from '../../../lib/clientIdeas'
import {
  applyFilters, buildFacets, CLIENT_IDEA_SPECS, IDEA_PROMINENT, IDEA_SPECS, splitFacets,
  type FilterState,
} from '../../../lib/contentFilters'
import { withoutDecided } from '../../../exp/v2c/contentIdeas'
import { absTime, relTime, sourceLabel } from '../../../exp/v2c/fmt'
import { label } from '../../../lib/labels'
import { Button, Chip, Icon, Input } from '../../../ds'
import { Group, Row, Rows } from '../kit'
import { CalmEmpty, Failed, FilteredEmpty } from './parts'
import { FilterRow } from './filters'
import './content.css'

function scoreLine(i: IdeaCandidate): [string, number | null][] {
  return [
    ['ICP', i.icp_fit_score], ['Virality', i.virality_score],
    ['Gap', i.gap_score], ['Beat', i.beat_fit_score], ['Signal', i.signal_strength],
  ]
}

function IdeaCard({ i, onDeleted, onDecided }: {
  i: IdeaCandidate
  onDeleted: () => void
  /** A decision LANDED. The caller drops the row on the spot and refetches
      behind it — the row has left `reviewing` either way. */
  onDecided: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  // Delete-with-confirm. deleteIdea() attempts the hard delete and falls back
  // to an archived status, throwing honestly if neither write landed.
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  // Approve / Reject, through the same endpoint, with the same optional note.
  // NEITHER GETS A CONFIRM SHEET: both decisions are reversible at that same
  // endpoint, and this band exists to be triaged. Delete keeps its confirm
  // because delete is the one act nothing undoes.
  const [note, setNote] = useState('')
  const [deciding, setDeciding] = useState<IdeaDecision | null>(null)
  const decidable = ideaDecidable(i)
  const title = i.normalized_topic || i.raw_topic || 'Untitled idea'
  // source_ref is a LINK on some sources and the source row's own id on
  // others, so only the link shape is drawn.
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
    <>
      <Row
        className="a-ct-idearow"
        onClick={() => setOpen(o => !o)}
        selected={open}
        lead={
          // The composite score IS this row's anchor mark: one mark, fixed
          // width, on the same rail every other row in the lane uses.
          <span className="a-ct-score">{i.composite_score !== null ? i.composite_score : '—'}</span>
        }
        title={title}
        meta={i.source ? <span>{sourceLabel(i.source)}</span> : undefined}
        tail={i.ingested_at ? <span className="a-dim">{relTime(i.ingested_at)}</span> : undefined}
      />
      {open && (
        <div className="a-ct-body" onClick={e => e.stopPropagation()}>
          <div className="a-ct-scores">
            {scoreLine(i).filter(([, v]) => v !== null).map(([k, v]) => (
              <span key={k}><i>{k}</i>{v}</span>
            ))}
          </div>
          {/* The three marks the closed row does not spend a slot on. Nothing
              was deleted; it is one click down. */}
          <div className="a-wrapline">
            {i.content_type && <Chip>{label(i.content_type)}</Chip>}
            {i.ivan_engaged === true && <Chip tone="quiet">engaged</Chip>}
            {i.raw_topic && i.raw_topic !== i.normalized_topic && (
              <span className="a-meta">{i.raw_topic}</span>
            )}
          </div>
          {/* The scorer's own rubric, under its own names. */}
          {i.why_score && <div className="a-ct-why">{i.why_score}</div>}
          {i.post_angle && <div className="a-ct-why"><b>Angle · </b>{i.post_angle}</div>}
          {i.format_recommendation && (
            <div className="a-wrapline"><Chip>{i.format_recommendation}</Chip></div>
          )}
          {(sourceUrl || i.slack_permalink) && (
            <div className="a-ct-links">
              {sourceUrl && (
                <a className="a-link a-wrapline" href={sourceUrl} target="_blank" rel="noreferrer">
                  Source <Icon name="external" size={16} />
                </a>
              )}
              {i.slack_permalink && (
                <a className="a-link a-wrapline" href={i.slack_permalink} target="_blank" rel="noreferrer">
                  Slack <Icon name="external" size={16} />
                </a>
              )}
            </div>
          )}
          {i.scored_at && <div className="a-ct-ref">Scored {absTime(i.scored_at)}</div>}
          <div className="a-ct-delzone">
            {err && <div className="a-ct-err">{err}</div>}
            {decidable ? (
              <div className="a-ct-decide">
                <Input
                  label="Note"
                  labelHidden
                  type="text"
                  value={note}
                  onChange={e => setNote(e.target.value)}
                  placeholder="Optional note — steers the curator, and is logged as the reject reason"
                  disabled={!!deciding}
                />
                <div className="a-ct-acts">
                  <Button
                    variant="quiet" size="sm" disabled={busy || !!deciding}
                    onClick={() => runDecide('reject')}
                  >
                    {deciding === 'reject' ? 'Rejecting…' : 'Reject'}
                  </Button>
                  <Button
                    variant="primary" size="sm" disabled={busy || !!deciding}
                    onClick={() => runDecide('approve')}
                  >
                    {deciding === 'approve' ? 'Approving…' : 'Approve'}
                  </Button>
                </div>
                {/* Both consequences named, because neither is obvious from the
                    verb: approve does not just mark a row, it fires the promote
                    run that writes the draft. */}
                <div className="a-ct-ref">
                  Approve fires the curator's promote run and the draft appears in
                  Generating · Reject archives the idea. Both are reversible at the
                  same endpoint.
                </div>
              </div>
            ) : (
              // The guard, stated rather than a greyed button.
              <div className="a-ct-ref">{IDEA_NOT_OURS}</div>
            )}
            {confirming ? (
              <div className="a-ct-decide">
                <span className="a-ct-ref">Delete this idea? This removes it permanently.</span>
                <div className="a-ct-acts">
                  <Button variant="quiet" size="sm" disabled={busy} onClick={() => setConfirming(false)}>
                    Cancel
                  </Button>
                  <Button variant="danger" size="sm" busy={busy} onClick={runDelete}>
                    {busy ? 'Deleting…' : 'Delete'}
                  </Button>
                </div>
              </div>
            ) : (
              // Shut while a decision is in flight: approve fires the promote
              // run and only THEN stamps the row, and deleting the candidate
              // underneath that run leaves a promoted draft whose idea no
              // longer exists.
              <div className="a-ct-acts">
                <Button
                  variant="quiet" size="sm" disabled={!!deciding}
                  onClick={() => setConfirming(true)}
                >
                  Delete idea
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}

export function IdeasSection({
  ideas, kind, count, loading, error, loadedAt, refresh, title, unclassified, hiddenByFilter,
}: {
  ideas: IdeaCandidate[]
  kind: 'post' | 'lead_magnet'
  count: number | null
  loading: boolean
  error: string | null
  loadedAt: string | null
  refresh: () => void
  title?: string
  /** Rows whose content_type is null or unrecognised. They ride on the POST
      lane with a label rather than being filtered out of both. */
  unclassified?: IdeaCandidate[]
  /** A DRAFT facet or the draft search box is set. These rows are a different
      table from the drafts those controls run over, so no facet can ever
      narrow them, and a band that cannot answer the question being asked must
      not be the first thing under it. The header, the count and the reason
      stay; the rows do not. */
  hiddenByFilter?: boolean
}) {
  const [filters, setFilters] = useState<FilterState>({})
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
    <div id={kind === 'post' ? 'wb-s-ideas' : 'wb-s-lm-ideas'} className="a-stack">
      {hiddenByFilter ? (
        <div className="a-ct-sub">
          Hidden while a draft filter is on. These {all.length} rows are{' '}
          <code>lm_idea_candidates</code> — a different table from the drafts the
          facets and the search box run over, so no filter here can narrow them.
          Clear the filter to read them.
        </div>
      ) : error ? (
        <Failed what="The idea queue" message={error} onRetry={refresh} loadedAt={null} />
      ) : loading && all.length === 0 ? (
        <div className="a-ct-sub">Reading lm_idea_candidates…</div>
      ) : all.length === 0 ? (
        <CalmEmpty line="No ideas waiting to be scored." loadedAt={loadedAt} />
      ) : (
        <Group label={title ?? 'Ideas'} tail={all.length} stickyHead>
          {/* ONE BAND LINE, not three: the fact on the left, the control on the
              right. The sentence keeps every clause it had — the reviewing
              stage, the database total when it exceeds the page, the rows with
              no content_type — because each of those would be a silent
              omission. The disclosure carries its scope in its NAME because
              these rows are a different table from the drafts. */}
          <div className="a-ct-bandline">
            <div className="a-ct-bandline-t">
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
              <Rows>
                {shown.map(i => (
                  <IdeaCard key={i.id} i={i} onDeleted={refresh} onDecided={markDecided} />
                ))}
              </Rows>
            )}
        </Group>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Ideas, CLIENT LANE
// ---------------------------------------------------------------------------

function ClientIdeaCard({ i, lane, onDecided }: {
  i: ClientIdea
  lane: ContentLane
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
    <>
      <Row
        className="a-ct-idearow"
        onClick={() => setOpen(o => !o)}
        selected={open}
        lead={
          // The client-ICP score IS this row's anchor mark, on the same rail
          // the composite score takes on Ivan's. Same width, same column.
          <span className="a-ct-score">{i.icp_score !== null ? i.icp_score : '—'}</span>
        }
        title={title}
        // ONE mark closed, and it is the SOURCE: it is the fact that separates
        // one of these rows from the next. It sits a tier below the title so it
        // does not compete with it.
        meta={i.source_label ? <span>{i.source_label}</span> : undefined}
        tail={i.created_at ? <span className="a-dim">{relTime(i.created_at)}</span> : undefined}
      />
      {open && (
        <div className="a-ct-body" onClick={e => e.stopPropagation()}>
          {/* The hook is the SENTENCE the writer would open with, and the title
              is the filed version of it. Shown only when they differ. */}
          {i.hook && i.hook !== title && <div className="a-ct-why">{i.hook}</div>}
          <div className="a-wrapline">
            {i.pillar && <Chip>{label(i.pillar)}</Chip>}
            {i.format && <Chip>{label(i.format)}</Chip>}
            {/* The funnel stage is decided HERE, not after generation: the
                kickoff copies this exact value onto the draft. Printing it on
                the approve card is what makes that decision visible at the
                moment it is being made. A row with none says so. */}
            <span title="Funnel stage, carried onto the draft as declared">
              <Chip>{i.funnel_stage ? label(i.funnel_stage) : 'no funnel stage'}</Chip>
            </span>
          </div>
          {/* THE LINE FROM THE CALL, named as one. The extractor's canon
              defines the evidence quote as copied verbatim from a single
              transcript line, so it is drawn as a quote with the attribution
              the ingestor's own voice tag supports and no more than that. Rows
              from any other source keep the plain treatment: their `why` really
              is a rationale, and calling it a quote is the one claim this card
              must never get wrong. */}
          {why && (quote ? (
            <blockquote className="a-ct-quote">
              <div className="a-ct-quote-t">{why}</div>
              <div className="a-ct-quote-a">{quote}</div>
            </blockquote>
          ) : (
            <div className="a-ct-why">{why}</div>
          ))}
          {sourceUrl && (
            <div className="a-ct-links">
              <a className="a-link a-wrapline" href={sourceUrl} target="_blank" rel="noreferrer">
                Source <Icon name="external" size={16} />
              </a>
            </div>
          )}
          <div className="a-ct-delzone">
            {err && <div className="a-ct-err">{err}</div>}
            <div className="a-ct-decide">
              <div className="a-ct-acts">
                <Button
                  variant="quiet" size="sm" disabled={!!deciding}
                  onClick={() => run('rejected')}
                >
                  {deciding === 'rejected' ? 'Rejecting…' : 'Reject'}
                </Button>
                <Button
                  variant="primary" size="sm" disabled={!!deciding}
                  onClick={() => run('approved')}
                >
                  {deciding === 'approved' ? 'Approving…' : 'Approve'}
                </Button>
              </div>
              {/* Both consequences named, and the boundary with them: nothing
                  here reaches the client. */}
              <div className="a-ct-ref">
                Approve hands it to the generation run and the draft comes back at
                Needs review, still internal · Reject files it and the curator
                stops offering it. Neither one reaches {LANE_LABEL[lane]}.
              </div>
            </div>
          </div>
        </div>
      )}
    </>
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
  // Decided in this session leaves the list on the click: the call has already
  // moved the row out of `staged`, so the refetch behind it cannot bring it
  // back, and waiting for that round trip is a second of a row that is no
  // longer there.
  const [decided, setDecided] = useState<ReadonlySet<string>>(() => new Set())
  const [filters, setFilters] = useState<FilterState>({})
  const markDecided = (id: string) => {
    setDecided(cur => new Set(cur).add(id))
    refresh()
  }
  const rows = ideas.filter(i => !decided.has(i.id))
  // THE SUBFILTER, built through the app's own facet mechanism rather than a
  // bespoke pill strip, so it obeys the rule every other filter here obeys: a
  // facet is DERIVED from the rows currently loaded, never from a hardcoded
  // list.
  const { prominent, demoted } = splitFacets(buildFacets(rows, CLIENT_IDEA_SPECS), ['source'])
  const shown = applyFilters(rows, CLIENT_IDEA_SPECS, filters)
  if (error) return <Failed what="The idea bank" message={error} onRetry={refresh} loadedAt={null} />
  if (loading && rows.length === 0) return <div className="a-ct-sub">Reading the idea bank…</div>
  if (rows.length === 0) {
    return <CalmEmpty line={`Nothing staged for ${LANE_POSSESSIVE[lane]} lane.`} loadedAt={loadedAt} />
  }
  return (
    <Group label="Ideas" tail={rows.length} stickyHead>
      <div className="a-ct-bandline">
        <div className="a-ct-bandline-t">
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
          <Rows>
            {shown.map(i => (
              <ClientIdeaCard key={i.id} i={i} lane={lane} onDecided={markDecided} />
            ))}
          </Rows>
        )}
    </Group>
  )
}
