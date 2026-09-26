import { useEffect, useState } from 'react'
import { approveConversationTakeover, discardConversationTakeover, fetchConversationTakeoverReadiness, TAKEOVER_SENDING_HELD, type OpsDraft } from '../../lib/ops'
import { Banner, Button, Textarea } from '../../ds'
import { Group, KV, Sep } from '../kit'
import { useConfirm } from '../chrome/ConfirmSheet'
import './ops.css'

export const TAKEOVER_CONSEQUENCE = 'Approving sends this opener and lets the agent handle replies, reactions, relevant post likes and resource sharing for this conversation. You can pause or take over in Inbox.'

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function timeAgo(iso: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000))
  if (seconds < 60) return 'now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`
}

export function ConversationTakeoverCard({ draft, refresh }: { draft: OpsDraft; refresh: () => void }) {
  const [body, setBody] = useState(draft.body)
  const [busy, setBusy] = useState<'approve' | 'skip' | null>(null)
  const [error, setError] = useState('')
  const [readyDraft, setReadyDraft] = useState('')
  // Both verbs ask first (blueprint v3 "Confirms added"): approve sends the
  // opener and hands the thread to the agent; skip drops the proposal for good.
  const confirm = useConfirm()
  const sendingReady = readyDraft === `${draft.id}:${draft.context?.proposal_hash ?? ''}`
  const ctx = draft.context
  const hash = typeof ctx?.proposal_hash === 'string' ? ctx.proposal_hash : ''
  const viewedMs = typeof ctx?.viewed_at === 'string' ? Date.parse(ctx.viewed_at) : NaN
  const expiresMs = typeof ctx?.expires_at === 'string' ? Date.parse(ctx.expires_at) : NaN
  const scoreValid = typeof ctx?.icp_score === 'number' && Number.isFinite(ctx.icp_score)
  const viewedValid = Number.isFinite(viewedMs)
  const expiresValid = Number.isFinite(expiresMs)
  const expired = expiresValid && expiresMs <= Date.now()
  const viewedAt = viewedValid
    ? new Date(viewedMs).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })
    : 'Missing viewer time'
  const score = scoreValid ? `${ctx.icp_score} ICP score` : 'Missing ICP score'
  const evidenceBlocked = !scoreValid || !viewedValid || !expiresValid || expired

  useEffect(() => { setBody(draft.body); setError('') }, [draft.id, draft.body])

  useEffect(() => {
    let current = true
    setReadyDraft('')
    fetchConversationTakeoverReadiness(draft.id)
      .then(ready => { if (current && ready) setReadyDraft(`${draft.id}:${hash}`) })
      .catch(() => { /* Keep approval held when readiness cannot be verified. */ })
    return () => { current = false }
  }, [draft.id, hash])

  async function approve() {
    if (!sendingReady) return
    const who = typeof ctx?.prospect_name === 'string' && ctx.prospect_name ? ctx.prospect_name : 'this viewer'
    if (!(await confirm({
      title: `Send this opener to ${who}?`,
      message: TAKEOVER_CONSEQUENCE,
      confirmText: 'Approve takeover',
    }))) return

    setBusy('approve'); setError('')
    try {
      await approveConversationTakeover(draft.id, hash, body)
      refresh()
    } catch (e) { setError(errText(e)) }
    finally { setBusy(null) }
  }

  async function skip() {
    if (!(await confirm({
      title: 'Skip this takeover?',
      message: 'Drops this proposal. Nothing is sent and the conversation stays with you.',
      confirmText: 'Skip',
      danger: true,
    }))) return
    setBusy('skip'); setError('')
    try { await discardConversationTakeover(draft.id, hash); refresh() }
    catch (e) { setError(errText(e)) }
    finally { setBusy(null) }
  }

  const rows: Array<[React.ReactNode, React.ReactNode]> = [
    ['Person', [ctx?.prospect_name, ctx?.company].filter(Boolean).join(' · ') || 'Qualified viewer'],
    ['Evidence', `${score} · ${viewedAt}`],
  ]
  if (ctx?.linkedin_url) rows.push(['Profile', <a className="a-link" href={String(ctx.linkedin_url)} target="_blank" rel="noreferrer">Open LinkedIn</a>])

  return (
    <Group
      className="a-ops-card a-ops-takeover"
      label="CONVERSATION TAKEOVER"
      tail={<>Qualified viewer<Sep />{timeAgo(draft.created_at)}</>}
      foot={(
        <div className="a-ops-decide">
          {error && <Banner tone="urgent">{error}</Banner>}
          <div className="a-ops-acts">
            <div className="a-ops-act">
              <Button variant="quiet" busy={busy === 'skip'} disabled={busy !== null} onClick={skip}>Skip</Button>
              <span className="a-ops-cons a-meta">Drops this proposal. Nothing is sent and the conversation stays with you.</span>
            </div>
            <div className="a-ops-act a-ops-act-p">
              <Button variant="primary" busy={busy === 'approve'} disabled={busy !== null || !body.trim() || body.length > 400 || !hash || evidenceBlocked || !sendingReady} onClick={approve}>Approve takeover</Button>
              <span className="a-ops-cons a-meta">{TAKEOVER_CONSEQUENCE}</span>
            </div>
          </div>
        </div>
      )}
      pad
    >
      <div className="a-stack" data-tight>
        <div className="a-ops-takeover-title">Qualified viewer will be taken over by the conversational AI</div>
        <KV rows={rows} />
        {!sendingReady && <Banner tone="attention">{TAKEOVER_SENDING_HELD}</Banner>}
        {evidenceBlocked && <Banner tone="attention">{expired ? 'This proposal expired. Refresh Ops for a current draft.' : 'Eligibility evidence is incomplete. Refresh Ops before approving.'}</Banner>}
        <Textarea
          label="Opener"
          className="a-ops-body"
          value={body}
          maxLength={400}
          onChange={e => setBody(e.target.value)}
          disabled={busy !== null}
          hint={`${body.length}/400 · Edit the exact opener that will be sent.`}
        />
      </div>
    </Group>
  )
}
