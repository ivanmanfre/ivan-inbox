import { useEffect, useState } from 'react'
import { ANNA_BOOKING_LINE, ANNA_BOOKING_URL, fetchAnnaScan, requestAnnaScan, type AnnaScanStatus } from '../../lib/annaReplies'
import { Btn } from '../ui/Key'

export function AnnaTools({ prospectId, onInsert, refresh }: {
  prospectId: string; onInsert: (text: string) => void; refresh?: () => void | Promise<void>
}) {
  const [scan, setScan] = useState<AnnaScanStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [version, setVersion] = useState(0)
  useEffect(() => {
    let live = true
    setLoading(true); setScan(null); setError(null)
    const load = () => fetchAnnaScan(prospectId).then(value => { if (live) { setScan(value); setError(null) } })
      .catch(() => { if (live) setError('Scan status could not be loaded.') }).finally(() => { if (live) setLoading(false) })
    void load()
    const timer = window.setInterval(() => { void load() }, 30_000)
    return () => { live = false; window.clearInterval(timer) }
  }, [prospectId, version])
  const request = async () => {
    setBusy(true); setError(null)
    try { setScan(await requestAnnaScan(prospectId)); await refresh?.() }
    catch (e) { setError(e instanceof Error ? e.message : 'The scan could not be requested.') }
    finally { setBusy(false) }
  }
  const waiting = ['queued', 'building', 'retry', 'working'].includes(scan?.status ?? '')
  const warnings = [...(scan?.review?.blockers ?? []), ...(scan?.review?.warnings ?? [])]
  const publicUrl = /^https:\/\/inboundonsteroids\.com\/scan\/[a-z0-9-]+\/$/.test(scan?.url ?? '') ? scan?.url : null
  return <section className="dm-ctx" aria-label="Anna's scan and booking tools">
    <dl>
      <div><dt>Booking</dt><dd><a className="d-link" href={ANNA_BOOKING_URL} target="_blank" rel="noreferrer">Ivan’s booking page</a></dd></div>
      <div><dt>Scan</dt><dd aria-live="polite">{loading ? 'Loading…' : scan?.status === 'ready' ? 'Ready for your review' : waiting ? 'Preparing the scan. The delivery draft will need your approval.' : scan?.status === 'failed' ? 'The scan needs attention before delivery.' : 'No scan requested'}
        {publicUrl && <p><a className="d-link" href={publicUrl} target="_blank" rel="noreferrer">Open their scan</a></p>}
        {scan?.error && <small>{scan.error.replace(/_/g, ' ')}</small>}
      </dd></div>
    </dl>
    {(warnings.length > 0 || scan?.review?.blockers_overridden) && <div className="dm-ctx-lines" role="note">
      <p>Review the scan before approving its delivery.{scan?.review?.blockers_overridden ? ' The builder published it with unresolved review findings.' : ''}</p>
      {warnings.length > 0 && <ul>{warnings.map((warning, i) => <li key={i}>{typeof warning === 'string' ? warning : JSON.stringify(warning)}</li>)}</ul>}
    </div>}
    {error && <p role="alert">{error}</p>}
    <div className="dm-ctx-lines">
      <Btn verb="anna-insert-booking" onClick={() => onInsert(ANNA_BOOKING_LINE)}>Add booking link to reply</Btn>{' '}
      <Btn verb="anna-request-scan" disabled={busy || loading || waiting || scan?.status === 'ready'} onClick={request}>{busy ? 'Requesting…' : scan?.status === 'failed' ? 'Retry scan' : 'Request scan'}</Btn>{' '}
      <Btn verb="anna-refresh-scan" disabled={busy} onClick={() => setVersion(v => v + 1)}>Refresh</Btn>
    </div>
  </section>
}
