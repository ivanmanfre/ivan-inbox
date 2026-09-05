/* ==========================================================================
   src/wb/chrome/SeatHealthBanner.tsx: S40, on the design system.

   The hook, the five-hour staleness rule, the two wordings and the reconnect
   link are the old file's. What changed: the strip is a ds `Banner` on the
   attention tone (a disconnected seat is a live signal, which is the one thing
   severity is for), the warning emoji is a drawn mark, and the reconnect link is
   a real control rather than an inline anchor in a run of text. The old copy
   stays on disk for `#exp/stock` (D2).
   ========================================================================== */
import { Banner, Button } from '../../ds'
import { useSeatHealth } from '../../hooks/useSeatHealth'
import './chrome.css'

// Guard runs 2-hourly; >5h without a summary write means the guard itself is down.
const STALE_MS = 5 * 60 * 60 * 1000

export function SeatHealthBanner() {
  const summary = useSeatHealth()
  if (!summary) return null
  const down = summary.seats.filter(s => s.degraded)
  const stale = Date.now() - Date.parse(summary.updated_at) > STALE_MS
  if (down.length === 0 && !stale) return null
  return (
    <div className="a-seatbanner">
      <Banner tone="attention" icon="alert">
        <span className="a-seatbanner-lines">
          {down.map(s => (
            <span key={s.id} className="a-seatbanner-line">
              {s.name}: {s.account !== 'OK' ? 'LinkedIn seat disconnected' : 'Sales Nav session dead'}
              {s.link && (
                <Button
                  variant="quiet" size="sm" iconEnd="external"
                  onClick={() => window.open(s.link!, '_blank', 'noopener,noreferrer')}
                >Reconnect</Button>
              )}
            </span>
          ))}
          {stale && (
            <span className="a-seatbanner-line">
              {`Seat guard silent since ${new Date(summary.updated_at).toLocaleString()} \u2014 check n8n`}
            </span>
          )}
        </span>
      </Banner>
    </div>
  )
}
