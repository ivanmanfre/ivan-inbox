import { useState } from 'react'
import { ClientRpcError, decideIdea, deleteIdea, ideaDecidable, IDEA_NOT_OURS } from '../../lib/content'
import { decideClientIdea, quoteLabel } from '../../lib/clientIdeas'
import { contributionsLine, type IdeaScoreRead, type IdeaScoreRow } from '../../lib/ideaScores'
import { label } from '../../lib/labels'
import { absTime } from '../../exp/v2c/fmt'
import { useDConfirm } from '../ui/confirm'
import { Key } from '../ui/Key'
import { useToast } from '../ui/toast'
import { LANE_NAME, OWNER, type Lane } from './model'
import { linkOf, type IdeaItem } from './ideaModel'
import { SourceBadge, ideaOutlierSource } from './SourceBadge'

// One idea, read and decided. Ivan's bank goes through today's edge function
// (lm-curator-decide: approve fires the promote run, reject archives, with the
// optional note as the reason); a client's bank through today's gated RPC
// (operator_approve_idea). Approve and Reject ask nothing, as today; Delete
// (Ivan's bank only, as today) asks once.
/** Today's closed-row outlier line: "Outlier 0.82 (unvalidated) · Carousel · contrarian +0.3". */
export function outlierLine(row: IdeaScoreRow | undefined, unvalidated: boolean): string | null {
  if (!row || row.score === null) return null
  const c = contributionsLine(row)
  return `Outlier ${row.score.toFixed(2)}${unvalidated ? ' (unvalidated)' : ''}${row.recommended_format ? ` · ${label(row.recommended_format)}` : ''}${c ? ` · ${c}` : ''}`
}

const BANK: Record<Lane, string> = { ivan: 'Your idea bank', risedtc: 'Mattan’s ideas', arch: 'Davorin’s ideas' }

export function IdeaDetail({ it, onDone, compact, scores }: { it: IdeaItem; onDone: (id: string) => void; compact?: boolean; scores?: IdeaScoreRead }) {
  const confirm = useDConfirm()
  const toast = useToast()
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const ours = !it.ivan || ideaDecidable(it.ivan)

  const run = async (kind: 'approve' | 'reject' | 'delete') => {
    if (busy) return
    if (kind === 'delete' && !await confirm({ title: 'Delete this idea?', message: 'It is removed from the bank for good, or archived if the database refuses the delete.', confirmText: 'Delete', verb: 'confirm', danger: true })) return
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
    <section className="cn-idm" aria-label="Idea" data-idea-detail={it.id}>
      {!compact && <div className="cn-dwh" style={{ padding: 0, border: 0 }}>
        <div className="cn-who"><b style={{ whiteSpace: 'normal' }}>{it.title}</b><small>{BANK[it.lane]}{it.src ? ` · ${it.src}` : ''}{it.age ? ` · ${it.age} ago` : ''}</small></div>
      </div>}
      {ideaOutlierSource(it) && <p className="cn-cbline"><SourceBadge src={ideaOutlierSource(it)} /></p>}
      <IdeaFacts it={it} scores={scores} />
      {!it.outlier && !it.generating && it.lane === 'ivan' && (
        <input className="cn-note" value={note} onChange={e => setNote(e.target.value)} placeholder="Optional note, steers the curator, and is logged as the reject reason" aria-label="Note" />
      )}
      {!ours && <p className="cn-say cn-bad">{IDEA_NOT_OURS}</p>}
      {err && <p className="cn-say cn-bad" role="alert">{err}</p>}
      {!it.outlier && !it.generating && <div className="cn-acts">
        {it.lane === 'ivan' && <Key verb="idea-delete" onClick={() => run('delete')} disabled={busy}>Delete</Key>}
        <Key verb="idea-reject" onClick={() => run('reject')} disabled={busy || !ours}>Reject</Key>
        <Key primary verb="idea-approve" onClick={() => run('approve')} disabled={busy || !ours} sub="starts the draft">Approve</Key>
      </div>}
      {it.generating && <p className="cn-say">Added ✓ · The draft will appear in Now.</p>}
      {it.outlier?.url && <a href={it.outlier.url} target="_blank" rel="noreferrer" data-verb="source">Open source post ↗</a>}
      {!it.outlier && !it.generating && <p className="cn-foot" style={{ padding: 0 }}>
        {it.lane === 'ivan'
          ? 'Approve fires the promote run and the draft shows up in Generating. Reject archives the idea.'
          : `Approve hands it to generation for ${LANE_NAME[it.lane]}; the draft lands in review on our side and nothing reaches ${OWNER[it.lane]}. Reject archives it.`}
      </p>}
    </section>
  )
}

/** Everything today's idea card says once it is open (ideas.tsx IdeaCard / ClientIdeaCard). */
function IdeaFacts({ it, scores }: { it: IdeaItem; scores?: IdeaScoreRead }) {
  const i = it.ivan, c = it.client
  void scores
  const quote = it.evidenceQuote ? c ? quoteLabel(c) || 'Stored source quote' : 'Stored source quote' : null
  const src = linkOf(i?.source_ref ?? c?.source_ref)
  const chips = i
    ? [i.content_type ? label(i.content_type) : 'no content type', i.ivan_engaged === true ? 'engaged' : null].filter(Boolean)
    : c ? [c.pillar ? label(c.pillar) : null, c.format ? label(c.format) : null, c.funnel_stage ? label(c.funnel_stage) : 'no funnel stage'].filter(Boolean) : []
  return (
    <div className="cn-tape">
      {chips.length > 0 && <p className="cn-ichips">{chips.map(x => <span key={x as string}>{x}</span>)}</p>}
      {i?.raw_topic && i.raw_topic !== i.normalized_topic && <p className="cn-dim">{i.raw_topic}</p>}
      {c?.reuse_of && (
        <p>Reuse of a winner{c.eligible_at ? `, eligible since ${c.eligible_at.slice(0, 10)}` : ''}. Keep the idea and the hook shape, update the numbers and examples.</p>
      )}
      <small>{quote ? 'The line from the call' : 'Source notes'}{it.format ? ` · ${it.format}` : ''}</small>
      {quote && it.evidenceQuote ? <blockquote className="cn-quote">{it.evidenceQuote}<small>{quote}</small></blockquote>
        : <p>{it.why || it.proof || it.src || 'Idea bank'}</p>}
      {it.angle && <><small>{c ? 'Hook' : 'Angle'}</small><p>{it.angle}</p></>}
      {(src || i?.slack_permalink) && (
        <p className="cn-ilinks">
          {src && <a href={src} target="_blank" rel="noreferrer" data-verb="source">Source ↗</a>}
          {i?.slack_permalink && <a href={i.slack_permalink} target="_blank" rel="noreferrer" data-verb="slack">Slack ↗</a>}
        </p>
      )}
      {i?.scored_at && <p className="cn-dim">Scored {absTime(i.scored_at)}</p>}
    </div>
  )
}
