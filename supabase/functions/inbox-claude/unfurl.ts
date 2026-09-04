// unfurl.ts — turn a pasted link into a card the inbox can draw.
//
// Server-side because the bundle is a static page on GitHub Pages: a browser
// fetch of youtube.com or linkedin.com from that origin is blocked, and the meta
// tags it wants are not in the CORS response anyway.
//
// The rule this file exists to keep: NEVER FABRICATE A TITLE. Instagram in
// particular answers a plain UA with a login wall, and the honest answer there is
// `{ok:false, kind:'instagram', reason:'blocked'}` rather than the URL dressed up
// as a title. A card that invents its own contents is worse than no card.

const FETCH_TIMEOUT_MS = 10_000
/** A page's tags do not move minute to minute, and a warm isolate re-asks a lot. */
const CACHE_TTL_MS = 600_000
const MAX_HTML_BYTES = 512_000

export interface Unfurl {
  ok: boolean
  kind: 'youtube' | 'linkedin' | 'instagram' | 'og'
  url: string
  title?: string
  description?: string
  image?: string
  site?: string
  author?: string
  reason?: string
}

export class UnfurlError extends Error {
  readonly code: string
  readonly status: number
  constructor(status: number, code: string, detail?: string) {
    super(detail ?? code)
    this.code = code
    this.status = status
  }
}

const CACHE = new Map<string, { at: number; value: Unfurl }>()

/**
 * Titles a login wall serves instead of the page. MEASURED 2026-09-04: a
 * `linkedin.com/feed/update/urn:li:activity:...` URL answers a plain UA with the
 * signup page, whose og:title is "Sign Up | LinkedIn". A card reading that is
 * worse than no card, because it looks like it worked. So a wall is a wall:
 * ok:false, reason 'blocked'.
 */
const WALL_TITLES = [
  /^sign ?up \| linkedin$/i,
  /^linkedin login, sign in \| linkedin$/i,
  /^log ?in \| linkedin$/i,
  /^login • instagram$/i,
  /^instagram$/i,
]

function isWall(title: string | undefined): boolean {
  if (!title) return false
  return WALL_TITLES.some((re) => re.test(title.trim()))
}

/** Only http(s), and never at this container's own neighbours. */
function assertFetchable(u: URL) {
  if (u.protocol !== 'https:' && u.protocol !== 'http:') {
    throw new UnfurlError(400, 'bad_scheme', 'only http and https are unfurled')
  }
  const h = u.hostname.toLowerCase()
  if (
    h === 'localhost' || h === '0.0.0.0' || h.endsWith('.local') ||
    /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h) || /^169\.254\./.test(h)
  ) {
    throw new UnfurlError(400, 'private_host', 'refusing to fetch a private address')
  }
}

function kindOf(u: URL): Unfurl['kind'] {
  const h = u.hostname.toLowerCase().replace(/^www\./, '')
  if (h === 'youtube.com' || h === 'youtu.be' || h.endsWith('.youtube.com')) return 'youtube'
  if (h === 'linkedin.com' || h.endsWith('.linkedin.com')) return 'linkedin'
  if (h === 'instagram.com' || h.endsWith('.instagram.com')) return 'instagram'
  return 'og'
}

function decodeEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .replace(/&#x27;/g, "'").replace(/&#x2F;/g, '/').replace(/&amp;/g, '&')
}

/**
 * Read one meta tag. Deliberately regex and not a DOM: the edge runtime has no
 * parser, the attribute order differs per site, and a card only needs five tags.
 */
function meta(html: string, prop: string): string | undefined {
  const esc = prop.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${esc}["'][^>]*content=["']([^"']*)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${esc}["']`, 'i'),
  ]
  for (const re of patterns) {
    const m = re.exec(html)
    if (m && m[1].trim()) return decodeEntities(m[1].trim())
  }
  return undefined
}

function titleTag(html: string): string | undefined {
  const m = /<title[^>]*>([\s\S]{0,400}?)<\/title>/i.exec(html)
  const t = m ? decodeEntities(m[1].replace(/\s+/g, ' ').trim()) : ''
  return t || undefined
}

async function getText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; inbox-unfurl)',
      'Accept': 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!res.ok) throw new UnfurlError(200, `http_${res.status}`)
  const text = await res.text()
  return text.slice(0, MAX_HTML_BYTES)
}

async function oembed(endpoint: string): Promise<Record<string, unknown> | null> {
  try {
    const body = await getText(endpoint)
    return JSON.parse(body) as Record<string, unknown>
  } catch {
    return null // an oembed that 4xxs is a fact about the vendor, not an error here
  }
}

export async function unfurl(rawUrl: string): Promise<Unfurl> {
  const trimmed = rawUrl.trim()
  let u: URL
  try {
    u = new URL(trimmed)
  } catch {
    throw new UnfurlError(400, 'bad_url')
  }
  assertFetchable(u)

  const key = u.toString()
  const hit = CACHE.get(key)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value

  const kind = kindOf(u)
  let html = ''
  let fetchFailed: string | undefined
  try {
    html = await getText(key)
  } catch (e) {
    fetchFailed = e instanceof UnfurlError ? e.code : (e instanceof Error ? e.name : 'fetch_failed')
  }

  const out: Unfurl = {
    ok: false,
    kind,
    url: key,
    title: meta(html, 'og:title') ?? titleTag(html),
    description: meta(html, 'og:description') ?? meta(html, 'description'),
    image: meta(html, 'og:image'),
    site: meta(html, 'og:site_name'),
    author: meta(html, 'author') ?? meta(html, 'article:author'),
  }

  if (kind === 'youtube') {
    // The oembed endpoint is public, needs no key, and answers when the watch page
    // hands back a consent interstitial with no og tags on it.
    const o = await oembed(`https://www.youtube.com/oembed?url=${encodeURIComponent(key)}&format=json`)
    if (o) {
      out.title = (o.title as string) ?? out.title
      out.image = (o.thumbnail_url as string) ?? out.image
      out.author = (o.author_name as string) ?? out.author
      out.site = out.site ?? 'YouTube'
    }
  }

  if (kind === 'instagram' && !out.title) {
    const o = await oembed(`https://www.instagram.com/oembed/?url=${encodeURIComponent(key)}`)
    if (o) {
      out.title = (o.title as string) ?? out.title
      out.image = (o.thumbnail_url as string) ?? out.image
      out.author = (o.author_name as string) ?? out.author
    }
  }

  // A page that gave us nothing to show says so. `reason` names which of the
  // three happened: the fetch never landed, it landed on a page with no tags, or
  // it landed on a login wall whose tags describe the wall and not the post.
  if (isWall(out.title)) {
    out.title = undefined
    out.description = undefined
    out.image = undefined
    out.author = undefined
    out.ok = false
    out.reason = 'blocked'
  } else {
    out.ok = Boolean(out.title)
    if (!out.ok) out.reason = fetchFailed ?? 'blocked'
  }

  CACHE.set(key, { at: Date.now(), value: out })
  return out
}
