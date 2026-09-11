/* ==========================================================================
   src/wb/ask/actions.ts: the bot's action block.

   Spec section 3. A bot answer MAY end with a fenced block:

     ```actions
     [{"label":"Open the lane","kind":"open","payload":{"url":"./#exp/brain-b/sends"}}]
     ```

   This file is the only thing that decides whether that block becomes controls.
   Its posture is the one the spec wrote down: ANY violation drops the WHOLE
   block and renders the message without pills. Never a partial list, never a
   throw, never an error put in front of Ivan for something a model wrote
   slightly wrong. The prose is the message; the pills are a convenience.

   `body` always has the block removed, valid or not. A raw JSON fence in the
   middle of a conversation is the surface leaking its own contract.
   ========================================================================== */
import { notificationDeepLink, NOTIFICATION_FALLBACK_HASH } from '../../lib/turns'

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

// The LAST fenced `actions` block wins. A model that reconsidered and wrote a
// second one meant the second one, and a block that is not last is prose about
// actions rather than the actions themselves.
const BLOCK_RE = /^[ \t]*```[ \t]*actions[ \t]*\r?\n([\s\S]*?)\r?\n?[ \t]*```[ \t]*$/gm

/**
 * The same test the notification deep link applies, said once.
 *
 * A relative hash resolves to a route this app really has; anything with a
 * scheme falls back, so `javascript:` and `http://` both come back as the
 * fallback and are refused here. `https://` is allowed through as an external
 * link, which is exactly what inbox-notify permits.
 */
function urlOk(url: unknown): url is string {
  if (typeof url !== 'string' || !url.trim()) return false
  const raw = url.trim()
  if (/^https:\/\/\S+$/i.test(raw)) return true
  // Not https: it must be a route this app will actually navigate. A url that
  // falls back is a url this surface could not honour, so it is a violation
  // rather than a link to the Today screen nobody asked for.
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return false
  return notificationDeepLink({ url: raw }) !== NOTIFICATION_FALLBACK_HASH
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
  // said the same thing one level up (seen live, skeptic S2 attempt 2). Lift the
  // four known fields into the payload only when payload is absent; a present
  // payload is read as written.
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
    // All or nothing. A list with one bad entry is a list the model did not
    // write; rendering the survivors would be this surface guessing at intent.
    if (!a) return { body, actions: [] }
    out.push(a)
  }
  return { body, actions: out }
}
