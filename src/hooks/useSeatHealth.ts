import { useCallback, useEffect, useState } from 'react'
import { fetchSeatHealth, type SeatHealthSummary } from '../lib/seatHealth'

// The guard writes seat_health_summary every ~2h; focus-refetch is plenty.
// A failed refetch keeps the last good summary (never blanks a Reconnect banner) and sets `failed`.
export function useSeatHealthState() {
  const [state, setState] = useState<{ summary: SeatHealthSummary | null; failed: boolean }>({ summary: null, failed: false })
  const refresh = useCallback(() => {
    fetchSeatHealth()
      .then(summary => setState({ summary, failed: false }))
      .catch(() => setState(prev => ({ ...prev, failed: true })))
  }, [])
  useEffect(() => {
    refresh()
    const onVisible = () => { if (document.visibilityState === 'visible') refresh() }
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [refresh])
  return state
}

export function useSeatHealth() {
  return useSeatHealthState().summary
}
