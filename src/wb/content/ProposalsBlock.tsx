/* ==========================================================================
   AUDIENCE PROPOSALS — the one place a recommendation is decided (Run 06).

   It sits directly above the audience block, under the sections Ivan writes,
   because the evidence a proposal cites is the evidence the block below
   counts. Deciding it anywhere else would mean deciding it away from its
   proof.

   This surface approves a proposal into the lane's idea bank, retains a
   weekly pass with its reason, or deletes a legacy proposal. The strategy
   sections above stay the only writer of strategy text; nothing here touches them.

   What the surface refuses to do:

     · remove a row before the database says it is gone. A failed approve
       keeps its row and shows the refusal the server sent, because a row that
       vanished on a failure is a lie the next read corrects too late.
     · claim a write that did not happen. The RPC is idempotent: when the idea
       already existed it says `already`, and so does the receipt.
     · ask for a drop without saying what a drop is. It deletes; there is no
       archive to restore from, and the sheet says so in those words.

   HOOKS. Every hook in this file is declared at the top of its component,
   before any branch. A hook placed after an early return blanked every DM
   conversation in this app for about an hour on 2026-09-09.
   ========================================================================== */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Badge, Button } from '../../ds'
import { Group, Row, relAge } from '../kit'
import { CalmEmpty, Failed } from './parts'
import { useConfirm } from '../chrome/ConfirmSheet'
import {
  buyerReason, changedOverrides, compactEvidenceLine, dropProposal, editDraft, evidenceCategory,
  evidenceLine, fetchProposals, prerequisites, proposalTitle, proposedAt, publishProposal, passWeeklyProposal, rosterRole,
  proposalEditDirty, proposalRefreshMayApply, seedNote, shortDate, textField, topicChange, TEXT_FIELDS,
  type FounderSourceRow, type Proposal, type SourceRow, type TextOverrides,
} from '../../lib/proposals'
import type { ContentLane } from '../../lib/content'
import './content.css'
import './proposals-evidence.css'

// What a finished approve leaves behind on the screen. Kept per row rather than
// as a toast: the sentence names the table the idea landed in, and that is a
// fact about THIS proposal, not a passing notification.
type Receipt = { text: string; already: boolean }

// A textarea that grows to its content — the same idiom the strategy sections
// use, for the same reason: a `why_it_matters` is two lines or twelve and a
// fixed box turns the twelve-line one into a four-line scroll port.
function useAutoGrow(ref: React.RefObject<HTMLTextAreaElement | null>, value: string, on: boolean) {
  useEffect(() => {
    const el = ref.current
    if (!el || !on) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [ref, value, on])
}

function EditField({ label, value, onChange }: {
  label: string
  value: string
  onChange: (v: string) => void
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useAutoGrow(ref, value, true)
  return (
    <label className="a-prop-edit">
      <span className="a-eyebrow">{label}</span>
      <textarea
        ref={ref}
        className="ds-textarea a-prop-ta"
        value={value}
        rows={2}
        onChange={e => onChange(e.target.value)}
      />
    </label>
  )
}

/** One cited row, as a link. The author, the date and the reaction count are
    the three things that decide whether the citation is worth opening, so all
    three are printed rather than a bare id. A row with no url is still shown —
    it is evidence that exists, just not evidence you can click. */
function safeSourceHref(url: string | null | undefined): string | null {
  const href = url?.trim()
  return href && /^https?:\/\//i.test(href) ? href : null
}

const SOURCE_LABELS: Record<string, string> = {
  own_post: 'Your post',
  founder: 'Founder note',
  buyer_question: 'Buyer question',
  news: 'News source',
  trend: 'Trend source',
  competitor: 'Reference post',
}

function SourceLink({ s }: { s: SourceRow }) {
  const label = [
    s.author?.trim() || SOURCE_LABELS[s.kind ?? ''] || 'Reference post',
    s.date?.trim() || 'date not recorded',
    typeof s.reactions === 'number' ? `${s.reactions} reactions` : null,
    typeof s.comments === 'number' ? `${s.comments} comment${s.comments === 1 ? '' : 's'}` : null,
    typeof s.shares === 'number' ? `${s.shares} share${s.shares === 1 ? '' : 's'}` : null,
  ].filter(Boolean).join(' · ')
  const href = safeSourceHref(s.url)
  const limits = Array.isArray(s.limitations) ? s.limitations.join(' ') : s.limitations
  return (
    <div className="a-prop-founder-src">
      {href
        ? <a className="a-prop-src" href={href} target="_blank" rel="noreferrer">{label}</a>
        : <span className="a-prop-src a-dim">{label}</span>}
      {s.location && !href ? <span className="a-ct-sub">{s.location}</span> : null}
      {s.excerpt ? <span className="a-prop-v">{s.excerpt}</span> : null}
      {limits ? <span className="a-ct-sub">{limits}</span> : null}
    </div>
  )
}

function FounderSource({ s }: { s: FounderSourceRow }) {
  const label = [s.author?.trim(), s.date?.trim() || 'date not recorded', s.id?.trim()].filter(Boolean).join(' · ') || 'Unattributed founder source'
  const href = safeSourceHref(s.url)
  const text = s.text?.trim()
  return (
    <div className="a-prop-founder-src">
      {href
        ? <a className="a-prop-src" href={href} target="_blank" rel="noreferrer">{label}</a>
        : <span className="a-prop-src a-dim">{label}</span>}
      {text && text.length > 180 ? (
        <details className="a-prop-history">
          <summary>Retained source text</summary>
          <div className="a-prop-v">{text}</div>
        </details>
      ) : text ? <span className="a-prop-v">{text}</span> : null}
    </div>
  )
}

/** One proposal. Exported so the suite can render a row without a fetch, the
    same way `Recommendations` is exported from the audience block: a phrase
    that has never been rendered is a phrase nobody has checked. */
export function ProposalRow({ p, onApprove, onDrop, onDirtyChange, readOnly = false }: {
  readOnly?: boolean
  p: Proposal
  /** Resolves to the receipt line when the write landed, or throws. */
  onApprove: (p: Proposal, overrides: TextOverrides) => Promise<Receipt>
  onDrop: (p: Proposal, reason?: string) => Promise<void>
  onDirtyChange?: (id: string, dirty: boolean) => void
}) {
  // ---- hooks, all of them, before any branch ------------------------------
  const [editing, setEditing] = useState(false)
  const [passing, setPassing] = useState(false)
  const [passReason, setPassReason] = useState('')
  const [draft, setDraft] = useState<TextOverrides>(() => editDraft(p))
  const [busy, setBusy] = useState<null | 'approve' | 'drop'>(null)
  const [error, setError] = useState<string | null>(null)
  const [receipt, setReceipt] = useState<Receipt | null>(null)
  const confirm = useConfirm()
  const dirty = proposalEditDirty(p, draft, editing, receipt !== null) || (passing && passReason.trim() !== '')

  useEffect(() => {
    onDirtyChange?.(p.id, dirty)
    return () => onDirtyChange?.(p.id, false)
  }, [dirty, onDirtyChange, p.id])

  const startEdit = useCallback(() => {
    setDraft(editDraft(p))
    setEditing(true)
  }, [p])

  const approve = useCallback(async () => {
    setBusy('approve')
    setError(null)
    try {
      const r = await onApprove(p, editing ? changedOverrides(p, draft) : {})
      setEditing(false)
      setReceipt(r)
    } catch (e: unknown) {
      // The row STAYS. Whatever the server refused, the proposal is still there
      // and still open, and the reader has to be able to see both facts.
      setError(e instanceof Error ? e.message : 'The approve did not go through.')
    } finally {
      setBusy(null)
    }
  }, [draft, editing, onApprove, p])

  const drop = useCallback(async () => {
    if (p.context?.audn?.weekly) {
      if (!passReason.trim()) return
    } else {
      const ok = await confirm({
        title: 'Delete this proposal?',
        message: 'It is deleted, not archived.',
        confirmText: 'Delete it',
        danger: true,
      })
      if (!ok) return
    }
    setBusy('drop')
    setError(null)
    try {
      await onDrop(p, p.context?.audn?.weekly ? passReason.trim() : undefined)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'The decision did not go through.')
    } finally {
      setBusy(null)
    }
  }, [confirm, onDrop, p, passReason])

  // ---- the row ------------------------------------------------------------
  const audn = p.context?.audn ?? null
  const weekly = audn?.weekly
  const sources = p.context?.source_rows ?? []
  const seed = seedNote(p)
  const at = proposedAt(p)
  const change = topicChange(p)
  const founderIds = audn?.founder_source_ids?.filter(Boolean) ?? []
  const founderRows = audn?.founder_source_rows?.filter(Boolean) ?? []
  const original = p.context?.correction_review?.original_audn
  const baseline = p.context?.author_baseline

  if (receipt) {
    // The row has left the queue. It is replaced by the sentence that says
    // where it went, and nothing else — an approved proposal is not a card
    // with dead buttons.
    return (
      <div className="a-prop a-prop-done">
        <div className="a-prop-title">{proposalTitle(p)}</div>
        <div className="a-ct-sub">{receipt.text}</div>
      </div>
    )
  }

  return (
    <div className="a-prop">
      <Row
        title={editing ? undefined : proposalTitle(p)}
        titleWrap
        meta={
          <span className="a-prop-meta">
            {weekly?.week_start ? `Week of ${shortDate(weekly.week_start)} ${weekly.week_start.slice(0, 4)} · ` : ''}
            {at ? `proposed ${relAge(at)}` : 'proposed date not recorded'}
            {seed ? <> · {seed}</> : null}
          </span>
        }
        tail={<Badge tone="neutral" variant="ring">{weekly?.slot ? `${weekly.slot[0].toUpperCase()}${weekly.slot.slice(1)}` : rosterRole(p)}</Badge>}
      />

      {editing ? (
        <div className="a-prop-editor">
          <EditField
            label="Title"
            value={draft.title ?? ''}
            onChange={v => setDraft(d => ({ ...d, title: v }))}
          />
          {TEXT_FIELDS.map(f => (
            <EditField
              key={f.key}
              label={f.label}
              value={draft[f.key] ?? ''}
              onChange={v => setDraft(d => ({ ...d, [f.key]: v }))}
            />
          ))}
          <div className="a-ct-sub">
            Send to ideas sends only the fields you changed. The evidence is never editable.
          </div>
        </div>
      ) : (
        <div className="a-prop-body">
          <div className="a-prop-f">
            <span className="a-eyebrow">Could publish</span>
            <span className="a-prop-v">{textField(p, 'could_publish') || 'Publishing angle not stated.'}</span>
          </div>
        </div>
      )}

      {weekly ? (
        <div className="a-prop-body">
          {[
            ['Hook', weekly.hook],
            ['Format', audn?.format?.replace(/_/g, ' ')],
            ['Why now', weekly.why_now],
            ['Intended response', weekly.intended_response],
            ['Success metric', weekly.success_metric],
          ].map(([label, value]) => (
            <div className="a-prop-f" key={label}>
              <span className="a-eyebrow">{label}</span>
              <span className="a-prop-v">{value?.trim() || 'Not stated.'}</span>
            </div>
          ))}
        </div>
      ) : null}

      <div className="a-prop-evidence-head">
        <div className="a-prop-f">
          <span className="a-eyebrow">Buyer reason</span>
          <span className="a-prop-v">{buyerReason(p)}</span>
        </div>
        <div className="a-prop-f">
          <span className="a-eyebrow">{weekly ? 'Evidence confidence' : 'Evidence category'}</span>
          <span className="a-prop-v">{weekly
            ? weekly.evidence_confidence
              ? `${weekly.evidence_confidence[0].toUpperCase()}${weekly.evidence_confidence.slice(1)} · ${weekly.confidence_reason?.trim() || 'Reason not stated.'}`
              : 'Not stated.'
            : evidenceCategory(p)}</span>
          {weekly ? <span className="a-ct-sub">Evidence confidence describes source support, not the chance of success.</span> : null}
        </div>
        <div className="a-prop-ev">Observed source record · {compactEvidenceLine(p) || 'source count and dates not stated'}</div>
        <div className="a-prop-f">
          <span className="a-eyebrow">Prerequisite</span>
          <span className="a-prop-v">{prerequisites(p)}</span>
        </div>
      </div>

      <details className="a-prop-details">
        <summary>Review evidence and topic history</summary>
        <div className="a-prop-detail-body">
          {weekly ? <>
            <div className="a-prop-f">
              <span className="a-eyebrow">Editorial priority</span>
              <span className="a-prop-v">{weekly.priority_reason?.trim() || 'Reason not stated.'}</span>
              <span className="a-ct-sub">Order reflects editorial priority; performance is not predicted.</span>
            </div>
            <div className="a-prop-f">
              <span className="a-eyebrow">Learning from earlier recommendations</span>
              <span className="a-prop-v">{weekly.learning?.explanation?.trim() || 'No prior learning recorded.'}</span>
              {weekly.learning?.recommendation_ids?.length
                ? <span className="a-ct-sub">Prior recommendation references: {weekly.learning.recommendation_ids.join(', ')}</span>
                : null}
            </div>
          </> : null}
          {sources.length > 0 ? (
            <div className="a-prop-f">
              <span className="a-eyebrow">Source evidence</span>
              <div className="a-prop-srcs">
                {sources.map((s, i) => <SourceLink key={s.id ?? i} s={s} />)}
              </div>
            </div>
          ) : <div className="a-ct-sub">No linked observed source rows were retained.</div>}

          <div className="a-prop-f">
            <span className="a-eyebrow">Evidence limits</span>
            <span className="a-prop-v">{evidenceLine(p).split(' · unknowns: ')[1] || 'Not stated.'}</span>
          </div>

          {textField(p, 'what_changed') ? (
            <div className="a-prop-f">
              <span className="a-eyebrow">Observed change</span>
              <span className="a-prop-v">{textField(p, 'what_changed')}</span>
            </div>
          ) : null}

          <div className="a-prop-f">
            <span className="a-eyebrow">Founder factual sources</span>
            <span className="a-ct-sub">factual input, not performance evidence.</span>
            {founderRows.map((s, i) => <FounderSource key={s.id ?? i} s={s} />)}
            {founderIds.filter(id => !founderRows.some(s => s.id === id)).map(id => (
              <span className="a-prop-v" key={id}>{id} · retained ID; source row unavailable</span>
            ))}
            {!founderRows.length && !founderIds.length ? <span className="a-prop-v">None recorded.</span> : null}
          </div>

          <div className="a-prop-f">
            <span className="a-eyebrow">Performance evidence</span>
            <span className="a-prop-v">
              {typeof baseline?.median === 'number' && typeof baseline?.n === 'number'
                ? `Observed author median: ${baseline.median} across ${baseline.n} posts${typeof baseline.window_days === 'number' ? ` in ${baseline.window_days} days` : ''}. P90 and recommendation validation are not recorded.`
                : 'No comparable performance baseline is recorded. P90 and recommendation validation are unavailable.'}
            </span>
          </div>

          <div className="a-prop-f">
            <span className="a-eyebrow">Prerequisite details</span>
            {[audn?.next_action, audn?.proof_needed,
              typeof audn?.asset_required === 'string' ? audn.asset_required : null]
              .filter((v): v is string => typeof v === 'string' && v.trim() !== '')
              .filter((v, i, all) => all.findIndex(x => x.trim() === v.trim()) === i)
              .filter(v => v.trim() !== prerequisites(p))
              .map((v, i) => <span className="a-prop-v" key={`${i}-${v}`}>{v.trim()}</span>)}
            <span className="a-ct-sub">Primary prerequisite shown above.</span>
            {typeof audn?.asset_required === 'string' && audn.asset_state
              ? <span className="a-ct-sub">Asset status: {audn.asset_state}</span>
              : null}
            {!audn?.next_action && !audn?.proof_needed && typeof audn?.asset_required !== 'string'
              ? <span className="a-prop-v">Not stated.</span>
              : null}
          </div>

          {change ? (
            <div className="a-prop-f">
              <span className="a-eyebrow">Topic correction</span>
              <span className="a-prop-v">Original: {change.from}</span>
              <span className="a-prop-v">Final: {change.to}</span>
              {change.reason ? <span className="a-ct-sub">Reason: {change.reason}</span> : null}
            </div>
          ) : <div className="a-ct-sub">No original-to-final topic change was retained.</div>}

          {original ? (
            <details className="a-prop-history">
              <summary>Full original recommendation</summary>
              <div className="a-prop-body">
                <div className="a-prop-f"><span className="a-eyebrow">What changed</span><span className="a-prop-v">{original.what_changed || p.context?.correction_review?.original_body || 'Not stated.'}</span></div>
                <div className="a-prop-f"><span className="a-eyebrow">Why it mattered</span><span className="a-prop-v">{original.why_it_matters || 'Not stated.'}</span></div>
                <div className="a-prop-f"><span className="a-eyebrow">Original angle</span><span className="a-prop-v">{original.could_publish || 'Not stated.'}</span></div>
                <div className="a-prop-f"><span className="a-eyebrow">Original proof needed</span><span className="a-prop-v">{original.proof_needed || 'Not stated.'}</span></div>
              </div>
            </details>
          ) : null}
        </div>
      </details>

      {error && <div className="a-ct-sub a-sev-urgent a-prop-err">{error}</div>}

      {!readOnly && (passing ? (
        <div className="a-prop-editor">
          <EditField label="Why pass on this?" value={passReason} onChange={setPassReason} />
          <div className="a-ct-sub">Required. This reason is retained to improve future recommendations.</div>
          <div className="a-prop-acts">
            <Button variant="primary" size="sm" busy={busy === 'drop'} disabled={busy !== null || !passReason.trim()} onClick={() => { void drop() }}>Save reason</Button>
            <Button variant="quiet" size="sm" disabled={busy !== null} onClick={() => setPassing(false)}>Cancel</Button>
          </div>
        </div>
      ) : <div className="a-prop-acts">
        <Button
          variant="primary"
          size="sm"
          busy={busy === 'approve'}
          disabled={busy !== null}
          onClick={() => { void approve() }}
        >
          Send to ideas
        </Button>
        {editing ? (
          <Button variant="quiet" size="sm" disabled={busy !== null} onClick={() => setEditing(false)}>
            Cancel
          </Button>
        ) : (
          <Button variant="quiet" size="sm" disabled={busy !== null} onClick={startEdit}>
            Edit
          </Button>
        )}
        <Button
          variant="quiet"
          size="sm"
          busy={busy === 'drop'}
          disabled={busy !== null}
          onClick={() => { if (weekly) setPassing(true); else void drop() }}
        >
          {weekly ? 'Pass on this' : 'Delete'}
        </Button>
      </div>)}
    </div>
  )
}

/** The list, given rows. Pure apart from the row's own state, so the three
    states below can be rendered in a test without a network. */
export function ProposalsList({ rows, onApprove, onDrop, onDirtyChange, readOnly = false }: {
  readOnly?: boolean
  rows: Proposal[]
  onApprove: (p: Proposal, overrides: TextOverrides) => Promise<Receipt>
  onDrop: (p: Proposal, reason?: string) => Promise<void>
  onDirtyChange?: (dirty: boolean) => void
}) {
  const dirtyIds = useRef(new Set<string>())
  const rowDirty = useCallback((id: string, dirty: boolean) => {
    if (dirty) dirtyIds.current.add(id)
    else dirtyIds.current.delete(id)
    onDirtyChange?.(dirtyIds.current.size > 0)
  }, [onDirtyChange])

  // Use UTC, matching the writer and commit RPC. Weekends prepare next Monday.
  const now = new Date()
  const day = now.getUTCDay()
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (day + 6) % 7))
  const current = monday.toISOString().slice(0, 10)
  monday.setUTCDate(monday.getUTCDate() + 7)
  const upcoming = monday.toISOString().slice(0, 10)
  const weekend = day === 0 || day === 6
  const weeks = weekend ? [upcoming, current] : [current, upcoming]
  const older = rows.filter(p => !weeks.includes(p.context?.audn?.weekly?.week_start ?? ''))
    .sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? ''))
  const renderRow = (p: Proposal) => (
    <ProposalRow readOnly={readOnly} key={p.id} p={p} onApprove={onApprove} onDrop={onDrop} onDirtyChange={rowDirty} />
  )

  return (
    <>
      {weeks.map((week, index) => {
        const picks = rows.filter(p => p.context?.audn?.weekly?.week_start === week)
          .sort((a, b) => (a.context?.audn?.weekly?.rank ?? Infinity) - (b.context?.audn?.weekly?.rank ?? Infinity))
        if (!picks.length && index > 0) return null
        return (
          <section className="a-prop-week" key={week} aria-label={`${week === current ? 'This' : 'Upcoming'} week · ${week}`}>
            <h3 className="a-eyebrow">{week === current ? 'This week' : 'Upcoming week'} · {shortDate(week)} {week.slice(0, 4)}</h3>
            {picks.length ? picks.map(renderRow) : <div className="a-ct-sub">No open picks for {week === current ? 'this' : 'the upcoming'} week.</div>}
          </section>
        )
      })}
      {older.length ? (
        <details className="a-prop-older">
          <summary>Older and undated recommendations · {older.length}</summary>
          {older.map(renderRow)}
        </details>
      ) : null}
    </>
  )
}


/** What the block is looking at. Four states and no fifth — and `failed` is a
    state, not a silent empty list: a read that did not happen must never be
    rendered as "nothing is waiting". */
export type ProposalsState =
  | { kind: 'loading' }
  | { kind: 'failed'; error: string }
  | { kind: 'empty' }
  | { kind: 'list'; rows: Proposal[] }

/** The whole surface, given its state. PURE — no hook, no fetch — so all four
    states can be rendered and read in a test rather than reasoned about. The
    block below is this plus the read. */
export function ProposalsView({ lane, state, loadedAt, onRetry, onApprove, onDrop, onDirtyChange, readOnly = false }: {
  readOnly?: boolean
  lane: ContentLane
  state: ProposalsState
  loadedAt: string | null
  onRetry?: () => void
  onApprove: (p: Proposal, overrides: TextOverrides) => Promise<Receipt>
  onDrop: (p: Proposal, reason?: string) => Promise<void>
  onDirtyChange?: (dirty: boolean) => void
}) {
  const stamp = <span className="a-dim a-mono">{lane} · read {relAge(loadedAt)}</span>

  if (state.kind === 'loading') {
    return (
      <Group className="a-prop-g" label={readOnly ? "Legacy suggestion history" : "Next posts to consider"} tail={stamp} pad>
        <div className="a-ct-sub a-prop-hold">Reading this lane’s proposals…</div>
      </Group>
    )
  }

  if (state.kind === 'failed') {
    return (
      <Group className="a-prop-g" label={readOnly ? "Legacy suggestion history" : "Next posts to consider"} tail={stamp} pad>
        {/* The message opens with `proposals: `, the name `fetchProposals`
            gives its own read. A failure that does not say WHAT failed sends
            the reader to the wrong table. */}
        <Failed
          what="The audience proposals"
          message={state.error}
          onRetry={onRetry}
          loadedAt={null}
        />
      </Group>
    )
  }

  if (state.kind === 'empty') {
    return (
      <Group className="a-prop-g" label={readOnly ? "Legacy suggestion history" : "Next posts to consider"} tail={stamp} pad>
        <CalmEmpty
          line="No proposal is waiting for this lane."
          sub="The writer runs weekly. Either nothing was proposed on the last run, or every proposal has been decided."
          loadedAt={loadedAt}
        />
      </Group>
    )
  }

  return (
    <Group
      className="a-prop-g"
      label={readOnly ? "Legacy suggestion history" : "Next posts to consider"}
      tail={
        <span className="a-prop-tail">
          <Badge tone="neutral" variant="ring">{state.rows.length} open</Badge>
          {stamp}
        </span>
      }
      pad
    >
      <div className="a-ct-sub">
        {readOnly ? "Earlier writer output and its original evidence. These rows are kept for reference; review current suggestions in This week." : "Written weekly from available source evidence. Send to ideas puts one in this lane’s idea bank. Pass on this saves your reason for the next review. Nothing is published from here."}
      </div>
      <ProposalsList readOnly={readOnly} rows={state.rows} onApprove={onApprove} onDrop={onDrop} onDirtyChange={onDirtyChange} />
    </Group>
  )
}

export function ProposalsBlock({ lane, onDirtyChange, refreshKey, readOnly = false }: {
  readOnly?: boolean
  lane: ContentLane
  onDirtyChange?: (dirty: boolean) => void
  refreshKey?: number
}) {
  // EVERY HOOK FIRST. Nothing below this line may return before they have all
  // been declared (2026-09-09, the DMs outage).
  const [rows, setRows] = useState<Proposal[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadedAt, setLoadedAt] = useState<string | null>(null)
  const dirtyRef = useRef(false)

  const refresh = useCallback(() => {
    let live = true
    setLoading(true)
    void fetchProposals(lane).then(s => {
      if (!live) return
      // A refresh can begin while clean and return after the reader starts an
      // edit. Applying either success or failure then would replace the row or
      // unmount its editor, so the response is discarded.
      if (!proposalRefreshMayApply(dirtyRef.current)) {
        setLoading(false)
        return
      }
      if (s.ok) {
        setRows(s.rows)
        setError(null)
        setLoadedAt(new Date().toISOString())
      } else {
        setError(s.error)
      }
      setLoading(false)
    })
    return () => { live = false }
  }, [lane])

  // A lane switch mid-read must never land one lane's proposals under another
  // lane's heading, so the cleanup disowns the in-flight result.
  useEffect(() => {
    if (!dirtyRef.current) return refresh()
  }, [refresh, refreshKey])

  const handleDirtyChange = useCallback((dirty: boolean) => {
    dirtyRef.current = dirty
    onDirtyChange?.(dirty)
  }, [onDirtyChange])

  const onApprove = useCallback(async (p: Proposal, overrides: TextOverrides) => {
    const r = await publishProposal(lane, p.id, overrides)
    const where = r.table ?? 'the idea bank'
    return {
      already: r.already,
      // `already` means the RPC found the idea row and wrote NOTHING. Saying
      // "in the idea bank" for both would claim a write that did not happen.
      text: r.already
        ? `Already in the idea bank as ${where}. Nothing was written this time.`
        : `In the idea bank as ${where}.`,
    }
  }, [lane])

  const onDrop = useCallback(async (p: Proposal, reason?: string) => {
    if (p.context?.audn?.weekly) {
      await passWeeklyProposal(lane, p.id, reason ?? '')
      setRows(cur => (cur ?? []).filter(r => r.id !== p.id))
      return
    }
    const { deleted } = await dropProposal(p.id)
    if (deleted === 0) {
      // Nothing was removed, and the open guard is the usual reason: it was
      // approved somewhere else while this screen sat here. The row stays.
      throw new Error('Nothing was deleted. It may have been approved already. Refresh to see.')
    }
    setRows(cur => (cur ?? []).filter(r => r.id !== p.id))
  }, [lane])

  const state: ProposalsState =
    loading && rows === null && !error ? { kind: 'loading' }
      : error ? { kind: 'failed', error }
        : !rows || rows.length === 0 ? { kind: 'empty' }
          : { kind: 'list', rows }

  return (
    <ProposalsView
      readOnly={readOnly}
      lane={lane}
      state={state}
      loadedAt={loadedAt}
      onRetry={refresh}
      onApprove={onApprove}
      onDrop={onDrop}
      onDirtyChange={handleDirtyChange}
    />
  )
}
