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

export const PLACE_IDS: readonly PlaceId[] = ['home', 'lanes', 'dms', 'content', 'ops', 'sales', 'claude', 'settings']

export const HOME: PlaceId = 'home'

export type DRoute = {
  place: PlaceId
  /** The segment after the place (`#exp/d/content/magnets` -> 'magnets'), or null. */
  sub: string | null
  /** The raw query, for the page to read. Never validated here. */
  query: URLSearchParams
}

/** Old job ids and aliases, and the place (and sub) each one now lives in. */
const ALIAS: Record<string, { place: PlaceId; sub?: string }> = {
  '': { place: 'home' },
  sends: { place: 'lanes' },
  today: { place: 'home' },
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
  // The manifest's "Talk to Claude" shortcut (vite.config.ts) opens live voice in the Claude drawer.
  if (/^#claude\/voice\b/.test(hash)) return dHash('claude', null, { voice: '1' })
  const t = hash.match(/^#thread\/([^?#]+)/)
  if (t) return dHash('dms', null, { thread: decodeURIComponent(t[1]) })
  const m = hash.match(/^#exp\/(?:v2c?|brain-[abc])(?:\/([^/?#]*))?(?:\/([^/?#]*))?(?:\?([^#]*))?/)
  if (!m) return null
  const seg = m[1] ?? ''
  const query = m[3] ?? ''
  // `#exp/v2/inbox/chat` and `#exp/v2/ask` mean "Claude over this job".
  if (m[2] === 'chat' || seg === 'chat' || seg === 'ask') return dHash('claude', null, query)
  const q = new URLSearchParams(query)
  // The keep-today marker is ours, never a page's key.
  q.delete(TODAY_APP_KEY)
  // Content's historical Sources shortcut is the Strategy reader on its Research tab (today's StrategyView alias).
  if (['content', 'strategy', ''].includes(seg) && (q.get('sources') === '1' || q.get('section') === 'sources')) {
    q.delete('sources'); q.set('section', 'research')
    return dHash('content', 'strategy', q)
  }
  // `?warm=1|<uuid>` (the WhatsApp line) is a DMs card whatever job the link named.
  if (q.get('warm') && ['', 'home', 'today', 'sends', 'inbox', 'drafts'].includes(seg)) return dHash('dms', null, q)
  // `?section=<job>` was the old dashboard's spelling of the job.
  const hit = placeFor(seg || q.get('section') || '')
  return dHash(hit.place, hit.sub ?? null, q)
}

/**
 * The query key that says "open TODAY'S app here, on purpose" (a "Today's X"
 * link from inside D, e.g. Orbit). Without it, an old-app address is a push, a
 * shortcut or a bookmark, and it lands in D.
 */
export const TODAY_APP_KEY = 'app'
const TODAY_APP_VALUE = 'today'

/** An old-app address that must open today's app, because it asks to. */
export function todayAppHash(hash: string): string {
  const [path, query = ''] = hash.split('?')
  const q = new URLSearchParams(query)
  q.set(TODAY_APP_KEY, TODAY_APP_VALUE)
  return `${path}?${q.toString()}`
}

/**
 * THE COLD-START LANDING. Every address today's writers still produce
 * (`./#exp/brain-b/ask?thread=&turn=` from inbox-turn-run, `./#exp/brain-b/ops|
 * content|sends|today` from the notify registry and n8n, the manifest's Sales /
 * Orbit / Claude shortcuts, `?feed=1`, `?warm=`, `#claude/voice`) lands in D on a
 * build where D is the app, and never pins the tab to the old app. Returns the
 * D hash to replace the address with, or null to leave it alone:
 *   - a D hash, `#doc?`, `#exp/stock`, `#exp/off`, a Supabase `#access_token`;
 *   - the bare `#exp/brain-b` (typed on purpose) and any old address carrying
 *     `app=today` (a "Today's X" link from inside D).
 */
export function dLandingHash(hash: string): string | null {
  if (/^#claude\/voice\b/.test(hash)) return toDHash(hash)
  const m = hash.match(/^#exp\/(?:v2c?|brain-[abc])(?=[/?#]|$)(.*)$/)
  if (!m) return null
  if (m[1] === '' || m[1] === '/') return null
  const q = new URLSearchParams(hash.split('?')[1] ?? '')
  if (q.get(TODAY_APP_KEY) === TODAY_APP_VALUE) return null
  return toDHash(hash)
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
  // A sign-in redirect's token: the auth client reads it, D never rewrites it.
  if (/^#(?:access_token|error)=/.test(h)) return h
  return toDHash(h) ?? dHash(HOME)
}

/**
 * A cold tap on a push opens the address the push was written with: today's
 * `./#exp/brain-b/ask?thread=…&turn=…` (inbox-turn-run), `…/ask?job=…&report=1`
 * (runner) and the `#claude/voice` shortcut. On a build where D is the app,
 * those land in D's Claude drawer instead of booting the old shell. Returns the
 * D hash to replace the address with, or null to leave it alone (every other
 * `#exp/brain-b/...` still reaches today's app on purpose).
 */
export function claudeLandingHash(hash: string): string | null {
  if (/^#claude\/voice\b/.test(hash)) return toDHash(hash)
  const m = hash.match(/^#exp\/(?:v2c?|brain-[abc])\/(?:[^/?#]+\/)?(?:ask|chat)\?([^#]*)/)
  if (!m) return null
  const q = new URLSearchParams(m[1])
  if (!q.get('thread') && !q.get('job') && !q.get('turn')) return null
  return toDHash(hash)
}
