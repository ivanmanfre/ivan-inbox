import { supabase } from './supabase'

// unfurl.ts — "what is behind this link", asked of the broker rather than of the
// browser.
//
// The browser cannot fetch a YouTube or LinkedIn page itself: no CORS header, no
// og tags reachable, and a phone on cellular should not be pulling a megabyte of
// someone's marketing page to find a title. `inbox-claude` takes a second mode,
// `POST { unfurl: url }`, does the fetch server-side and returns the five fields
// worth rendering.
//
// TRANSPORT RULE, same as claude.ts and today.ts: bare fetch(), NEVER
// supabase.functions.invoke() — invoke() attaches an X-Client-Info header that
// this project's function CORS rejects in preflight.
//
// This never throws. A link preview is decoration on a message; a rejected
// promise on the way to decoration would take the message down with it.

const FN_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/inbox-claude`

export type LinkKind = 'youtube' | 'linkedin' | 'instagram' | 'other'
export type UnfurlKind = 'youtube' | 'linkedin' | 'instagram' | 'og'

export type UnfurlOk = {
  ok: true
  kind: UnfurlKind
  url: string
  title: string
  description: string | null
  image: string | null
  site: string | null
  author: string | null
}

// A named reason, not a boolean. "Instagram refused a logged-out fetch" and "the
// broker is down" are different sentences, and the surface that renders a dead
// preview should be able to tell them apart.
export type UnfurlFail = { ok: false; url: string; kind?: string; reason: string }

export type UnfurlResult = UnfurlOk | UnfurlFail

// ---------- link detection (pure) ----------

// Deliberately conservative: an unescaped bare URL in prose runs until
// whitespace, and trailing sentence punctuation is not part of it.
const URL_RE = /https?:\/\/[^\s<>"']+/gi
const TRAILING = /[.,;:!?)\]}'"]+$/

export type DetectedLink = { url: string; kind: LinkKind }

export function classifyLink(url: string): LinkKind {
  let host: string
  try { host = new URL(url).hostname.toLowerCase().replace(/^www\./, '') } catch { return 'other' }
  if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtu.be'
    || host.endsWith('.youtube.com')) return 'youtube'
  if (host === 'linkedin.com' || host.endsWith('.linkedin.com')) return 'linkedin'
  if (host === 'instagram.com' || host.endsWith('.instagram.com')) return 'instagram'
  return 'other'
}

/**
 * Every http(s) link in a block of prose, in first-seen order, de-duplicated.
 * Pure: this is what decides whether a message gets a preview at all, so it is
 * testable without a network and without a DOM.
 */
export function detectLinks(text: string): DetectedLink[] {
  const out: DetectedLink[] = []
  const seen = new Set<string>()
  for (const raw of text.match(URL_RE) ?? []) {
    const url = raw.replace(TRAILING, '')
    if (url.length < 12 || seen.has(url)) continue
    seen.add(url)
    out.push({ url, kind: classifyLink(url) })
  }
  return out
}

// ---------- the call ----------

// Per-isolate, per-URL. The broker caches for 10 minutes on its side; this cache
// stops the SAME pane re-asking every time it re-renders. Only successes are
// kept: a failure that is cached forever is a preview that can never come back,
// and the common failures here (a cold broker, a flaky page) are transient.
const cache = new Map<string, UnfurlResult>()
const inflight = new Map<string, Promise<UnfurlResult>>()

export function clearUnfurlCache(): void {
  cache.clear()
  inflight.clear()
}

function bad(url: string, reason: string): UnfurlFail {
  return { ok: false, url, reason }
}

export async function unfurl(url: string): Promise<UnfurlResult> {
  const key = url.trim()
  if (!/^https?:\/\//i.test(key)) return bad(url, 'not_a_url')
  const hit = cache.get(key)
  if (hit) return hit
  const pending = inflight.get(key)
  if (pending) return pending

  const run = (async (): Promise<UnfurlResult> => {
    try {
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token
      if (!token) return bad(key, 'not_signed_in')
      const res = await fetch(FN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ unfurl: key }),
      })
      const body = await res.json().catch(() => null) as Record<string, unknown> | null
      if (!res.ok) {
        const reason = typeof body?.error === 'string' ? body.error : `http_${res.status}`
        return { ok: false, url: key, reason }
      }
      if (!body || body.ok !== true) {
        return {
          ok: false, url: key,
          kind: typeof body?.kind === 'string' ? body.kind : undefined,
          reason: typeof body?.reason === 'string' ? body.reason : 'no_preview',
        }
      }
      // A preview with no title is not a preview. The broker already refuses to
      // invent one (01-api.md B4: an empty Instagram title comes back
      // ok:false/blocked); this is the second lock on the same rule.
      const title = typeof body.title === 'string' ? body.title.trim() : ''
      if (!title) return { ok: false, url: key, reason: 'no_title' }
      const str = (k: string): string | null =>
        typeof body[k] === 'string' && body[k] ? body[k] as string : null
      return {
        ok: true,
        kind: (typeof body.kind === 'string' ? body.kind : 'og') as UnfurlKind,
        url: typeof body.url === 'string' ? body.url : key,
        title,
        description: str('description'),
        image: str('image'),
        site: str('site'),
        author: str('author'),
      }
    } catch (e) {
      return bad(key, e instanceof Error ? e.message : 'unreachable')
    }
  })()

  inflight.set(key, run)
  const result = await run
  inflight.delete(key)
  if (result.ok) cache.set(key, result)
  return result
}
