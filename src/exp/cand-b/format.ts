// Small formatting helpers shared across this candidate's Studio surfaces only.
// Every existing screen in the real app duplicates its own ago()/timeAgo() per
// file rather than importing one shared module (TodayScreen, SendsScreen,
// DraftsScreen, OpsScreen, InboxScreen all do this) — this file follows the
// same convention, just scoped to this candidate's own new screens so they
// don't each redeclare it five times over.

export function ago(iso: string): string {
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return ''
  const s = Math.max(0, Math.floor((Date.now() - then) / 1000))
  const m = Math.floor(s / 60)
  if (m < 1) return 'now'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  if (d === 1) return 'yday'
  return `${d}d`
}

export function truncate(s: string, n: number): string {
  const t = s.trim()
  return t.length > n ? `${t.slice(0, n).trimEnd()}…` : t
}
