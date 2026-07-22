import { useEffect, useState } from 'react'

// Desktop = enough width for the two-pane (rail + list + conversation) layout.
const QUERY = '(min-width: 1000px)'

export function useDesktop(): boolean {
  const [wide, setWide] = useState(() => window.matchMedia(QUERY).matches)
  useEffect(() => {
    const mq = window.matchMedia(QUERY)
    const on = (e: MediaQueryListEvent) => setWide(e.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return wide
}
