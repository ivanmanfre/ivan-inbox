import { useSeatHealth } from '../hooks/useSeatHealth'

// Guard runs 2-hourly; >5h without a summary write means the guard itself is down.
const STALE_MS = 5 * 60 * 60 * 1000

export function SeatHealthBanner() {
  const summary = useSeatHealth()
  if (!summary) return null
  const down = summary.seats.filter(s => s.degraded)
  const stale = Date.now() - Date.parse(summary.updated_at) > STALE_MS
  if (down.length === 0 && !stale) return null
  return (
    <div className="seatbanner">
      <div className="ic">⚠️</div>
      <div className="tx">
        {down.map(s => (
          <div key={s.id} className="t">
            {s.name}: {s.account !== 'OK' ? 'LinkedIn seat disconnected' : 'Sales Nav session dead'}
            {s.link && <> · <a href={s.link} target="_blank" rel="noreferrer">Reconnect</a></>}
          </div>
        ))}
        {stale && (
          <div className="s">Seat guard silent since {new Date(summary.updated_at).toLocaleString()} — check n8n</div>
        )}
      </div>
    </div>
  )
}
