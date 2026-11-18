// Desk-local link preview for LinkedIn / X posts only (Sol desk-backend r2 #12). Redirects are
// followed by hand (max 3 hops) and every hop must stay on an allowlisted host; only og:title and
// og:description are read. Never throws: no preview is just no preview.

const HOSTS = new Set(['linkedin.com', 'www.linkedin.com', 'x.com', 'www.x.com', 'twitter.com', 'www.twitter.com', 'mobile.twitter.com'])

export function allowedHost(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && HOSTS.has(u.hostname.toLowerCase()) && !u.username && !u.password && (u.port === '' || u.port === '443')
  } catch { return false }
}

const PAIRS: Record<string, string> = { '(': ')', '[': ']', '<': '>', '"': '"', "'": "'", '\u201c': '\u201d', '\u2018': '\u2019' }
const TRAIL = /[,;:!?.]+$/

function isUrl(t: string): boolean {
  if (!/^https:\/\//i.test(t)) return false
  try { return new URL(t).protocol === 'https:' } catch { return false }
}

/**
 * The ONE URL a message token stands for (Sol r5 B8), or null:
 * - a token that is itself a valid https URL is its own and only canonical value (so
 *   "https://example.test/resource." authorizes exactly that, never also the path without the dot);
 * - otherwise trailing , ; : ! ? . outside a wrapper are dropped, and one level of a matched wrapper
 *   pair ((), [], <>, quotes) is removed; the inside must then be a valid URL as it stands.
 * An unmatched closer is never stripped. One token gives at most one URL.
 */
export function canonicalUrl(t: string): string | null {
  if (isUrl(t)) return t
  const bare = t.replace(TRAIL, '')
  if (bare !== t && isUrl(bare)) return bare
  const close = PAIRS[bare[0]]
  if (close && bare.length > 2 && bare.endsWith(close)) {
    const inner = bare.slice(1, -1)
    return isUrl(inner) ? inner : null
  }
  return null
}

/** The URL is the canonical URL of one of the whitespace-separated tokens of his message. */
export function urlInMessage(url: string, text: string): boolean {
  if (!url) return false
  return text.split(/\s+/).some((t) => canonicalUrl(t) === url)
}

function og(html: string, prop: string): string | undefined {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*>`, 'i')
  const tag = html.match(re)?.[0]
  const v = tag?.match(/content=["']([^"']*)["']/i)?.[1]
  return v ? v.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").slice(0, 300) : undefined
}

export async function deskUnfurl(url: string, fetchImpl: typeof fetch = fetch): Promise<{ title?: string; description?: string } | null> {
  try {
    let cur = url
    for (let hop = 0; hop <= 3; hop++) {
      if (!allowedHost(cur)) return null
      const r = await fetchImpl(cur, { redirect: 'manual', headers: { 'User-Agent': 'Mozilla/5.0 (compatible; content-desk)' }, signal: AbortSignal.timeout(6000) })
      if (r.status >= 300 && r.status < 400) {
        const loc = r.headers.get('location')
        if (!loc) return null
        cur = new URL(loc, cur).toString()
        continue
      }
      if (!r.ok) return null
      const reader = r.body?.getReader()
      if (!reader) return null
      let html = ''
      const dec = new TextDecoder()
      while (html.length < 300_000) {
        const { done, value } = await reader.read()
        if (done) break
        html += dec.decode(value, { stream: true })
        if (/<\/head>/i.test(html)) break
      }
      try { await reader.cancel() } catch { /* done */ }
      const title = og(html, 'og:title'), description = og(html, 'og:description')
      return title || description ? { title, description } : null
    }
    return null
  } catch { return null }
}
