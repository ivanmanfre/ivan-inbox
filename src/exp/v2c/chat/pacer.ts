// Adaptive character pacing, ported from the reference's streamRenderer.ts.
// Zero dependencies, ~50 lines, and it solves a real perceived-latency problem
// that exists regardless of markdown approach: a long reply the server finished
// producing three seconds ago should not still be dribbling out one word at a
// time. The release rate scales with how far behind the buffer is, so a big
// backlog catches up instead of queueing.

export type Pacer = {
  push: (delta: string) => void
  // Release everything immediately (turn ended, or the view is unmounting).
  flush: () => void
  stop: () => void
}

const MIN_CHARS = 2
const MAX_CHARS = 90

export function createPacer(onText: (full: string) => void): Pacer {
  let queued = ''
  let shown = ''
  let raf: number | null = null
  let stopped = false

  const tick = () => {
    raf = null
    if (stopped) return
    if (!queued) return
    // Behind by a lot → bigger bites. The 1/12th factor is the reference's
    // heuristic and reads smoothly at both 20-token and 400-token replies.
    const take = Math.max(MIN_CHARS, Math.min(MAX_CHARS, Math.ceil(queued.length / 12)))
    shown += queued.slice(0, take)
    queued = queued.slice(take)
    onText(shown)
    if (queued) schedule()
  }

  const schedule = () => {
    if (raf !== null || stopped) return
    raf = typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame(tick)
      : (setTimeout(tick, 16) as unknown as number)
  }

  return {
    push(delta) {
      queued += delta
      schedule()
    },
    flush() {
      if (stopped) return
      shown += queued
      queued = ''
      onText(shown)
    },
    stop() {
      stopped = true
      if (raf !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf)
      raf = null
    },
  }
}
