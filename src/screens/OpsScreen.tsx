import { useEffect, useRef, useState } from 'react'
import { useConfirm } from '../components/ConfirmSheet'
import { OpsSkeleton } from '../components/Skeleton'
import { PullIndicator } from '../components/PullIndicator'
import { usePullToRefresh } from '../hooks/usePullToRefresh'
import { useOps } from '../hooks/useOps'
import {
  approveOpsDraft, blockedOps, discardOpsDraft, pendingOps, sentOps,
  type OpsDraft, type OpsKind,
} from '../lib/ops'

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime()
  const s = Math.max(0, Math.floor((Date.now() - then) / 1000))
  const m = Math.floor(s / 60)
  if (m < 1) return 'now'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  if (d === 1) return 'yday'
  return `${d}d`
}

const KIND_LABEL: Record<OpsKind, string> = { escalation: 'ESC', update: 'UPDATE' }
// Escalations run warm/red (something needs attention); updates stay neutral/blue (fyi).
const KIND_COLOR: Record<OpsKind, string> = { escalation: '#FF453A', update: '#0A84FF' }

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

// Whatever the context jsonb carries worth surfacing inline: who this is about
// (escalations) or what already happened (update receipts), plus a replay tag.
function ContextLine({ draft }: { draft: OpsDraft }) {
  const ctx = draft.context
  if (!ctx) return null
  const who = draft.kind === 'escalation'
    ? [ctx.prospect_name, ctx.company].filter(Boolean).join(' · ')
    : ''
  const receipts = draft.kind === 'update' && Array.isArray(ctx.receipts) ? ctx.receipts : []
  if (!who && receipts.length === 0 && ctx.replay !== true) return null
  return (
    <div className="ops-ctx">
      {who && <span>{who}</span>}
      {receipts.length > 0 && <span>{receipts.join(', ')}</span>}
      {ctx.replay === true && <span className="ops-replay">replay</span>}
    </div>
  )
}

function PendingCard({ draft, refresh }: { draft: OpsDraft; refresh: () => void }) {
  const [body, setBody] = useState(draft.body)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const confirm = useConfirm()

  // Re-seed the editor if the row itself changes (e.g. realtime update lands
  // while the operator hasn't touched it yet).
  useEffect(() => { setBody(draft.body) }, [draft.id, draft.body])

  async function onApprove() {
    const ok = await confirm({
      title: `Post to ${draft.slack_channel}?`,
      message: 'The dispatcher posts this to Slack within about 2 minutes.',
      confirmText: 'Approve & send',
    })
    if (!ok) return
    setBusy(true); setError('')
    try { await approveOpsDraft(draft.id, body); refresh() }
    catch (e) { setError(errText(e)) }
    finally { setBusy(false) }
  }

  async function onDiscard() {
    const ok = await confirm({
      title: 'Discard this one?',
      message: `It won't be posted to ${draft.slack_channel}.`,
      confirmText: 'Discard',
      danger: true,
    })
    if (!ok) return
    setBusy(true); setError('')
    try { await discardOpsDraft(draft.id); refresh() }
    catch (e) { setError(errText(e)) }
    finally { setBusy(false) }
  }

  return (
    <div className="ops-card" data-ops-id={draft.id}>
      <div className="ops-h">
        <span
          className="ops-kind"
          style={{ background: `${KIND_COLOR[draft.kind]}22`, color: KIND_COLOR[draft.kind] }}
        >
          {KIND_LABEL[draft.kind]}
        </span>
        <span className="ops-chan">#{draft.slack_channel}</span>
        <span className="ops-tm">{timeAgo(draft.created_at)}</span>
      </div>
      <ContextLine draft={draft} />
      <textarea
        className="ops-body"
        value={body}
        onChange={e => setBody(e.target.value)}
        disabled={busy}
      />
      {error && <div className="ops-err">{error}</div>}
      <div className="ops-ac">
        <div className="btn s" onClick={busy ? undefined : onDiscard}>Discard</div>
        <div className="btn p" onClick={busy ? undefined : onApprove}>{busy ? 'Sending…' : 'Approve & send'}</div>
      </div>
    </div>
  )
}

// Read-only row for the Sent/Blocked groups — same shape as the Sends log feed.
function ReadOnlyRow({ draft, reason }: { draft: OpsDraft; reason?: string }) {
  return (
    <div className="log-r">
      <span
        className="log-chip"
        style={{ background: `${KIND_COLOR[draft.kind]}22`, color: KIND_COLOR[draft.kind] }}
      >
        {KIND_LABEL[draft.kind]}
      </span>
      <div className="log-mid">
        <div className="log-top">
          <span className="log-nm">#{draft.slack_channel}</span>
        </div>
        <div className="log-snip">{draft.body}</div>
        {reason && <div className="ops-reason">Blocked: {reason}</div>}
      </div>
      <span className="log-tm">{timeAgo(draft.sent_at ?? draft.created_at)}</span>
    </div>
  )
}

function Section({ title, count, open, onToggle, children }: {
  title: string; count: number; open: boolean; onToggle: () => void; children: React.ReactNode
}) {
  if (count === 0) return null
  return (
    <>
      <div className="ops-sechdr" onClick={onToggle}>
        <span>{title} · {count}</span>
        <span className="chev">{open ? '⌄' : '›'}</span>
      </div>
      {open && children}
    </>
  )
}

export function OpsScreen() {
  const { drafts, loading, refresh } = useOps()
  const [sentOpen, setSentOpen] = useState(false)
  const [blockedOpen, setBlockedOpen] = useState(false)
  const rowsRef = useRef<HTMLDivElement>(null)
  const ptr = usePullToRefresh(rowsRef, () => refresh())

  const pending = pendingOps(drafts)
  const sent = sentOps(drafts)
  const blocked = blockedOps(drafts)

  if (loading && drafts.length === 0) {
    return (
      <>
        <div className="nav">
          <div className="row-top"><h2>Ops</h2><div className="avatar-me">IM</div></div>
        </div>
        <OpsSkeleton />
      </>
    )
  }

  return (
    <>
      <div className="nav">
        <div className="row-top"><h2>Ops</h2><div className="avatar-me">IM</div></div>
      </div>
      <div className="rows ops-rows" ref={rowsRef}>
        <PullIndicator pull={ptr.pull} refreshing={ptr.refreshing} trigger={ptr.trigger} />
        {pending.length === 0 ? (
          <div className="empty">No pending updates or escalations.</div>
        ) : (
          pending.map(d => <PendingCard key={d.id} draft={d} refresh={refresh} />)
        )}
        <Section title="Sent" count={sent.length} open={sentOpen} onToggle={() => setSentOpen(o => !o)}>
          <div style={{ padding: '0 16px' }}>
            {sent.map(d => <ReadOnlyRow key={d.id} draft={d} />)}
          </div>
        </Section>
        <Section title="Blocked" count={blocked.length} open={blockedOpen} onToggle={() => setBlockedOpen(o => !o)}>
          <div style={{ padding: '0 16px' }}>
            {blocked.map(d => <ReadOnlyRow key={d.id} draft={d} reason={d.send_blocked_reason ?? undefined} />)}
          </div>
        </Section>
      </div>
    </>
  )
}
