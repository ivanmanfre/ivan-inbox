import { useState } from 'react'
import { ClientRpcError, decideIdea, deleteIdea, ideaDecidable, IDEA_NOT_OURS } from '../../lib/content'
import { decideClientIdea } from '../../lib/clientIdeas'
import { useDConfirm } from '../ui/confirm'
import { Key } from '../ui/Key'
import { useToast } from '../ui/toast'
import { LANE_NAME, OWNER, type Lane } from './model'
import { scoreText, type IdeaItem } from './ideaModel'

// One idea, read and decided. Ivan's bank goes through today's edge function
// (lm-curator-decide: approve fires the promote run, reject archives, with the
// optional note as the reason); a client's bank through today's gated RPC
// (operator_approve_idea). Approve and Reject ask nothing, as today; Delete
// (Ivan's bank only, as today) asks once.
const BANK: Record<Lane, string> = { ivan: 'Your idea bank', risedtc: 'Mattan’s ideas', arch: 'Davorin’s ideas' }

export function IdeaDetail({ it, onDone, compact }: { it: IdeaItem; onDone: (id: string) => void; compact?: boolean }) {
  const confirm = useDConfirm()
  const toast = useToast()
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const ours = !it.ivan || ideaDecidable(it.ivan)

  const run = async (kind: 'approve' | 'reject' | 'delete') => {
    if (busy) return
    if (kind === 'delete' && !await confirm({ title: 'Delete this idea?', message: 'It is removed from the bank for good, or archived if the database refuses the delete.', confirmText: 'Delete', verb: 'confirm' })) return
    setBusy(true); setErr('')
    try {
      if (it.lane === 'ivan' && it.ivan) {
        if (kind === 'delete') await deleteIdea(it.id)
        else await decideIdea(it.ivan, kind, note)
      } else {
        await decideClientIdea(it.id, kind === 'approve' ? 'approved' : 'rejected')
      }
      toast.show({
        message: kind === 'approve' ? 'Approved. The draft starts generating.' : kind === 'reject' ? 'Rejected. The idea is archived.' : 'Deleted.',
        sub: it.lane === 'ivan' ? undefined : `Nothing reached ${OWNER[it.lane]}; the draft lands in review, internal.`,
      })
      setNote('')
      onDone(it.id)
    } catch (e) {
      setErr(e instanceof ClientRpcError || e instanceof Error ? e.message : `Could not ${kind} it.`)
    } finally { setBusy(false) }
  }

  return (
    <section className="cn-idm" aria-label="Idea">
      {!compact && <div className="cn-dwh" style={{ padding: 0, border: 0 }}>
        <div className="cn-av">{scoreText(it.score)}</div>
        <div className="cn-who"><b style={{ whiteSpace: 'normal' }}>{it.title}</b><small>{BANK[it.lane]}{it.src ? ` · ${it.src}` : ''}{it.age ? ` · ${it.age} ago` : ''}</small></div>
      </div>}
      {it.parts.length > 0 && (
        <div className="cn-parts">{it.parts.map(([k, v]) => <div key={k}><small>{k}</small>{Math.round(v * 10) / 10}</div>)}</div>
      )}
      <div className="cn-tape">
        <small>Why it scored{it.format ? ` · ${it.format}` : ''}</small>
        <p>{it.why || 'The scorer left no reason on this row.'}</p>
        {it.angle && <><small>Angle</small><p>{it.angle}</p></>}
      </div>
      {it.lane === 'ivan' && (
        <input className="cn-note" value={note} onChange={e => setNote(e.target.value)} placeholder="Optional note, steers the curator, and is logged as the reject reason" aria-label="Note" />
      )}
      {!ours && <p className="cn-say cn-bad">{IDEA_NOT_OURS}</p>}
      {err && <p className="cn-say cn-bad" role="alert">{err}</p>}
      <div className="cn-acts">
        {it.lane === 'ivan' && <Key verb="idea-delete" onClick={() => run('delete')} disabled={busy}>Delete</Key>}
        <Key verb="idea-reject" onClick={() => run('reject')} disabled={busy || !ours}>Reject</Key>
        <Key primary verb="idea-approve" onClick={() => run('approve')} disabled={busy || !ours} sub="starts the draft">Approve</Key>
      </div>
      <p className="cn-foot" style={{ padding: 0 }}>
        {it.lane === 'ivan'
          ? 'Approve fires the promote run and the draft shows up in Generating. Reject archives the idea.'
          : `Approve hands it to generation for ${LANE_NAME[it.lane]}; the draft lands in review on our side and nothing reaches ${OWNER[it.lane]}. Reject archives it.`}
      </p>
    </section>
  )
}
