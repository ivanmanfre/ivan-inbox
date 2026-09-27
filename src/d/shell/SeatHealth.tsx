import { useSeatHealth } from '../../hooks/useSeatHealth'
import { DIcon } from '../ui/icons'
import { Btn } from '../ui/Key'
import { healthLines } from './healthLines'

// SEAT HEALTH, global, above every page. Today's hook and rules
// (hooks/useSeatHealth, the seat guard's `seat_health_summary`): a seat whose
// LinkedIn account or Sales Nav session is down gets a line and a Reconnect
// key that opens the seat's own reconnect link in a new tab (no database
// write); a guard silent for more than 5 hours says so, because a dead guard
// looks exactly like healthy seats.
export function SeatHealthBanner() {
  const summary = useSeatHealth()
  const lines = healthLines(summary)
  if (lines.length === 0) return null
  return (
    <div className="d-health" role="alert" data-seat-health>
      <DIcon name="plug" />
      <div className="d-health-l">
        {lines.map(l => (
          <div key={l.key} className="d-health-r">
            <span>{l.text}</span>
            {l.link && (
              <Btn verb="reconnect" onClick={() => window.open(l.link!, '_blank', 'noopener,noreferrer')}>
                Reconnect <DIcon name="external" />
              </Btn>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
