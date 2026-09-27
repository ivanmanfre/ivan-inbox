import { useEffect, useRef, useState } from 'react'

// NO READ WAITS FOREVER (final gate 09-27: three live shots sat on "…" and
// skeletons because a 503'd read never settled). Every D read that can hang
// goes through one of these:
//   - withTimeout(promise): rejects with ReadTimeout after READ_TIMEOUT_MS, so
//     the caller's own failed state (and its Retry) takes over;
//   - useStalled(loading, retry): for a hook D does not own (today's feed,
//     content, brief), true once `loading` has lasted READ_TIMEOUT_MS; while it
//     stays stalled it calls `retry` quietly every RETRY_MS.
// Failed reads keep retrying in the background (RETRY_MS), so a slow database
// comes back on its own without a tap.

export const READ_TIMEOUT_MS = 12_000
export const RETRY_MS = 20_000

export class ReadTimeout extends Error {
  constructor(ms: number = READ_TIMEOUT_MS) {
    super(`no answer after ${Math.round(ms / 1000)} s`)
    this.name = 'ReadTimeout'
  }
}

/** The promise, or a ReadTimeout once `ms` pass without it settling. */
export function withTimeout<T>(p: PromiseLike<T>, ms: number = READ_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new ReadTimeout(ms)), ms)
    Promise.resolve(p).then(
      v => { clearTimeout(t); resolve(v) },
      e => { clearTimeout(t); reject(e) },
    )
  })
}

/**
 * True once `loading` has been true for `ms` without a break. While stalled,
 * `retry` (if given) runs every `every` ms. Back to false the moment loading ends.
 */
export function useStalled(loading: boolean, retry?: () => void, ms: number = READ_TIMEOUT_MS, every: number = RETRY_MS): boolean {
  const [stalled, setStalled] = useState(false)
  const again = useRef(retry)
  useEffect(() => { again.current = retry })
  useEffect(() => {
    if (!loading) { setStalled(false); return }
    const t = setTimeout(() => setStalled(true), ms)
    return () => clearTimeout(t)
  }, [loading, ms])
  useEffect(() => {
    if (!stalled || !loading) return
    const t = setInterval(() => again.current?.(), every)
    return () => clearInterval(t)
  }, [stalled, loading, every])
  return stalled && loading
}
