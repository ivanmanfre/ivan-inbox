import { Failed, Skeleton } from '../ui/states'
import type { AnnaRead, LinkedInSetup } from './anna'

export function LinkedInConnectionLane({ setup, read, refresh }: {
  setup?: LinkedInSetup
  read: AnnaRead
  refresh: () => void
}) {
  if (read.error) return <Failed what="the LinkedIn connection record" detail={read.error} onRetry={refresh} />
  if (!read.value) return <Skeleton label="Reading LinkedIn connection" />
  if (!setup) return <p>This LinkedIn account is unavailable.</p>
  return <section className="dl4-seat anna-lane" aria-label={`${setup.name}’s LinkedIn lane`}>
    <div className="dl4-panel">
      <h2>{setup.name} · LinkedIn</h2>
      <p>Unipile connection last verified {new Date(setup.verified_at).toLocaleString()}.</p>
      <p>Automated invitations are off. This lane has no assigned leads.</p>
    </div>
    <h3>Planned invitation limits</h3>
    <div className="dl4-kpis anna-kpis">{setup.week_caps.map((cap, i) =>
      <div className="dl4-kpi" key={i}><small>Week {i + 1}{i === 3 ? '+' : ''} daily cap</small><strong className="anna-number">{cap}</strong></div>)}
    </div>
  </section>
}
