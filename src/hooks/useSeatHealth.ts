import { useCallback, useEffect, useState } from 'react'
import { fetchSeatHealth, type SeatHealthSummary } from '../lib/seatHealth'

// The guard writes seat_health_summary every ~2h; focus-refetch is plenty.
export function useSeatHealth() {
  const [summary, setSummary] = useState<SeatHealthSummary | null>(null)
  const refresh = useCallback(() => { fetchSeatHealth().then(setSummary).catch(() => {}) }, [])
  useEffect(() => {
    refresh()
    const onFocus = () => refresh()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refresh])
  return summary
}
