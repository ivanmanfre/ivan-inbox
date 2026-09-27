// One read, as a loading / failed / ready state. `key` names the read: a new key re-reads.
import { useEffect, useState } from 'react'

export type Load<T> = { kind: 'loading' } | { kind: 'failed'; message: string } | { kind: 'ready'; data: T }
export function useRead<T>(fn: (() => Promise<T>) | null, key: string): Load<T> {
  const [s, set] = useState<Load<T>>({ kind: 'loading' })
  useEffect(() => {
    if (!fn) return
    let live = true
    set({ kind: 'loading' })
    fn().then(data => { if (live) set({ kind: 'ready', data }) }, e => { if (live) set({ kind: 'failed', message: e instanceof Error ? e.message : String(e) }) })
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` names the read
  }, [key])
  return s
}
