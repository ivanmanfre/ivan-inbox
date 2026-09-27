/* Parts of the Control detail sheet (ControlSheet.tsx), ported from today's
   wb/sends/Control.tsx (IncidentBlock, EvidenceFold) and Overview.tsx
   (GovGauge) as new D views. Read-only; the Private detail read is lazy
   (fetched on the fold's first open, never on mount), as today. */
import { useState } from 'react'
import {
  fetchEvidence, isRateLimitIncident,
  type CcEvidenceState, type CcIncident, type CcPayload,
} from '../../lib/campaignControl'
import { governorEnforcementGap, type GovernorRow } from '../../lib/kpis'
import { dm, hm } from './model'

const when = (t: string | null | undefined, now: number) =>
  !t ? 'not set' : `${dm(t) === dm(now) ? 'today' : dm(t)} ${hm(t)}`
const n = (v: number | null | undefined) => (v == null ? 'unknown' : v.toLocaleString('en-US'))

/** One incident, every field today's Control prints. Closed ones are dimmed, never hidden. */
export function IncidentDetail({ inc, now }: { inc: CcIncident; now: number }) {
  const limited = isRateLimitIncident(inc)
  const open = !/closed|resolved|recovered/i.test(inc.state)
  return (
    <div className={`dl-msg${open ? '' : ' dl-closed'}`} data-incident={inc.incident_key}>
      <div className="dl-mh"><b className={open ? 'dl-al' : ''}>Incident {inc.state}</b><span className="dl-tag">{(inc.failure_family ?? 'incident').replace(/_/g, ' ')}</span>
        {inc.source_lane && <span className="dl-tag">{inc.source_lane.replace(/_/g, ' ')}</span>}<em>{inc.opened_at ? `since ${when(inc.opened_at, now)}` : ''}</em></div>
      <p>{limited ? <>Cause <b>confirmed</b>: LinkedIn rate limit (invitation limit, or these people were invited before). </> : <>Cause <b>{inc.cause?.status ?? 'unknown'}</b>: </>}
        {inc.plain_cause ?? inc.cause?.explanation ?? 'no plain cause recorded'}</p>
      {inc.cause?.underlying_restriction && <p>Underlying restriction: {inc.cause.underlying_restriction}</p>}
      {(inc.cause?.alternatives_checked ?? []).length > 0 && <p>Alternatives checked: {inc.cause!.alternatives_checked!.join(' · ')}</p>}
      <p className="dl-m">{n(inc.observed_failures)} failures over {n(inc.observed_distinct_prospects)} people · {(inc.evidence_ids ?? []).length} evidence records</p>
      <p>Next action: {inc.next_action?.action ?? 'none recorded'}{inc.next_action?.owner ? ` · owner ${inc.next_action.owner}` : ''}</p>
      <p className="dl-m">Earliest safe at {when(inc.next_action?.earliest_safe_at, now)} · next check {when(inc.next_check_at, now)}</p>
      <p>Recovers when: {inc.recovery_condition ?? 'no recovery condition recorded'}</p>
    </div>
  )
}

/** "Evidence (n)" refs from the snapshot, and the lazy "Private detail" records. */
export function EvidenceFolds({ p, ids }: { p: CcPayload; ids: string[] }) {
  const refs = p.evidence.filter(e => ids.includes(e.id))
  const [priv, setPriv] = useState<CcEvidenceState | 'loading' | null>(null)
  return (
    <>
      <details className="dl-fold2">
        <summary>Evidence ({refs.length})</summary>
        {refs.length === 0 && <p className="dl-sl">No evidence references on this seat.</p>}
        {refs.map(e => (
          <div className="dl-ev" key={e.id}><code>{e.id}</code><span>{e.source_kind ?? 'unknown kind'} · {e.lineage ?? 'unknown lineage'}</span><time>{e.observed_at ?? e.event_at ?? '—'}</time></div>
        ))}
      </details>
      <details className="dl-fold2" onToggle={e => {
        if ((e.currentTarget as HTMLDetailsElement).open && priv === null) {
          setPriv('loading')
          fetchEvidence().then(setPriv).catch(() => setPriv({ state: 'unavailable', reason: 'private evidence read failed' }))
        }
      }}>
        <summary>Private detail</summary>
        {priv === null && <p className="dl-sl">Not fetched yet.</p>}
        {priv === 'loading' && <p className="dl-sl dl-unk">Reading the private evidence…</p>}
        {priv && priv !== 'loading' && priv.state === 'unavailable' && <p className="dl-sl dl-bad">Private detail not available: {priv.reason}</p>}
        {priv && priv !== 'loading' && priv.state === 'ok' && (() => {
          const rs = priv.records.filter(r => ids.includes(r.id))
          return rs.length ? rs.map(r => <div className="dl-ev" key={r.id}><code>{r.id}</code><span>{r.source_locator ?? ''}</span>{r.text && <pre>{r.text}</pre>}</div>)
            : <p className="dl-sl">No private record for this seat.</p>
        })()}
      </details>
    </>
  )
}

const MODE: Record<GovernorRow['mode'], string> = { normal: 'Normal', warm_only: 'Warm only', cold_paused: 'Cold paused' }

/** The governor, in full: weekly gauge, daily brake, headroom, monthly, cohort, the enforcement gap. */
export function GovernorDetail({ g }: { g: GovernorRow }) {
  const over = g.cap > 0 && g.used > g.cap ? Math.round(((g.used - g.cap) / g.cap) * 100) : 0
  const gated = governorEnforcementGap(g.used, g.cap, g.gov_used, g.gov_cap)
  const win = g.window_label === 'day' ? 'today' : `this ${g.window_label}`
  return (
    <div className="dl-gov">
      <div className="dl-kv"><span className="dl-k">Governor</span> <b>{g.used}</b>/{g.cap} {win} · {g.cap > 0 && g.used >= g.cap ? 'Cap reached' : MODE[g.mode]}
        {over > 0 && <span className="dl-al"> · {over}% over the cap</span>}</div>
      <div className="dl-bar"><i style={{ width: `${Math.min(100, g.cap ? (g.used / g.cap) * 100 : 0)}%` }} className={g.used >= g.cap && g.cap > 0 ? 'dl-full' : ''} /></div>
      {g.daily_cap > 0 && <div className="dl-kv"><span className="dl-k">Daily brake</span> <b>{g.daily_used}</b>/{g.daily_cap} today</div>}
      <div className="dl-kv"><span className="dl-k">Headroom</span> {g.window_label === 'day' ? `${g.headroom_day} left today` : `${g.headroom_week} left this ${g.window_label} · ${g.headroom_day} left today`}</div>
      {g.monthly_cap != null && <div className="dl-kv"><span className="dl-k">Month</span> {g.monthly_used}/{g.monthly_cap}</div>}
      <div className="dl-kv"><span className="dl-k">Cohort</span> {g.accept_rate == null
        ? `not enough data yet${g.cohort_opens_at ? ` (opens ~${dm(g.cohort_opens_at)})` : ''}`
        : `${g.accept_rate}% accepted (sends 3–18 days old${g.cohort != null ? `, ${g.accepted ?? '?'} of ${g.cohort}` : ''})`}</div>
      {gated && <div className="dl-kv dl-al">Governor counter {g.gov_used}/{g.gov_cap} (shared), cold sends gated</div>}
    </div>
  )
}
