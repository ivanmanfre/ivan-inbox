// Audit finding A5, as a pure function: Ops could not distinguish an empty queue
// from a stalled feed, so "Nothing waiting on you." was the same sentence whether
// the engine was clear or the realtime channel had died.
//
// Ops rows arrive on a realtime channel, so a quiet minute is normal and a quiet
// ten is a signal. Three tiers only — the app's severity system is 3-tier and
// locked, so this reuses clear/attention/urgent rather than inventing a fourth.

const AGING_MS = 2 * 60 * 1000
const STALLED_MS = 10 * 60 * 1000

export type Freshness = 'live' | 'quiet' | 'stalled' | 'never'

export function freshnessOf(loadedAt: string | null, now: number = Date.now()): Freshness {
  if (!loadedAt) return 'never'
  const t = new Date(loadedAt).getTime()
  if (!Number.isFinite(t)) return 'never'
  const age = now - t
  if (age < AGING_MS) return 'live'
  if (age < STALLED_MS) return 'quiet'
  return 'stalled'
}

export const FRESHNESS_COPY: Record<Freshness, string> = {
  live: 'live read',
  quiet: 'nothing new for a few minutes',
  stalled: 'nothing has arrived in a while — this may be a stalled feed, not an empty queue',
  never: 'nothing has loaded yet',
}

// A quiet feed is worth a glance, a stalled one is worth a refresh, a live one is
// not a warning at all — the audit's point 8 applied to freshness.
export function freshnessSeverity(f: Freshness): 'clear' | 'attention' | 'urgent' {
  if (f === 'live') return 'clear'
  if (f === 'quiet') return 'attention'
  return 'urgent'
}
