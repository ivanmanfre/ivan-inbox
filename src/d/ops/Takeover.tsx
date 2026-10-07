import { useEffect, useState } from 'react'
import {
  approveConversationTakeover, discardConversationTakeover, fetchConversationTakeoverReadiness,
  TAKEOVER_SENDING_HELD, type OpsDraft,
} from '../../lib/ops'
import { TAKEOVER_CONSEQUENCE } from '../../wb/ops/ConversationTakeoverCard'
import { useDConfirm } from '../ui/confirm'
import { Key } from '../ui/Key'
import { Mono } from './CardContext'
import { ago } from './model'

// A conversation takeover (none has ever been raised; drawn so the first one
// is actionable). Same gates as today's card: readiness RPC, evidence present
// and unexpired, opener at most 400 characters. Same writes and confirms.

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function TakeoverCard({ d, refresh, pos, onActed }: { d: OpsDraft; refresh: () => void; pos: string; onActed?: (id: string, verb: string) => void }) {
  const confirm = useDConfirm()
  const c = d.context ?? {}
  const hash = typeof c.proposal_hash === 'string' ? c.proposal_hash : ''
  const [body, setBody] = useState(d.body)
  const [busy, setBusy] = useState<'approve' | 'skip' | null>(null)
  const [err, setErr] = useState('')
  const [ready, setReady] = useState('')
  useEffect(() => { setBody(d.body); setErr('') }, [d.id, d.body])
  useEffect(() => {
    let live = true
    setReady('')
    fetchConversationTakeoverReadiness(d.id).then(ok => { if (live && ok) setReady(`${d.id}:${hash}`) }).catch(() => { /* stays held */ })
    return () => { live = false }
  }, [d.id, hash])
  const sendingReady = ready === `${d.id}:${hash}`
  const expMs = typeof c.expires_at === 'string' ? Date.parse(c.expires_at) : NaN
  const viewed = typeof c.viewed_at === 'string' ? c.viewed_at : ''
  const scoreOk = typeof c.icp_score === 'number' && Number.isFinite(c.icp_score)
  const blocked = !scoreOk || !Number.isFinite(Date.parse(viewed)) || !Number.isFinite(expMs) || expMs <= Date.now()
  const who = typeof c.prospect_name === 'string' && c.prospect_name ? c.prospect_name : 'this viewer'

  async function approve() {
    if (!sendingReady) return
    if (!(await confirm({ title: `Send this opener to ${who}?`, message: TAKEOVER_CONSEQUENCE, confirmText: 'Approve takeover' }))) return
    onActed?.(d.id, 'Approved')
    setBusy('approve'); setErr('')
    try { await approveConversationTakeover(d.id, hash, body); refresh() } catch (e) { setErr(errText(e)) } finally { setBusy(null) }
  }
  async function skip() {
    if (!(await confirm({ title: 'Skip this takeover?', message: 'Drops this proposal. Nothing is sent and the conversation stays with you.', confirmText: 'Skip', danger: true }))) return
    onActed?.(d.id, 'Discarded')
    setBusy('skip'); setErr('')
    try { await discardConversationTakeover(d.id, hash); refresh() } catch (e) { setErr(errText(e)) } finally { setBusy(null) }
  }

  return (
    <section className="op-card" data-card={d.id} data-kind={d.kind}>
      <header className="op-ch"><span className="op-eb">Conversation takeover</span><span className="op-ew">Qualified viewer · {ago(d.created_at)} · {pos}</span></header>
      <div className="op-cb">
        <div className="op-ctx">
          <div className="op-who"><b>{who}</b>{typeof c.company === 'string' && <small>{c.company}</small>}</div>
          <Mono parts={[scoreOk ? `${c.icp_score} ICP score` : 'no ICP score', viewed ? `viewed ${ago(viewed)}` : 'no viewer time',
            typeof c.linkedin_url === 'string' && <a className="op-lk" href={c.linkedin_url} target="_blank" rel="noreferrer">LinkedIn</a>]} />
          <div className="op-note">Qualified viewer will be taken over by the conversational AI.</div>
          {!sendingReady && <div className="op-ban">{TAKEOVER_SENDING_HELD}</div>}
          {blocked && <div className="op-ban op-ban-warn">{expMs <= Date.now() ? 'This proposal expired. Refresh Ops for a current draft.' : 'Eligibility evidence is incomplete. Refresh Ops before approving.'}</div>}
        </div>
        <div className="op-rep">
          <label className="op-tape">
            <span className="op-tm"><span>Opener</span><span>{body.length}/400 · edit the exact opener that will be sent</span></span>
            <textarea rows={3} maxLength={400} value={body} disabled={busy !== null} onChange={e => setBody(e.target.value)} />
          </label>
          {err && <div className="op-err" role="alert">{err}</div>}
          <div className="op-keys">
            <div className="op-k"><Key verb="takeover-skip" disabled={busy !== null} onClick={() => void skip()}>Skip</Key><small>Nothing is sent. It stays with you.</small></div>
            <div className="op-k op-kp"><Key primary verb="takeover-approve" disabled={busy !== null || !body.trim() || body.length > 400 || !hash || blocked || !sendingReady} onClick={() => void approve()}>Approve takeover</Key><small>{TAKEOVER_CONSEQUENCE}</small></div>
          </div>
        </div>
      </div>
    </section>
  )
}
