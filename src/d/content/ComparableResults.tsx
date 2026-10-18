import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import type { Lane } from './model'
import './comparable-results.css'

type Reading = { post_id: string; title: string | null; url: string | null; purpose: string; actual_age_days: number; captured_at: string; impressions: number | null; comments: number | null; current_buyer_signal: { judged: number; buyer_memberships: number } | null }
type Pack = { status: string; age_days: number; eligible_posts: number; measured_posts: number; latest_collection: string | null; rows: Reading[] }

/** Fixed-age reach readings and current buyer coverage have separate labels and never share a ranking. */
export function ComparableResults({ lane }: { lane: Lane }) {
  const [days, setDays] = useState(7)
  const [read, setRead] = useState<{ key: string; pack: Pack | null; failed: boolean } | null>(null)
  const key = `${lane}:${days}`
  useEffect(() => {
    let live = true
    if (lane === 'swishdm') return
    void Promise.resolve(supabase.rpc('content_learning_readings', { p_client: lane, p_age_days: days }))
      .then(({ data, error }) => { if (live) setRead({ key, pack: error ? null : data as Pack, failed: !!error || data?.status !== 'ok' }) })
      .catch(() => { if (live) setRead({ key, pack: null, failed: true }) })
    return () => { live = false }
  }, [lane, days, key])
  if (lane === 'swishdm') return null
  const current = read?.key === key ? read : null
  const pack = current?.pack
  return <section className="cn-result-section cn-comparable" aria-label="Comparable own-post results">
    <h2>At the same post age</h2>
    <div className="cn-wk2-chips" role="group" aria-label="Observation age">{[7, 14].map(n => <button key={n} type="button" aria-pressed={days === n} onClick={() => setDays(n)}>Day {n}</button>)}</div>
    {!current ? <p>Reading comparable post results…</p> : current.failed ? <p role="alert">Comparable post results could not be read.</p> : pack && <>
      <p>{pack.measured_posts} of {pack.eligible_posts} posts have a retained day-{pack.age_days} reading.</p>
      <p>Each reading is the first retained observation between day {days} and day {days + 1}. Missing readings stay unmeasured. Buyer labels below show current coverage.</p>
      {pack.rows.slice(0, 8).map(r => <article className="cn-result-card" key={r.post_id}>
        <h3>{r.title || 'Published post'}</h3>
        <p>{r.impressions == null ? 'Impressions not recorded' : `${r.impressions.toLocaleString('en-US')} impressions`} · {Number(r.actual_age_days).toFixed(1)} days old when measured.</p>
        <small>Purpose: {r.purpose.replaceAll('_', ' ')}. {r.current_buyer_signal ? `Buyer labels now: ${r.current_buyer_signal.buyer_memberships} of ${r.current_buyer_signal.judged} judged engagement memberships.` : 'Buyer coverage not recorded.'}</small>
        {r.url && <p><a href={r.url} target="_blank" rel="noreferrer">Open post ↗</a></p>}
      </article>)}
      {pack.rows.length > 8 && <p>Showing the latest 8 of {pack.rows.length} measured posts.</p>}
      <p>Booking and inbound DM coverage is unverified. These fields are not counted as zero or used to rank posts.</p>
    </>}
  </section>
}
