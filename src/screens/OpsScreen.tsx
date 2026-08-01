import { useEffect, useRef, useState } from 'react'
import { useConfirm } from '../components/ConfirmSheet'
import { OpsSkeleton } from '../components/Skeleton'
import { PullIndicator } from '../components/PullIndicator'
import { usePullToRefresh } from '../hooks/usePullToRefresh'
import { useOps } from '../hooks/useOps'
import {
  approveOpsDraft, approveWeeklyReport, blockedOps, canGenerateDraft, claimingOps, discardOpsDraft, engineLabel, expiresIn, generateCommentDraft, markCommentHandled, outboundApproveUrl, outboundSkipUrl, pendingOps, postCommentReply, sentOps,
  type OpsDraft, type OpsKind,
} from '../lib/ops'

function slotText(iso?: string): string {
  if (!iso) return ''
  return iso.replace('T', ' ').slice(0, 16) + ' UTC'
}

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

const KIND_LABEL: Record<OpsKind, string> = { escalation: 'ESC', update: 'UPDATE', newsjack: 'NEWSJACK', weekly_report: 'WEEKLY', comment_reply: 'COMMENT', comment_outbound: 'OUTBOUND' }
// Escalations run warm/red (something needs attention); updates stay neutral/blue (fyi);
// newsjack runs amber because it is the only kind with a clock on it.
const KIND_COLOR: Record<OpsKind, string> = { escalation: '#FF453A', update: '#0A84FF', newsjack: '#FF9F0A', weekly_report: '#30D158', comment_reply: '#BF5AF2', comment_outbound: '#64D2FF' }

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

// Whatever the context jsonb carries worth surfacing inline: who this is about
// (escalations) or what already happened (update receipts), plus a replay tag.
function ContextLine({ draft }: { draft: OpsDraft }) {
  const ctx = draft.context
  if (!ctx) return null
  if (draft.kind === 'newsjack') {
    if (!ctx.headline) return null
    return (
      <div className="ops-ctx">
        {ctx.source_url
          ? <a href={ctx.source_url} target="_blank" rel="noreferrer">{ctx.headline}</a>
          : <span>{ctx.headline}</span>}
      </div>
    )
  }
  // The weekly report card is read before it is sent, so the context line is the
  // week's actual numbers plus the link to the page. Zeros are printed, never
  // dropped: a week with 0 calls booked has to look like one at a glance.
  if (draft.kind === 'weekly_report') {
    const n = (v: unknown) => (typeof v === 'number' ? v : null)
    const parts = [
      n(ctx.replied) !== null ? `${ctx.replied} replied` : null,
      n(ctx.calls_booked) !== null ? `${ctx.calls_booked} calls booked` : null,
      n(ctx.engagers) !== null ? `${ctx.engagers} commented` : null,
      n(ctx.impressions) !== null ? `${ctx.impressions} impressions` : null,
    ].filter(Boolean)
    return (
      <div className="ops-ctx">
        {ctx.week && <span>week of {ctx.week}</span>}
        {parts.length > 0 && <span>{parts.join(' · ')}</span>}
        {ctx.report_url && (
          <a href={ctx.report_url} target="_blank" rel="noreferrer">read the page</a>
        )}
      </div>
    )
  }
  // The comment itself is the card's whole context: who said it, on which post,
  // and what they actually wrote. Without the quote the reply below is unjudgeable.
  if (draft.kind === 'comment_reply') {
    return (
      <div className="ops-ctx">
        <span>{[ctx.author_name, ctx.author_headline].filter(Boolean).join(' · ')}</span>
        {ctx.comment_text && <span>&ldquo;{ctx.comment_text}&rdquo;</span>}
        {ctx.category && <span className="ops-replay">{ctx.category}</span>}
        {ctx.post_url && (
          <a href={ctx.post_url} target="_blank" rel="noreferrer">open the post</a>
        )}
      </div>
    )
  }
  // Outbound: whose post we are commenting on, the line the draft reacts to, and
  // the post itself. The draft below is unjudgeable without the excerpt.
  if (draft.kind === 'comment_outbound') {
    return (
      <div className="ops-ctx">
        <span>{[ctx.target_name, ctx.target_headline].filter(Boolean).join(' · ')}</span>
        {ctx.post_excerpt && <span>&ldquo;{ctx.post_excerpt}&rdquo;</span>}
        {ctx.hook && <span className="ops-replay">{ctx.hook}</span>}
        {ctx.post_url && (
          <a href={ctx.post_url} target="_blank" rel="noreferrer">open the post</a>
        )}
      </div>
    )
  }
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
  const [drafting, setDrafting] = useState(false)
  // Why the engine refused to write one. Named gate violations, not a spinner
  // that stops: a refusal Ivan cannot see reads as a broken button.
  const [refusal, setRefusal] = useState<string[]>([])
  const [error, setError] = useState('')
  const confirm = useConfirm()

  // Re-seed the editor if the row itself changes (e.g. realtime update lands
  // while the operator hasn't touched it yet).
  useEffect(() => { setBody(draft.body) }, [draft.id, draft.body])

  const isNewsjack = draft.kind === 'newsjack'
  const isWeekly = draft.kind === 'weekly_report'
  const isComment = draft.kind === 'comment_reply'
  // An escalate card carries no draft on purpose: the point is that Mattan
  // answers it himself, so there is nothing to copy.
  const isEscalatedComment = isComment && !draft.body.trim()
  // ...but "on purpose" is not the same as "never". The button writes one
  // through the same gates the pipeline uses, and the card keeps saying whose
  // idea it was.
  const canDraft = canGenerateDraft(draft)
  const onDemand = isComment && draft.context?.drafted_on_demand === true
  const isOutbound = draft.kind === 'comment_outbound'
  // ivan lane cards carry the n8n gate link; risedtc cards are copy-and-hand-post.
  const approveUrl = outboundApproveUrl(draft)
  const where = isNewsjack || isWeekly || isComment || isOutbound ? engineLabel(draft.client_id) : `#${draft.slack_channel}`
  const left = isNewsjack ? expiresIn(draft.context?.expires_at) : null

  async function onApprove() {
    // Outbound comments: two lanes, one kind.
    // ivan lane (approve_url present): the button opens the n8n gate webhook - the
    // five poster gates + jitter own the LinkedIn write, and the tab shows their
    // verdict. risedtc lane (no approve_url): copy + close; Ivan posts it from
    // Mattan's seat by hand. Both double-stamp because no dispatcher exists here.
    if (isOutbound) {
      const ok = await confirm({
        title: approveUrl ? `Send this to the ${where} comment gate?` : `Copy this to post as ${where}?`,
        message: approveUrl
          ? 'Opens the gate link: rate caps, cooldown and jitter still apply before anything posts. The tab shows the verdict.'
          : 'Nothing is posted by the system. The comment goes to your clipboard - paste it under the post from Mattan’s seat.',
        confirmText: approveUrl ? 'Approve & open gate' : 'Approve & copy',
      })
      if (!ok) return
      setBusy(true); setError('')
      try {
        if (approveUrl) {
          window.open(approveUrl, '_blank', 'noopener')
        } else {
          // Copy first: a blocked clipboard leaves the card recoverable.
          await navigator.clipboard.writeText(body)
        }
        await approveWeeklyReport(draft.id, body)
        refresh()
      } catch (e) { setError(errText(e)) }
      finally { setBusy(false) }
      return
    }
    // A comment reply is the one thing in this app that publishes publicly.
    // The edge function re-reads the thread before it writes, so an approve on a
    // comment Mattan already answered clears the card instead of doubling up.
    if (isComment) {
      const ok = await confirm({
        title: isEscalatedComment ? 'Mark this handled?' : `Post this reply as ${where}?`,
        message: isEscalatedComment
          ? 'Nothing is posted. The card clears and you stop being reminded about this comment.'
          : 'Goes live on LinkedIn under their comment, from the client seat. Checks first that they have not already been answered.',
        confirmText: isEscalatedComment ? 'Mark handled' : 'Approve & post',
      })
      if (!ok) return
      setBusy(true); setError('')
      try {
        if (isEscalatedComment) {
          await markCommentHandled(draft.id)
        } else {
          const out = await postCommentReply(draft.id, body)
          if (!out.posted) setError('Mattan already replied to this one, so nothing was posted. Card cleared.')
        }
        refresh()
      } catch (e) { setError(errText(e)) }
      finally { setBusy(false) }
      return
    }
    // Nothing dispatches a weekly report: approving copies the message and closes
    // the card; Ivan pastes it to the client himself.
    if (isWeekly) {
      const ok = await confirm({
        title: 'Copy the message and close this?',
        message: 'Nothing is sent to the client. The message goes to your clipboard and the card clears.',
        confirmText: 'Approve & copy',
      })
      if (!ok) return
      setBusy(true); setError('')
      try {
        // Copy first: if the clipboard is blocked, the card stays put and the
        // message is still recoverable from the textarea.
        await navigator.clipboard.writeText(body)
        await approveWeeklyReport(draft.id, body)
        refresh()
      } catch (e) { setError(errText(e)) }
      finally { setBusy(false) }
      return
    }
    const ok = await confirm({
      title: isNewsjack ? `Take the next slot on ${where}?` : `Post to ${draft.slack_channel}?`,
      message: isNewsjack
        ? 'Writes the post now, then swaps it into the next publish slot. Whatever sits there moves to the next open weekday.'
        : 'The dispatcher posts this to Slack within about 2 minutes.',
      confirmText: isNewsjack ? 'Approve & jump' : 'Approve & send',
    })
    if (!ok) return
    setBusy(true); setError('')
    try { await approveOpsDraft(draft.id, body); refresh() }
    catch (e) { setError(errText(e)) }
    finally { setBusy(false) }
  }

  // No confirm sheet: nothing leaves the building, it fills the textarea above.
  // Takes ~10s (three candidates, every gate on all of them), so the button
  // carries the wait instead of a toast.
  async function onGenerate() {
    setDrafting(true); setError(''); setRefusal([])
    try {
      const out = await generateCommentDraft(draft.id)
      if (out.drafted && out.draft) {
        setBody(out.draft)
        refresh()
      } else {
        setRefusal(out.why?.length ? out.why : ['No draft survived the voice gates. Write this one yourself.'])
        if (out.reason === 'already_answered') refresh()
      }
    } catch (e) { setError(errText(e)) }
    finally { setDrafting(false) }
  }

  async function onDiscard() {
    const ok = await confirm({
      title: 'Discard this one?',
      message: isNewsjack
        ? "It won't be written or scheduled."
        : isWeekly
          ? "The page stays live at its link. You just won't be reminded about this week again."
          : isComment
            ? "The comment stays on the post. You just won't be reminded about it again."
            : isOutbound
              ? 'Nothing gets posted. The draft is dropped for good.'
              : `It won't be posted to ${draft.slack_channel}.`,
      confirmText: 'Discard',
      danger: true,
    })
    if (!ok) return
    setBusy(true); setError('')
    try {
      // Best-effort cancel of the underlying feed row (ivan lane); a failure is
      // fine - the row expires on its own 5-day gate.
      const skip = outboundSkipUrl(draft)
      if (skip) { try { void fetch(skip, { mode: 'no-cors' }) } catch { /* fire and forget */ } }
      await discardOpsDraft(draft.id); refresh()
    }
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
        <span className="ops-chan">{where}</span>
        {left && <span className="ops-replay">{left}</span>}
        <span className="ops-tm">{timeAgo(draft.created_at)}</span>
      </div>
      <ContextLine draft={draft} />
      <textarea
        className="ops-body"
        value={body}
        onChange={e => setBody(e.target.value)}
        disabled={busy || drafting}
        placeholder={canDraft ? 'Write his reply, or press Draft it.' : undefined}
      />
      {isNewsjack && <div className="ops-ctx">Angle the post gets written from, edit before approving.</div>}
      {isWeekly && <div className="ops-ctx">Read the page first. Edit this message, then copy it and send it yourself.</div>}
      {isComment && (
        <div className="ops-ctx">
          {isEscalatedComment
            ? 'No draft on purpose: this one wants Mattan in his own words. Draft it if you want a starting point.'
            : onDemand
              ? 'Drafted on request, so this category never passed the auto gate. Read every word before you post it.'
              : 'Edit it first. Approve posts it live under their comment.'}
        </div>
      )}
      {isOutbound && (
        <div className="ops-ctx">
          {approveUrl
            ? 'A comment on their post, from your seat. Approve opens the gate link - caps and cooldown still apply.'
            : 'A comment on their post, from Mattan’s seat. Approve copies it - you paste it on LinkedIn yourself.'}
        </div>
      )}
      {refusal.length > 0 && (
        <div className="ops-reason">Refused: {refusal.join(' · ')}</div>
      )}
      {error && <div className="ops-err">{error}</div>}
      <div className={canDraft ? 'ops-ac three' : 'ops-ac'}>
        <div className="btn s" onClick={busy || drafting ? undefined : onDiscard}>Discard</div>
        {canDraft && (
          <div className="btn s" onClick={busy || drafting ? undefined : onGenerate}>
            {drafting ? 'Writing…' : 'Draft it'}
          </div>
        )}
        <div className="btn p" onClick={busy || drafting ? undefined : onApprove}>
          {busy
            ? (isNewsjack ? 'Claiming…' : isEscalatedComment ? 'Closing…' : isComment ? 'Posting…' : isOutbound ? (approveUrl ? 'Opening…' : 'Copying…') : isWeekly ? 'Copying…' : 'Sending…')
            : (isNewsjack ? 'Approve & jump' : isEscalatedComment ? 'Mark handled' : isComment ? 'Approve & post' : isOutbound ? (approveUrl ? 'Approve & open gate' : 'Approve & copy') : isWeekly ? 'Approve & copy' : 'Approve & send')}
        </div>
      </div>
    </div>
  )
}

// Read-only row for the Sent/Blocked groups — same shape as the Sends log feed.
function ReadOnlyRow({ draft, reason, working }: { draft: OpsDraft; reason?: string; working?: boolean }) {
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
          <span className="log-nm">
            {draft.slack_channel ? `#${draft.slack_channel}` : engineLabel(draft.client_id)}
          </span>
          {draft.kind === 'newsjack' && draft.context?.slot && (
            <span className="ops-chan">publishes {slotText(draft.context.slot)}</span>
          )}
        </div>
        <div className="log-snip">{draft.body}</div>
        {working && <div className="ops-ctx">{draft.kind === 'newsjack' ? 'Writing the post, then claiming the slot…' : 'Posting…'}</div>}
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
  const [claimingOpen, setClaimingOpen] = useState(true)
  const [sentOpen, setSentOpen] = useState(false)
  const [blockedOpen, setBlockedOpen] = useState(false)
  const rowsRef = useRef<HTMLDivElement>(null)
  const ptr = usePullToRefresh(rowsRef, () => refresh())

  const pending = pendingOps(drafts)
  const claiming = claimingOps(drafts)
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
          <div className="empty">Nothing waiting on you.</div>
        ) : (
          pending.map(d => <PendingCard key={d.id} draft={d} refresh={refresh} />)
        )}
        <Section title="Working" count={claiming.length} open={claimingOpen} onToggle={() => setClaimingOpen(o => !o)}>
          <div style={{ padding: '0 16px' }}>
            {claiming.map(d => <ReadOnlyRow key={d.id} draft={d} working />)}
          </div>
        </Section>
        <Section title="Done" count={sent.length} open={sentOpen} onToggle={() => setSentOpen(o => !o)}>
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
