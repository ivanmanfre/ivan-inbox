// One read, as a loading / failed / ready state. `key` names the read: a new key re-reads.
// No read waits forever: past READ_TIMEOUT_MS it is `failed` ("no answer after
// 12 s"), and a failed read tries again quietly every RETRY_MS. A read that
// already has data keeps it while a quiet retry is out.
import { useCallback, useEffect, useState } from 'react'
import { RETRY_MS, withTimeout } from '../ui/timeout'

export type Load<T> = { kind: 'loading' } | { kind: 'failed'; message: string } | { kind: 'ready'; data: T }

/** The read and a Retry for it (a Retry shows loading again, then the answer). */
export function useRetryRead<T>(fn: (() => Promise<T>) | null, key: string): [Load<T>, () => void] {
  const [s, set] = useState<Load<T>>({ kind: 'loading' })
  const [tick, setTick] = useState(0)
  const [quiet, setQuiet] = useState(0)
  useEffect(() => {
    if (!fn) return
    let live = true
    set({ kind: 'loading' })
    withTimeout(fn()).then(
      data => { if (live) set({ kind: 'ready', data }) },
      e => { if (live) set({ kind: 'failed', message: e instanceof Error ? e.message : String(e) }) },
    )
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` names the read
  }, [key, tick])
  // The quiet background retry: stays on the failed line until an answer lands.
  useEffect(() => {
    if (!fn || s.kind !== 'failed') return
    let live = true
    const t = setTimeout(() => {
      withTimeout(fn()).then(data => { if (live) set({ kind: 'ready', data }) }, () => { if (live) setQuiet(q => q + 1) })
    }, RETRY_MS)
    return () => { live = false; clearTimeout(t) }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-armed per failure
  }, [s, quiet, key])
  const retry = useCallback(() => setTick(t => t + 1), [])
  return [s, retry]
}

export function useRead<T>(fn: (() => Promise<T>) | null, key: string): Load<T> {
  return useRetryRead(fn, key)[0]
}
