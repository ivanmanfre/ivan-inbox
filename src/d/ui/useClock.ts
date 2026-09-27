import { useEffect, useState } from 'react'

/** Now, re-read every `ms` (default 30s) so a printed clock never goes stale. */
export function useClock(ms = 30_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), ms)
    return () => window.clearInterval(t)
  }, [ms])
  return now
}
