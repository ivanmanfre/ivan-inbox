import { useEffect, useId, useState } from 'react'
import './brain-account.css'
export type OutlierLabel = { verdict: 'keep' | 'drop'; reason: string | null; version: string; canEdit?: boolean; undoInvocationId?: string | null }
export function OutlierLabelControls({ identity, label, loading = false, readError = null, onSave, onUndo }: {
  identity: string; label: OutlierLabel | null; loading?: boolean; readError?: string | null
  onSave: (verdict: 'keep' | 'drop', reason: string | null) => Promise<OutlierLabel>
  onUndo: (version: string) => Promise<OutlierLabel | null>
}) {
  const id = useId()
  const [saved, setSaved] = useState(label)
  const [reason, setReason] = useState(label?.reason ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { setSaved(label); setReason(label?.reason ?? ''); setError(null) }, [identity, label])
  const act = async (verdict: 'keep' | 'drop') => {
    if (busy || loading || readError) return
    setBusy(true); setError(null)
    try { const result = await onSave(verdict, reason.trim() || null); setSaved(result); setReason(result.reason ?? '') }
    catch (e) { setError(e instanceof Error ? e.message : 'The label could not be saved.') }
    finally { setBusy(false) }
  }
  const undo = async () => {
    if (!saved || busy || loading || readError) return
    setBusy(true); setError(null)
    try { const result = await onUndo(saved.version); setSaved(result); setReason(result?.reason ?? '') }
    catch (e) { setError(e instanceof Error ? e.message : 'The label could not be undone.') }
    finally { setBusy(false) }
  }
  return <div className="cn-brain-labels" aria-label="Your outlier label">
    <label htmlFor={id}>Reason (one word, optional)</label><input id={id} value={reason} maxLength={40} disabled={busy || loading || !!readError || saved?.canEdit === false} onChange={e => setReason(e.target.value)} />
    <div className="cn-brain-label-buttons"><button type="button" aria-pressed={saved?.verdict === 'keep'} disabled={busy || loading || !!readError || saved?.canEdit === false} onClick={() => void act('keep')}>Keep</button><button type="button" aria-pressed={saved?.verdict === 'drop'} disabled={busy || loading || !!readError || saved?.canEdit === false} onClick={() => void act('drop')}>Drop</button>{saved?.undoInvocationId && <button type="button" disabled={busy || loading || !!readError || saved?.canEdit === false} onClick={() => void undo()}>Undo label</button>}</div>
    {readError || error ? <p role="alert">{readError || error}</p> : <p role="status">{loading ? 'Reading your label…' : busy ? 'Saving your label…' : saved?.canEdit === false ? 'Label belongs to another operator.' : saved ? `${saved.verdict === 'keep' ? 'Keep' : 'Drop'} saved. Save idea stays separate.` : 'Your label helps check future picks.'}</p>}
  </div>
}
