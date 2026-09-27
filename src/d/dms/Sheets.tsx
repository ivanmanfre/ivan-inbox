// Two sheets from the ⋯ menu: Context (fit, scan, your note + the coordinator's lane lines) and
// Conversation agent (owner, mode, state; Pause / Resume / Stop contact). Reads and writes are
// today's: fetchProspectContext / fetchScan / saveOperatorNote (lib/context) and
// conversation_agent_cards / conversation_agent_control (wb/dms/conversationAgentData).
import { useEffect, useState } from 'react'
import { fetchProspectContext, fetchScan, saveOperatorNote, type ProspectContext, type ScanInfo } from '../../lib/context'
import type { Thread } from '../../lib/inbox'
import { supabase } from '../../lib/supabase'
import { controlConversationAgent, fetchConversationAgentCards, modeCopy, ownerCopy, type ConversationAgentCard, type ConversationAgentCommand } from '../../wb/dms/conversationAgentData'
import { Key } from '../ui/Key'
import { Sheet } from '../ui/Sheet'
import { Failed, Skeleton } from '../ui/states'
import { useToast } from '../ui/toast'
import { companyStopLine, inviteArmLine } from './nextLine'
import { dayMonth } from './threadRows'

async function readVertical(pid: string): Promise<string | null> {
  const { data, error } = await supabase.from('outreach_prospects')
    .select('copy_vertical:enrichment_data->>copy_vertical,vertical:enrichment_data->>vertical').eq('id', pid).single()
  if (error) throw error
  const r = data as { copy_vertical: string | null; vertical: string | null }
  return r.copy_vertical || r.vertical || null
}

export function ContextSheet({ t, all, onClose }: { t: Thread; all: readonly Thread[]; onClose: () => void }) {
  const toast = useToast()
  const [ctx, setCtx] = useState<ProspectContext | null>(null)
  const [scan, setScan] = useState<ScanInfo | null>(null)
  const [vertical, setVertical] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [n, setN] = useState(0)
  useEffect(() => {
    let live = true
    setFailed(false); setCtx(null)
    fetchProspectContext(t.prospect_id).then(async c => {
      if (!live) return
      setCtx(c); setNote(c.operator_note ?? '')
      const s = await fetchScan(t.prospect_name, c.company_domain).catch(() => null)
      if (live) setScan(s)
    }).catch(() => { if (live) setFailed(true) })
    if (t.client_id === 'arch' && t.lane === 'company_expansion') readVertical(t.prospect_id).then(v => { if (live) setVertical(v) }).catch(() => {})
    return () => { live = false }
  }, [t.prospect_id, t.prospect_name, t.client_id, t.lane, n])
  const arm = inviteArmLine(t, vertical)
  const stop = companyStopLine(t, all)
  const dirty = ctx != null && note.trim() !== (ctx.operator_note ?? '').trim()
  const save = async () => {
    setSaving(true)
    try { await saveOperatorNote(t.prospect_id, note); setCtx(c => (c ? { ...c, operator_note: note.trim() || null } : c)); toast.show({ message: 'Note saved.', sub: 'The drafters read it on their next pass.' }) }
    catch (e) { toast.show({ message: `Not saved: ${e instanceof Error ? e.message : String(e)}`, tone: 'failed' }) }
    finally { setSaving(false) }
  }
  return (
    <Sheet open onClose={onClose} title={t.prospect_name} sub={[t.prospect_company, 'Context'].filter(Boolean).join(' · ')}
      foot={<><Key onClick={onClose} verb="cancel">Close</Key><Key primary disabled={!dirty || saving} onClick={save} verb="note-save">{saving ? 'Saving…' : 'Save note'}</Key></>}>
      <div className="dm-ctx">
        {failed ? <Failed what="this person's context" onRetry={() => setN(x => x + 1)} /> : !ctx ? <Skeleton lines={5} /> : <>
          {(arm || stop) && <div className="dm-ctx-lines">{arm && <p>{arm}</p>}{stop && <p>{stop}</p>}</div>}
          <dl>
            <div><dt>Fit</dt><dd>{ctx.icp_score != null ? `${ctx.icp_score} / 10` : 'not scored'}{ctx.icp_reasoning ? <small>{ctx.icp_reasoning}</small> : null}</dd></div>
            <div><dt>Role</dt><dd>{ctx.title || ctx.headline || 'unknown'}</dd></div>
            <div><dt>Where</dt><dd>{[ctx.location, ctx.industry].filter(Boolean).join(' · ') || 'unknown'}</dd></div>
            <div><dt>Scan</dt><dd>{scan ? <>{scan.report_url ? <a className="d-link" href={scan.report_url} target="_blank" rel="noreferrer">{scan.company_slug}</a> : scan.company_slug}{scan.automation_grade ? ` · grade ${scan.automation_grade}` : ''}{scan.completed_at ? ` · ${dayMonth(scan.completed_at)}` : ''}</> : 'no completed scan'}</dd></div>
            <div><dt>Sequence</dt><dd>{[ctx.connection_sent_at && `invited ${dayMonth(ctx.connection_sent_at)}`, ctx.connected_at && `connected ${dayMonth(ctx.connected_at)}`, ctx.dm_count != null && `${ctx.dm_count} messages`, ctx.reply_count != null && `${ctx.reply_count} replies`].filter(Boolean).join(' · ') || 'nothing recorded'}</dd></div>
            {ctx.notes && <div><dt>System notes</dt><dd>{ctx.notes}</dd></div>}
          </dl>
          <label className="dm-ctx-note"><span>Your note</span>
            <textarea value={note} rows={3} onChange={e => setNote(e.target.value)} placeholder="Something the drafters should know about this person" />
          </label>
        </>}
      </div>
    </Sheet>
  )
}

export function AgentSheet({ t, onClose }: { t: Thread; onClose: () => void }) {
  const toast = useToast()
  const [card, setCard] = useState<ConversationAgentCard | null | undefined>(undefined)
  const [why, setWhy] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const load = () => {
    setCard(undefined); setWhy(null)
    fetchConversationAgentCards().then(f => {
      if (f.kind !== 'ready') { setWhy(f.reason); setCard(null); return }
      setCard(f.cards.find(c => c.prospect_id === t.prospect_id) ?? null)
    }).catch(e => { setWhy(e instanceof Error ? e.message : String(e)); setCard(null) })
  }
  useEffect(load, [t.prospect_id]) // eslint-disable-line react-hooks/exhaustive-deps
  const run = async (cmd: ConversationAgentCommand) => {
    if (!card) return
    setBusy(true)
    try { await controlConversationAgent(card.thread_id, cmd, card.revision); toast.show({ message: cmd === 'stop' ? `Stopped all contact with ${t.prospect_name}.` : `Agent ${cmd === 'pause' ? 'paused' : 'resumed'}.` }); load() }
    catch (e) { toast.show({ message: e instanceof Error ? e.message : String(e), tone: 'failed' }) }
    finally { setBusy(false) }
  }
  return (
    <Sheet open onClose={onClose} title="Conversation agent" sub={t.prospect_name}
      foot={card ? <>
        {card.state === 'paused' ? <Key verb="agent-resume" disabled={busy} onClick={() => run('resume')}>Resume</Key> : <Key verb="agent-pause" disabled={busy || card.state !== 'active'} onClick={() => run('pause')}>Pause</Key>}
        <Key verb="agent-stop" disabled={busy || card.state === 'stopped'} onClick={() => run('stop')} className="dm-key-warn">Stop contact</Key>
      </> : undefined}>
      <div className="dm-ctx">
        {card === undefined ? <Skeleton lines={3} /> : card === null
          ? <p className="dm-meta">{why ?? `The agent is not on this conversation. Enrolling and reviewing agent actions stay in today's DMs page for now.`}</p>
          : <dl>
            <div><dt>Owner</dt><dd>{ownerCopy(card.owner)}</dd></div>
            <div><dt>Mode</dt><dd>{modeCopy(card.mode)}</dd></div>
            <div><dt>State</dt><dd>{card.state}{card.pause_reason ? ` · ${card.pause_reason.replace(/_/g, ' ')}` : ''}</dd></div>
            <div><dt>Next</dt><dd>{card.next_action ? card.next_action.kind : 'nothing planned'}</dd></div>
          </dl>}
      </div>
    </Sheet>
  )
}
