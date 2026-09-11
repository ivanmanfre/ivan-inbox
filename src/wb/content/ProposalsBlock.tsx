/* ==========================================================================
   AUDIENCE PROPOSALS — the one place a recommendation is decided (Run 06).

   It sits directly above the audience block, under the sections Ivan writes,
   because the evidence a proposal cites is the evidence the block below
   counts. Deciding it anywhere else would mean deciding it away from its
   proof.

   This is the FIRST audience surface that writes, and it writes exactly two
   things: an approve (a database function that copies the proposal into the
   lane's idea bank) and a drop (a DELETE). The strategy sections above stay
   the only writer of strategy text; nothing here touches them.

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
  changedOverrides, dropProposal, editDraft, evidenceLine, fetchProposals, proposalTitle,
  proposedAt, publishProposal, rosterRole, seedNote, textField, TEXT_FIELDS,
  type Proposal, type SourceRow, type TextOverrides,
} from '../../lib/proposals'
import type { ContentLane } from '../../lib/content'
import './content.css'

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
function SourceLink({ s }: { s: SourceRow }) {
  const label = [
    s.author?.trim() || s.id || 'unattributed',
    s.date?.trim() || null,
    typeof s.reactions === 'number' ? `${s.reactions} reactions` : null,
  ].filter(Boolean).join(' · ')
  if (!s.url) return <span className="a-prop-src a-dim">{label}</span>
  return (
    <a className="a-prop-src" href={s.url} target="_blank" rel="noreferrer">{label}</a>
  )
}

/** One proposal. Exported so the suite can render a row without a fetch, the
    same way `Recommendations` is exported from the audience block: a phrase
    that has never been rendered is a phrase nobody has checked. */
export function ProposalRow({ p, onApprove, onDrop }: {
  p: Proposal
  /** Resolves to the receipt line when the write landed, or throws. */
  onApprove: (p: Proposal, overrides: TextOverrides) => Promise<Receipt>
  onDrop: (p: Proposal) => Promise<void>
}) {
  // ---- hooks, all of them, before any branch ------------------------------
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<TextOverrides>(() => editDraft(p))
  const [busy, setBusy] = useState<null | 'approve' | 'drop'>(null)
  const [error, setError] = useState<string | null>(null)
  const [receipt, setReceipt] = useState<Receipt | null>(null)
  const confirm = useConfirm()

  const startEdit = useCallback(() => {
    setDraft(editDraft(p))
    setEditing(true)
  }, [p])

  const approve = useCallback(async () => {
    setBusy('approve')
    setError(null)
    try {
      const r = await onApprove(p, editing ? changedOverrides(p, draft) : {})
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
    const ok = await confirm({
      title: 'Delete this proposal?',
      message: 'It is deleted, not archived.',
      confirmText: 'Delete it',
      danger: true,
    })
    if (!ok) return
    setBusy('drop')
    setError(null)
    try {
      await onDrop(p)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'The drop did not go through.')
    } finally {
      setBusy(null)
    }
  }, [confirm, onDrop, p])

  // ---- the row ------------------------------------------------------------
  const audn = p.context?.audn ?? null
  const sources = p.context?.source_rows ?? []
  const seed = seedNote(p)
  const asset = audn?.asset_required
  const at = proposedAt(p)

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
            {at ? `proposed ${relAge(at)}` : 'proposed date not recorded'}
            {seed ? <> · {seed}</> : null}
          </span>
        }
        tail={<Badge tone="neutral" variant="ring">{rosterRole(p)}</Badge>}
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
          {TEXT_FIELDS.map(f => {
            const v = textField(p, f.key)
            if (!v) return null
            return (
              <div className="a-prop-f" key={f.key}>
                <span className="a-eyebrow">{f.label}</span>
                <span className="a-prop-v">{v}</span>
              </div>
            )
          })}
        </div>
      )}

      <div className="a-prop-ev">{evidenceLine(p)}</div>

      {sources.length > 0 && (
        <div className="a-prop-srcs">
          {sources.map((s, i) => <SourceLink key={s.id ?? i} s={s} />)}
        </div>
      )}

      {asset ? (
        <div className="a-ct-sub">
          Asset needed: {asset}
          {audn?.asset_state ? ` · ${audn.asset_state}` : ''}
        </div>
      ) : null}

      {error && <div className="a-ct-sub a-sev-urgent a-prop-err">{error}</div>}

      <div className="a-prop-acts">
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
          onClick={() => { void drop() }}
        >
          Delete
        </Button>
      </div>
    </div>
  )
}

/** The list, given rows. Pure apart from the row's own state, so the three
    states below can be rendered in a test without a network. */
export function ProposalsList({ rows, onApprove, onDrop }: {
  rows: Proposal[]
  onApprove: (p: Proposal, overrides: TextOverrides) => Promise<Receipt>
  onDrop: (p: Proposal) => Promise<void>
}) {
  return (
    <>
      {rows.map(p => (
        <ProposalRow key={p.id} p={p} onApprove={onApprove} onDrop={onDrop} />
      ))}
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
export function ProposalsView({ lane, state, loadedAt, onRetry, onApprove, onDrop }: {
  lane: ContentLane
  state: ProposalsState
  loadedAt: string | null
  onRetry?: () => void
  onApprove: (p: Proposal, overrides: TextOverrides) => Promise<Receipt>
  onDrop: (p: Proposal) => Promise<void>
}) {
  const stamp = <span className="a-dim a-mono">{lane} · read {relAge(loadedAt)}</span>

  if (state.kind === 'loading') {
    return (
      <Group className="a-prop-g" label="Next posts to consider" tail={stamp} pad>
        <div className="a-ct-sub a-prop-hold">Reading this lane’s proposals…</div>
      </Group>
    )
  }

  if (state.kind === 'failed') {
    return (
      <Group className="a-prop-g" label="Next posts to consider" tail={stamp} pad>
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
      <Group className="a-prop-g" label="Next posts to consider" tail={stamp} pad>
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
      label="Next posts to consider"
      tail={
        <span className="a-prop-tail">
          <Badge tone="neutral" variant="ring">{state.rows.length} open</Badge>
          {stamp}
        </span>
      }
      pad
    >
      <div className="a-ct-sub">
        Written weekly from the posts in the benchmark above. Send to ideas puts one
        in this lane’s idea bank, where it joins the normal idea flow; Delete removes
        it for good. Nothing is published from here.
      </div>
      <ProposalsList rows={state.rows} onApprove={onApprove} onDrop={onDrop} />
    </Group>
  )
}

export function ProposalsBlock({ lane }: { lane: ContentLane }) {
  // EVERY HOOK FIRST. Nothing below this line may return before they have all
  // been declared (2026-09-09, the DMs outage).
  const [rows, setRows] = useState<Proposal[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadedAt, setLoadedAt] = useState<string | null>(null)

  const refresh = useCallback(() => {
    let live = true
    setLoading(true)
    void fetchProposals(lane).then(s => {
      if (!live) return
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
  useEffect(() => refresh(), [refresh])

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

  const onDrop = useCallback(async (p: Proposal) => {
    const { deleted } = await dropProposal(p.id)
    if (deleted === 0) {
      // Nothing was removed, and the open guard is the usual reason: it was
      // approved somewhere else while this screen sat here. The row stays.
      throw new Error('Nothing was deleted. It may have been approved already. Refresh to see.')
    }
    setRows(cur => (cur ?? []).filter(r => r.id !== p.id))
  }, [])

  const state: ProposalsState =
    loading && rows === null && !error ? { kind: 'loading' }
      : error ? { kind: 'failed', error }
        : !rows || rows.length === 0 ? { kind: 'empty' }
          : { kind: 'list', rows }

  return (
    <ProposalsView
      lane={lane}
      state={state}
      loadedAt={loadedAt}
      onRetry={refresh}
      onApprove={onApprove}
      onDrop={onDrop}
    />
  )
}
