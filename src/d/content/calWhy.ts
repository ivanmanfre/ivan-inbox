import { ClientRpcError } from '../../lib/content'

// WHY A DATE DID NOT CHANGE, in plain words (Ivan 2026-10-15: a post he dragged onto Friday "doesn't
// let me add it" and nothing said why). Every calendar date write (drop, Remove date, the date and
// time editor) ends in one of these when the server or the network refuses. The database's own
// refusals already come worded (ClientRpcError, content.ts CLIENT_RPC_MESSAGES); a dropped
// connection or a raw Postgres error gets a sentence instead of "TypeError: Failed to fetch".

export function plainWhy(e: unknown): string {
  if (e instanceof ClientRpcError) return e.message
  const raw = e instanceof Error ? e.message : typeof e === 'string' ? e : ''
  if (!raw) return 'The database did not answer, so nothing changed. Try again.'
  if (/failed to fetch|networkerror|load failed|network request failed|fetch failed/i.test(raw)) {
    return 'Could not reach the database, so nothing changed. Check the connection and try again.'
  }
  if (/jwt|expired|not authenticated|401/i.test(raw)) return 'Your sign-in ran out, so nothing changed. Reload the app and try again.'
  if (/permission denied|42501|403/i.test(raw)) return 'The database did not allow this change, so nothing changed.'
  // Already a sentence written for a person (rpcOk's Mattan's-OK message, our own words): keep it.
  if (/^[A-Z][^_]*[.!]$/.test(raw.trim()) && raw.includes(' ')) return raw.trim()
  return `The database refused it (${raw.trim().slice(0, 140)}), so nothing changed.`
}

/** What a drag says when the post was let go somewhere that is not a day. */
export const MISSED_DROP = 'Not moved: let go of it over a day on the calendar.'
