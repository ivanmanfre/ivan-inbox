// The day's post card question and weave (db/20261112b_content_card_question): prompt assembly, answer parsing and
// the weave's code checks for content-card-ask and content-card-weave. No I/O except proxyCall's injected fetch, so
// it is unit-tested alone.
//
// The prompt text is the canonical content_prompts row (ivan-card-question / ivan-card-weave, client:ivan), read at
// call time; this file only fills its placeholders. The Railway proxy refuses a `system` field, so the whole prompt
// is the one user turn. Only `type === "text"` blocks are the answer. A refused, capped, empty or malformed answer is
// a transient failure, never a question or a woven post.

export const CARD_MODEL = 'claude-sonnet-5-5'
export const PROMPT_SCOPE = 'client:ivan'
export const ASK_SLUG = 'ivan-card-question'
export const WEAVE_SLUG = 'ivan-card-weave'
export const QUESTION_MAX_WORDS = 22
export const KINDS = ['own_moment', 'own_number', 'own_take', 'own_words'] as const
export type Kind = (typeof KINDS)[number]
export type CardSource = 'own' | 'x_copy' | 'take'

const SOURCE_WORDS: Record<CardSource, string> = {
  own: "Ivan's own post.",
  x_copy: "A near word-for-word copy of another author's post on X. That author's own life (what they did, where they live, their numbers, their identity) is theirs, not Ivan's.",
  take: "Ivan's take on another author's public post, which appears as a screenshot under his text. The author's story and numbers are theirs, not Ivan's.",
}

export function sourceWords(source: unknown, label?: string | null): string {
  const s: CardSource = source === 'x_copy' || source === 'take' ? source : 'own'
  const l = typeof label === 'string' ? label.trim() : ''
  return SOURCE_WORDS[s] + (s !== 'own' && l ? ` Source: ${l.slice(0, 200)}` : '')
}

/** {{KEY}} -> value, literally (no `$` patterns, no regex in the values). */
export function fill(template: string, vars: Record<string, string>): string {
  let out = template
  for (const [k, v] of Object.entries(vars)) out = out.split(`{{${k}}}`).join(v)
  return out
}

function body(content: string, maxTokens: number) {
  return { model: CARD_MODEL, max_tokens: maxTokens, messages: [{ role: 'user' as const, content }] }
}

export type AskInput = { body: string; source?: unknown; source_label?: string | null; hints?: unknown }

export function buildAskBody(prompt: string, i: AskInput) {
  const hints = Array.isArray(i.hints) ? i.hints.filter((h): h is string => typeof h === 'string' && h.trim() !== '') : []
  return body(fill(prompt, {
    SOURCE: sourceWords(i.source, i.source_label),
    HINTS: hints.length ? hints.map(h => `- ${h}`).join('\n') : '(none)',
    DRAFT: i.body,
  }), 600)
}

export type WeaveInput = AskInput & { question: string; anchor: string; answer: string }

export function buildWeaveBody(prompt: string, i: WeaveInput) {
  return body(fill(prompt, {
    SOURCE: sourceWords(i.source, i.source_label),
    QUESTION: i.question,
    ANCHOR: i.anchor,
    ANSWER: i.answer,
    HINTS: '(none)',
    DRAFT: i.body,
  }), 4000)
}

// A capped proxy answers 200 with its limit notice as the "reply" (the content-poland-read guard).
const LIMIT_NOTICE = /\b(usage|session|rate) limit\b|limit reached|try again later/i

type ProxyJson = { content?: { type: string; text?: unknown; [k: string]: unknown }[] }

/** The answer text from text blocks only, or null for nothing usable (empty, refused, a limit notice). */
export function textOf(json: unknown): string | null {
  const blocks = (json as ProxyJson | null)?.content
  if (!Array.isArray(blocks)) return null
  const raw = blocks.filter(b => b?.type === 'text').map(b => (typeof b.text === 'string' ? b.text : '')).join('').trim()
  if (!raw || LIMIT_NOTICE.test(raw)) return null
  return raw
}

function objectOf(raw: string): Record<string, unknown> | null {
  const a = raw.indexOf('{'), b = raw.lastIndexOf('}')
  if (a < 0 || b <= a) return null
  try {
    const o = JSON.parse(raw.slice(a, b + 1))
    return o && typeof o === 'object' && !Array.isArray(o) ? o as Record<string, unknown> : null
  } catch { return null }
}

const EM_DASH = /—|\s–\s/g
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length
/** Sentence-ending question marks: "'GEO?'." inside a quote does not end the sentence. */
const questionEnds = (s: string) => count(s, /\?(?=\s|$)/g)
export const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length

export type AskResult = { has_lived_detail: boolean; question: string | null; anchor: string | null; kind: Kind | null; why: string }
export type AskRead =
  | { ok: true; state: 'asked' | 'none'; result: AskResult }
  | { ok: false; error: string; result?: unknown }

/** The model's answer to the question prompt, checked by what code can check; anything else is a failure. */
export function readAsk(json: unknown, draft: string): AskRead {
  const raw = textOf(json)
  if (!raw) return { ok: false, error: 'refused_or_empty' }
  const o = objectOf(raw)
  if (!o || typeof o.has_lived_detail !== 'boolean') return { ok: false, error: 'malformed' }
  const why = typeof o.why === 'string' ? o.why.trim().slice(0, 300) : ''
  if (o.has_lived_detail) return { ok: true, state: 'none', result: { has_lived_detail: true, question: null, anchor: null, kind: null, why } }
  const q = typeof o.question === 'string' ? o.question.trim() : ''
  const anchor = typeof o.anchor === 'string' ? o.anchor.trim() : ''
  const kind = (KINDS as readonly unknown[]).includes(o.kind) ? o.kind as Kind : null
  const fail = (error: string): AskRead => ({ ok: false, error, result: o })
  if (!q) return fail('no_question')
  if (words(q) > QUESTION_MAX_WORDS) return fail('question_too_long')
  if (count(q, EM_DASH) > 0) return fail('dash')
  if (!q.endsWith('?')) return fail('not_a_question')
  if (questionEnds(q) > 1) return fail('two_questions')
  if (anchor.length < 3 || !draft.includes(anchor)) return fail('anchor_not_in_body')
  if (!kind) return fail('bad_kind')
  return { ok: true, state: 'asked', result: { has_lived_detail: false, question: q, anchor, kind, why } }
}

/** Paragraphs (blank-line separated) with their start offsets, each trimmed for comparison. */
function paragraphs(s: string): { text: string; start: number; end: number }[] {
  const out: { text: string; start: number; end: number }[] = []
  const sep = /\n[ \t]*(?:\n[ \t]*)+/g
  let at = 0
  for (let m = sep.exec(s); m; m = sep.exec(s)) {
    out.push({ text: s.slice(at, m.index).trim(), start: at, end: m.index })
    at = m.index + m[0].length
  }
  out.push({ text: s.slice(at).trim(), start: at, end: s.length })
  return out.filter(p => p.text !== '')
}

/** How much the post may grow: twice the answer plus room for the joining words. */
export const growthBound = (answer: string) => answer.length * 2 + 200

/** The weave's code checks: null when the proposed post keeps every rule code can check, else the failed rule.
 *  Only the paragraph holding the anchor and its immediate neighbours may change; every other paragraph must still be
 *  there verbatim and in place. No new em dash, no new "X, not Y", no closing question, bounded growth. */
export function checkWeave(original: string, proposed: string, anchor: string, answer: string): string | null {
  const o = original.trim(), p = proposed.trim()
  if (!p) return 'empty'
  if (p === o) return 'unchanged'
  const at = anchor ? o.indexOf(anchor) : -1
  if (at < 0) return 'anchor_not_in_body'
  if (count(p, EM_DASH) > count(o, EM_DASH)) return 'dash'
  if (count(p, /,\s+not\s/gi) > count(o, /,\s+not\s/gi)) return 'contrast'
  if (p.length - o.length > growthBound(answer.trim())) return 'too_long'
  const op = paragraphs(o), pp = paragraphs(p).map(x => x.text)
  const last = at + anchor.length - 1
  let lo = op.findIndex(x => at < x.end), hi = op.findIndex(x => last < x.end)
  if (lo < 0) lo = op.length - 1
  if (hi < 0) hi = op.length - 1
  const prefix = op.slice(0, Math.max(0, lo - 1)).map(x => x.text)
  const suffix = op.slice(hi + 2).map(x => x.text)
  if (pp.length < prefix.length + suffix.length) return 'touched_far_paragraph'
  if (prefix.some((t, i) => pp[i] !== t)) return 'touched_far_paragraph'
  if (suffix.some((t, i) => pp[pp.length - suffix.length + i] !== t)) return 'touched_far_paragraph'
  if (/\?\s*$/.test(p) && !/\?\s*$/.test(o)) return 'closing_question'
  return null
}

export type WeaveRead = { ok: true; text: string } | { ok: false; error: string; why?: string }

/** The model's woven post, or why it cannot be offered. The text is only ever a proposal for his own edit. */
export function readWeave(json: unknown, original: string, anchor: string, answer: string): WeaveRead {
  const raw = textOf(json)
  if (!raw) return { ok: false, error: 'refused_or_empty' }
  const o = objectOf(raw)
  if (!o || typeof o.changed !== 'boolean') return { ok: false, error: 'malformed' }
  const why = typeof o.reason === 'string' ? o.reason.trim().slice(0, 300) : undefined
  if (!o.changed) return { ok: false, error: 'unusable', why }
  if (typeof o.body !== 'string') return { ok: false, error: 'malformed' }
  const bad = checkWeave(original, o.body, anchor, answer)
  if (bad) return { ok: false, error: bad, why }
  return { ok: true, text: o.body.trim() }
}

export type ProxyResult = { ok: true; json: unknown } | { ok: false; error: string }

/** One proxy call (Messages shape, no system field). Any HTTP error, timeout or unreadable body is a failure. */
export async function proxyCall(fetchFn: typeof fetch, url: string, key: string, payload: unknown, timeoutMs: number): Promise<ProxyResult> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const res = await fetchFn(url, {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ctl.signal,
    })
    if (!res.ok) { await res.body?.cancel(); return { ok: false, error: `http_${res.status}` } }
    return { ok: true, json: await res.json() }
  } catch {
    return { ok: false, error: ctl.signal.aborted ? 'timeout' : 'fetch_failed' }
  } finally {
    clearTimeout(timer)
  }
}

/** The proxy URL as the other card functions build it (…/v1/messages). */
export function proxyUrl(base: unknown): string {
  let url = String(base ?? '').replace(/\/$/, '')
  if (url && !url.endsWith('/v1/messages')) url += '/v1/messages'
  return url
}

/** The Warsaw calendar day of `now`, YYYY-MM-DD (the card's day). */
export function warsawDay(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

/** sha256 hex of the UTF-8 text: the database's content_card_sha. */
export async function sha256Hex(text: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(d)].map(x => x.toString(16).padStart(2, '0')).join('')
}

export const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
