/* ==========================================================================
   _shared/bot-actions.ts — the SERVER's copy of the bot action block, plus the
   two lines a push is made of.

   Why a copy and not an import: the client's parser is `src/wb/ask/actions.ts`,
   which imports `src/lib/turns.ts` (a browser module, `.ts` extensionless
   imports, ~500 lines of route helpers). An edge function cannot reach into
   `src/`, and pulling that file into Deno would drag the whole route module in
   with it. So the grammar is ported, and the port is held to the client by the
   tests beside this file: the two must agree, because `isActionable()` here
   decides whether Ivan's phone RINGS while `parseActions()` there decides
   whether the message he then opens SHOWS a pill. Change one, change both.

   Grammar (identical to the client, spec section 3):
     - the LAST fenced ```actions block wins
     - a JSON array of 1..3 items
     - ALL OR NOTHING: one bad item drops the whole list, never a partial one
     - label is a non-empty string of at most 40 chars
     - kinds: open | task | fold | reply
     - a missing `payload` wrapper is lifted from the item's own known fields
   ========================================================================== */

export type ActionKind = 'open' | 'task' | 'fold' | 'reply'

export type Action =
  | { label: string; kind: 'open'; payload: { url: string } }
  | { label: string; kind: 'task'; payload: { title: string; body?: string } }
  | { label: string; kind: 'fold'; payload: Record<string, never> }
  | { label: string; kind: 'reply'; payload: { prompt: string } }

export type ParsedActions = { body: string; actions: Action[] }

/** The spec's cap. Three controls is a decision; four is a menu. */
export const MAX_ACTIONS = 3
const LABEL_MAX = 40

/** A pill of one of these kinds is a thing only Ivan can do, so it rings (D4). */
const ACTIONABLE_KINDS: readonly ActionKind[] = ['open', 'task', 'reply']

const BLOCK_RE = /^[ \t]*```[ \t]*actions[ \t]*\r?\n([\s\S]*?)\r?\n?[ \t]*```[ \t]*$/gm

/** Copied from src/lib/turns.ts. A hash with whitespace, a quote or a scheme in
 *  it is not a route, it is someone's idea of one. */
const SAFE_HASH_RE = /^#[A-Za-z0-9/_\-.~!$&'()*+,;=:@%?[\]]*$/

/** src/lib/turns.ts NOTIFICATION_FALLBACK_HASH. See urlOk for why it is refused. */
const FALLBACK_HASH = '#exp/brain-b/today'

/**
 * `https://…`, `./#…`, `/#…`, `#…` and nothing else. Any other scheme is
 * refused: `javascript:` and `http://` both belong to somebody else's
 * navigation on Ivan's phone, and inbox-notify's own validator refuses them too.
 *
 * The one url that looks legal and is not: a link that reduces to the Today
 * hash. The client's `notificationDeepLink` returns that hash as its FALLBACK,
 * so its `urlOk` reads a real link to Today as "this url could not be honoured"
 * and drops the whole block. Refusing it here as well is what keeps the push
 * and the message honest: a phone that rings for a message showing no pills is
 * the defect this file exists to prevent.
 */
function urlOk(url: unknown): url is string {
  if (typeof url !== 'string' || !url.trim()) return false
  const raw = url.trim()
  if (/^https:\/\/\S+$/i.test(raw)) return true
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return false
  const at = raw.indexOf('#')
  if (at < 0) return false
  // './#exp/…' and '/#exp/…' and a bare '#exp/…' all reduce to the same thing.
  const head = raw.slice(0, at)
  if (head && head !== './' && head !== '/' && head !== '.') return false
  const hash = raw.slice(at)
  if (hash.length < 2 || !SAFE_HASH_RE.test(hash)) return false
  return hash !== FALLBACK_HASH
}

const str = (v: unknown, max = Infinity): v is string =>
  typeof v === 'string' && v.trim().length > 0 && v.length <= max

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function toAction(raw: unknown): Action | null {
  if (!isObject(raw)) return null
  const { label, kind, payload } = raw
  if (!str(label, LABEL_MAX)) return null
  if (payload !== undefined && !isObject(payload)) return null
  // A model that writes {"kind":"reply","prompt":"..."} with no payload wrapper
  // said the same thing one level up (seen live on the client). Lift the four
  // known fields only when payload is absent; a present payload is read as written.
  const lifted: Record<string, unknown> = {}
  if (payload === undefined) {
    for (const k of ['url', 'title', 'body', 'prompt'] as const) if (k in raw) lifted[k] = raw[k]
  }
  const p = isObject(payload) ? payload : lifted
  if (kind === 'open') return urlOk(p.url) ? { label, kind, payload: { url: (p.url as string).trim() } } : null
  if (kind === 'task') {
    if (!str(p.title)) return null
    if (p.body !== undefined && typeof p.body !== 'string') return null
    return { label, kind, payload: { title: p.title, ...(typeof p.body === 'string' ? { body: p.body } : {}) } }
  }
  if (kind === 'fold') {
    // `{}` or absent. A fold that carried arguments would be a different act
    // than the one the pill offers, which is "the rows under THIS message".
    return Object.keys(p).length === 0 ? { label, kind, payload: {} } : null
  }
  if (kind === 'reply') return str(p.prompt) ? { label, kind, payload: { prompt: p.prompt } } : null
  return null
}

export function parseActions(text: string): ParsedActions {
  const src = text ?? ''
  const matches = [...src.matchAll(BLOCK_RE)]
  if (!matches.length) return { body: src.trim(), actions: [] }
  const last = matches[matches.length - 1]
  const body = (src.slice(0, last.index) + src.slice(last.index + last[0].length)).trim()

  let parsed: unknown
  try { parsed = JSON.parse(last[1]) } catch { return { body, actions: [] } }
  if (!Array.isArray(parsed)) return { body, actions: [] }
  if (parsed.length < 1 || parsed.length > MAX_ACTIONS) return { body, actions: [] }
  const out: Action[] = []
  for (const item of parsed) {
    const a = toAction(item)
    // All or nothing, same as the client: a list with one bad entry is a list
    // the model did not write.
    if (!a) return { body, actions: [] }
    out.push(a)
  }
  return { body, actions: out }
}

/**
 * Decision D4, said once: a bot turn rings iff it carries at least one pill of
 * kind open, task or reply. `fold`-only and an empty array are QUIET, because
 * the brief only lets a pill exist for his money, a send to a person outside
 * the company, new copy to approve or a taste call. No keyword list on the
 * prose: the pills are the decision.
 */
export function isActionable(actions: readonly Action[]): boolean {
  return actions.some((a) => ACTIONABLE_KINDS.includes(a.kind))
}

const TITLE_MAX = 60
const BODY_MAX = 140

/**
 * Markdown out of a line that is about to become an OS notification title.
 * Strips a heading or bullet marker off the front and `**`, `*` and backticks
 * anywhere, so `**Lead scoring:** 3 rows` reads as `Lead scoring: 3 rows` on
 * the lock screen instead of leaking the model's formatting.
 */
function stripEmphasis(line: string): string {
  return line
    .replace(/^\s*#{1,6}\s+/, '')
    .replace(/^\s*#{1,6}$/, '')
    .replace(/^\s*[-*+]\s+/, '')
    .replace(/\*\*/g, '')
    .replace(/[*`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Cut on a word when there is a word boundary to cut on, else hard. A title cut
 *  mid-word reads as a truncated bug rather than a short sentence. */
function cutOnWord(s: string, max: number): string {
  if (s.length <= max) return s
  const head = s.slice(0, max)
  const at = head.lastIndexOf(' ')
  return (at > max * 0.5 ? head.slice(0, at) : head).trimEnd()
}

/** The first line of prose, as the push title. 60 chars is what a phone shows. */
export function pushTitleFrom(body: string): string {
  for (const raw of (body ?? '').split(/\r?\n/)) {
    const line = stripEmphasis(raw)
    if (line) return cutOnWord(line, TITLE_MAX)
  }
  return ''
}

/** Everything after that first line, collapsed onto one line, as the push body. */
export function pushBodyFrom(body: string): string {
  const lines = (body ?? '').split(/\r?\n/)
  let i = 0
  while (i < lines.length && !stripEmphasis(lines[i])) i++
  const rest = lines.slice(i + 1).map(stripEmphasis).filter(Boolean).join(' ')
  return rest.replace(/\s+/g, ' ').trim().slice(0, BODY_MAX)
}
