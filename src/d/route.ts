// D's address grammar: `#exp/d/<place>[/<sub>][?query]`.
//
// The query is the same grammar the rest of the app already writes
// (`?thread=`, `&turn=`, `?warm=`, `?lane=`, `?section=`...), handed to the
// page untouched: the frame never validates a page's keys, the page does.
// Old addresses resolve instead of 404ing: a push, a bookmark or the palette
// may still write a job id (`sends`, `inbox`, `magnets`, `money`, `orbit`) or
// another shell's prefix (`#exp/v2/...`, `#exp/brain-b/...`); `toDHash` maps
// them onto a D place and keeps their query.
import type { PlaceId } from './places'
import type { CrossHit } from '../lib/crossSearch'

export const D_PREFIX = '#exp/d'

export const PLACE_IDS: readonly PlaceId[] = ['lanes', 'dms', 'content', 'ops', 'sales', 'claude', 'settings']

export const HOME: PlaceId = 'lanes'

export type DRoute = {
  place: PlaceId
  /** The segment after the place (`#exp/d/content/magnets` -> 'magnets'), or null. */
  sub: string | null
  /** The raw query, for the page to read. Never validated here. */
  query: URLSearchParams
}

/** Old job ids and aliases, and the place (and sub) each one now lives in. */
const ALIAS: Record<string, { place: PlaceId; sub?: string }> = {
  '': { place: 'lanes' },
  home: { place: 'lanes' },
  sends: { place: 'lanes' },
  today: { place: 'lanes' },
  inbox: { place: 'dms' },
  drafts: { place: 'dms' },
  magnets: { place: 'content', sub: 'magnets' },
  styles: { place: 'content', sub: 'styles' },
  strategy: { place: 'content', sub: 'strategy' },
  money: { place: 'settings', sub: 'money' },
  orbit: { place: 'sales', sub: 'orbit' },
  ask: { place: 'claude' },
  chat: { place: 'claude' },
}

function placeFor(seg: string): { place: PlaceId; sub?: string } {
  const s = seg.toLowerCase()
  if ((PLACE_IDS as readonly string[]).includes(s)) return { place: s as PlaceId }
  return ALIAS[s] ?? { place: HOME }
}

const D_RE = /^#exp\/d(?=[/?#]|$)(?:\/([^/?#]*))?(?:\/([^?#]*))?(?:\?([^#]*))?/

/** Parse a D hash. Anything that is not a D hash is the home place. */
export function parseDHash(hash: string): DRoute {
  const m = hash.match(D_RE)
  if (!m) return { place: HOME, sub: null, query: new URLSearchParams() }
  const hit = placeFor(decodeURIComponent(m[1] ?? ''))
  const sub = m[2] ? decodeURIComponent(m[2]) : (hit.sub ?? null)
  return { place: hit.place, sub: sub || null, query: new URLSearchParams(m[3] ?? '') }
}

/** Write a D hash. `query` may be a string (`thread=…`), a record or URLSearchParams. */
export function dHash(place: PlaceId, sub?: string | null, query?: string | URLSearchParams | Record<string, string>): string {
  const q = query == null ? '' : typeof query === 'string' ? query.replace(/^\?/, '')
    : (query instanceof URLSearchParams ? query : new URLSearchParams(query)).toString()
  return `${D_PREFIX}/${place}${sub ? '/' + encodeURIComponent(sub) : ''}${q ? '?' + q : ''}`
}

/**
 * Map any in-app hash onto D. `#exp/v2/dms?thread=x`, `#exp/brain-b/ask?thread=…`,
 * `#exp/v2/money`, `#thread/<id>` all land on the D place that now holds them.
 * A D hash passes through. Returns null for a hash that is not an app route.
 */
export function toDHash(hash: string): string | null {
  if (!hash || hash[0] !== '#') return null
  if (/^#exp\/d(?:[/?]|$)/.test(hash)) return hash
  const t = hash.match(/^#thread\/([^?#]+)/)
  if (t) return dHash('dms', null, { thread: decodeURIComponent(t[1]) })
  const m = hash.match(/^#exp\/(?:v2c?|brain-[abc])(?:\/([^/?#]*))?(?:\/([^/?#]*))?(?:\?([^#]*))?/)
  if (!m) return null
  const seg = m[1] ?? ''
  const query = m[3] ?? ''
  // `#exp/v2/inbox/chat` and `#exp/v2/ask` mean "Claude over this job".
  if (m[2] === 'chat' || seg === 'chat' || seg === 'ask') return dHash('claude', null, query)
  // `?section=<job>` was the old dashboard's spelling of the job.
  const hit = placeFor(seg || new URLSearchParams(query).get('section') || '')
  return dHash(hit.place, hit.sub ?? null, query)
}

/** Only for another shell's route: does this hash leave D? (Used by links that must reload.) */
export function isForeignHash(hash: string): boolean {
  return /^#exp\/(?!d(?:[/?]|$))/.test(hash)
}

/** Where a ⌘K search hit opens in D. */
export function hitHash(h: CrossHit): string {
  if (h.surface === 'dm') return dHash('dms', null, { thread: h.id })
  if (h.surface === 'magnet') return dHash('content', 'magnets', { magnet: h.id, lane: h.lane })
  return dHash('content', null, { draft: h.id, lane: h.lane })
}

const isD = (h: string) => /^#exp\/d(?:[/?]|$)/.test(h)

/** The hash D should be on for whatever the address bar says now. */
export function canonicalHash(h: string): string {
  if (isD(h)) return h
  return toDHash(h) ?? dHash(HOME)
}
