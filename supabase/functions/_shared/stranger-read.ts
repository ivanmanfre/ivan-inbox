// The pure parts of content-stranger-read (db/20261114f_content_stranger_read). No proxy, no DB.
//
// A cold reader reads one of Ivan's brain-written business drafts with no context and says whether its point lands.
// The prompt row ivan-stranger-read (client:ivan) is read at call time; it is filled with the post and sent as the
// user turn (the Railway proxy refuses a `system` field). Two reads per text; it passes only when BOTH reads pass.
// 11-14 replay: GEO failed 6 of 7 single reads (so "held when both fail" let it through once in a live dry run),
// published brain posts passed 8 of 8 reads, 1 of 19 clear Review drafts failed 1 read of 4. A held brain draft only
// misses the automatic pick and placement; it stays in Review for Ivan.
import { CARD_MODEL, fill, textOf } from './content-card.ts'

export const STRANGER_SLUG = 'ivan-stranger-read'
export const STRANGER_MODEL = CARD_MODEL
export const READS = 2

export type Read = { verdict: 'pass' | 'fail'; topic: string; missing: string; blocking: string[] }
export type ReadResult = { ok: true; read: Read } | { ok: false; error: string }

export function buildStrangerBody(prompt: string, body: string) {
  return { model: STRANGER_MODEL, max_tokens: 1200, messages: [{ role: 'user' as const, content: fill(prompt, { BODY: body }) }] }
}

/** One read from the proxy's answer. Anything that is not a clean, consistent verdict is an error (never a guessed
 *  verdict): every field must have its type, a pass has no blocking question and no missing sentence, a fail has at
 *  least one blocking question. */
export function readStranger(json: unknown): ReadResult {
  const raw = textOf(json)
  if (raw == null) return { ok: false, error: 'empty_or_refused' }
  const a = raw.indexOf('{'), b = raw.lastIndexOf('}')
  if (a < 0 || b <= a) return { ok: false, error: 'no_json' }
  let o: Record<string, unknown>
  try {
    const p = JSON.parse(raw.slice(a, b + 1))
    if (!p || typeof p !== 'object' || Array.isArray(p)) return { ok: false, error: 'no_json' }
    o = p as Record<string, unknown>
  } catch { return { ok: false, error: 'bad_json' } }
  const verdict = o.verdict
  if (verdict !== 'pass' && verdict !== 'fail') return { ok: false, error: 'bad_verdict' }
  if (typeof o.topic !== 'string' || typeof o.missing !== 'string' || !Array.isArray(o.blocking)
      || o.blocking.some(q => typeof q !== 'string')) return { ok: false, error: 'bad_fields' }
  const topic = o.topic.trim(), missing = o.missing.trim()
  const blocking = (o.blocking as string[]).map(q => q.trim()).filter(Boolean)
  if (!topic) return { ok: false, error: 'no_topic' }
  if (verdict === 'pass' && (blocking.length > 0 || missing)) return { ok: false, error: 'pass_with_gaps' }
  if (verdict === 'fail' && blocking.length === 0) return { ok: false, error: 'fail_without_reason' }
  return { ok: true, read: { verdict, topic: topic.slice(0, 400), missing: missing.slice(0, 400), blocking: blocking.slice(0, 8).map(q => q.slice(0, 300)) } }
}

export type Combined =
  | { verdict: 'pass' | 'fail'; reason: string; detail: { reads: Read[] } }
  | { verdict: null; error: string }

/** The stored result for one text: pass only when all READS clean reads pass; fail when any clean read fails (its
 *  reason is stored). Fewer clean reads than READS = no verdict (the attempt is counted and retried). */
export function combine(results: ReadResult[]): Combined {
  const reads = results.filter((r): r is { ok: true; read: Read } => r.ok).map(r => r.read)
  if (reads.length < READS) {
    const err = results.find((r): r is { ok: false; error: string } => !r.ok)
    return { verdict: null, error: err ? err.error : 'too_few_reads' }
  }
  const fails = reads.filter(r => r.verdict === 'fail')
  if (fails.length > 0) {
    const f = fails[0]
    return { verdict: 'fail', reason: f.missing || f.blocking[0], detail: { reads } }
  }
  return { verdict: 'pass', reason: reads.find(r => r.verdict === 'pass')!.topic, detail: { reads } }
}
