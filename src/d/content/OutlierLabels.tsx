import { useEffect, useMemo, useState } from 'react'
import { fetchOutlierLabels, setOutlierLabel, undoOutlierLabel, type OutlierLabelsData, type OutlierRef, type HumanOutlierLabel } from '../../lib/brainAccount'
import type { Lane } from './model'
import { OutlierLabelControls } from './OutlierLabelControls'
export type OutlierLabelSource = { platform: 'linkedin' | 'x'; post_id: string }
export function useOutlierLabels(lane: Lane, sources: OutlierLabelSource[] | null) {
  const [data, setData] = useState<OutlierLabelsData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const key = sources == null ? null : JSON.stringify(sources.map(r => ({ platform: r.platform, post_ref: r.post_id })))
  const refs = useMemo<OutlierRef[] | null>(() => key == null ? null : JSON.parse(key) as OutlierRef[], [key])
  useEffect(() => {
    let live = true; const controller = new AbortController()
    setData(null); setError(null)
    if (refs != null) void fetchOutlierLabels(lane, refs, controller.signal).then(r => { if (live) setData(r) }).catch(e => { if (live) setError(e instanceof Error ? e.message : 'Could not read your outlier labels.') })
    return () => { live = false; controller.abort() }
  }, [lane, refs, tick])
  const receive = (label: HumanOutlierLabel | null, ref: OutlierRef, calibration: OutlierLabelsData['calibration']) => setData(prev => {
    if (!prev || prev.client !== lane) return prev
    return { ...prev, calibration, rows: [...prev.rows.filter(r => r.platform !== ref.platform || r.post_ref !== ref.post_ref), ...(label ? [label] : [])] }
  })
  const control = (source: OutlierLabelSource) => {
    const ref: OutlierRef = { platform: source.platform, post_ref: source.post_id }
    const label = data?.client === lane ? data.rows.find(r => r.platform === ref.platform && r.post_ref === ref.post_ref) ?? null : null
    return <OutlierLabelControls key={`${lane}:${source.platform}:${source.post_id}`} identity={`${lane}:${source.platform}:${source.post_id}`} label={label} loading={!data && !error} readError={error} onSave={async (verdict, reason) => {
      const result = await setOutlierLabel(lane, ref, verdict, reason)
      if (!result.label) throw new Error('The saved label has no durable receipt.')
      receive(result.label, ref, result.calibration)
      return result.label
    }} onUndo={async version => {
      if (!label || label.version !== version) throw new Error('The label changed. Read your labels again before Undo.')
      const result = await undoOutlierLabel(lane, label)
      receive(result.label, ref, result.calibration)
      return result.label
    }} />
  }
  const summary = refs == null ? null : error ? <p className="cn-brain-notice" role="alert">Your labels are unavailable: {error} <button type="button" className="cn-quiet-link" onClick={() => setTick(t => t + 1)}>Read labels again</button></p> : !data ? <p className="cn-brain-note">Reading your outlier labels…</p> : <p className="cn-brain-note" role="status">{data.calibration.state === 'waiting_for_labels' ? `Waiting for labels (${data.calibration.labelN}/30).` : `${data.calibration.state === 'review_required' ? 'Calibration awaits review' : data.calibration.state === 'running' ? 'Calibration running' : 'Calibration queued'} · ${data.calibration.labelN} labels.`} {data.calibration.state === 'review_required' && !data.calibration.runnerReady ? 'Automatic calibration is unavailable. Your labels are saved for review.' : data.calibration.state === 'waiting_for_labels' ? 'Only your own Keep and Drop choices count.' : data.calibration.reason}</p>
  return { control, summary }
}
