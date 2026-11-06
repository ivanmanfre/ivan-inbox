// Line flags on an Ivan draft (db 20261106_post_quality_09, n8n UuEy0EX8igClX88M "Ivan Draft Line Flags").
// qa.line_flags carries: lines the copied author owns or that are tied to the posting day (each a verbatim
// piece of the body, with a short ask), the re-run note (the draft repeats one of his posts), and Ivan's
// "keep as written" stamp for an exact text. Nothing here blocks a post: the Review row highlights the lines
// and Approve asks once.
import { supabase } from './supabase'
import { CLIENT_OPS_GATE } from './content'

export type FlagLine = { text: string; kinds: ('personal' | 'dated')[]; ask: string | null }
export type RerunNote = { postedAt: string | null; impressions: number; bar: number | null; boosted: boolean; url: string | null; heldFrom: string | null }
/** rejected: lines the check proposed that could not be matched to the text (its read is incomplete, Ivan reads it through). */
export type LineFlags = { lines: FlagLine[]; rerun: RerunNote | null; keptSha: string | null; rerunKeptSha: string | null; rejected: number; linesSha: string | null }

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null)
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null)

/** The flags that still apply to this body: a line Ivan already swapped or cut is gone from the text, so it drops out. */
export function lineFlagsOf(raw: unknown, body: string | null): LineFlags | null {
  const lf = obj(raw)
  if (!lf) return null
  const text = body ?? ''
  const byText = new Map<string, FlagLine>()
  for (const x of Array.isArray(lf.lines) ? lf.lines : []) {
    const o = obj(x)
    const t = o && str(o.text)
    const kind = o && (o.kind === 'personal' || o.kind === 'dated') ? o.kind : null
    if (!t || !kind || !text.includes(t)) continue
    const have = byText.get(t)
    if (have) { if (!have.kinds.includes(kind)) have.kinds.push(kind); if (kind === 'dated' && str(o.ask)) have.ask = str(o.ask); continue }
    byText.set(t, { text: t, kinds: [kind], ask: str(o.ask) })
  }
  const r = obj(lf.rerun)
  const rerun: RerunNote | null = r && r.pass === false ? {
    postedAt: str(r.posted_at), impressions: Number(r.impressions) || 0, bar: r.bar == null ? null : Number(r.bar) || null,
    boosted: r.boosted === true, url: str(r.url), heldFrom: str(r.held_from),
  } : null
  const lines = [...byText.values()]
  // A count from an older text no longer applies.
  const rejected = Number(lf.lines_rejected) > 0 ? Number(lf.lines_rejected) : 0
  if (!lines.length && !rerun && !rejected) return null
  return { lines, rerun, keptSha: str(obj(lf.kept)?.sha), rerunKeptSha: str(obj(lf.rerun_kept)?.sha), rejected, linesSha: str(lf.lines_sha) }
}

/** sha256 hex of the body, the same bytes the DB hashes (convert_to(post_body, 'UTF8')). */
export async function bodySha(body: string | null): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body ?? ''))
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')
}

/** Unmatched lines count only for the text the check read: after an edit the old count no longer applies. */
export function rejectedNow(f: LineFlags | null, sha: string | null): number {
  return f && sha && f.linesSha === sha ? f.rejected : 0
}

/** Approve asks once when a flagged line (or a re-run under the bar) is still in the text and not kept for it. */
export function needsKeep(f: LineFlags | null, sha: string | null): boolean {
  if (!f || !sha) return false
  if (f.keptSha === sha) return false
  return f.lines.length > 0 || rejectedNow(f, sha) > 0 || (!!f.rerun && f.rerunKeptSha !== sha)
}

/** The body with one flagged line cut: a whole line goes with its line break, a part of a line goes with its space. */
export function cutLine(body: string, line: string): string {
  const i = body.indexOf(line)
  if (i < 0) return body
  const before = body.slice(0, i), after = body.slice(i + line.length)
  const wholeLine = (before === '' || before.endsWith('\n')) && (after === '' || after.startsWith('\n'))
  let joined: string
  if (wholeLine) joined = before + after.replace(/^\n/, '')
  else {
    const b = before.replace(/[ \t]+$/, ''), a = after.replace(/^[ \t]+/, '')
    const gap = b === '' || b.endsWith('\n') || a === '' || a.startsWith('\n') || /^[,.;:!?)]/.test(a) ? '' : ' '
    joined = b + gap + a
  }
  return joined.replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '').replace(/\s+$/, '')
}

export async function keepLineFlags(id: string, sha: string): Promise<void> {
  const { data, error } = await supabase.rpc('operator_line_flags_keep', { p_gate: CLIENT_OPS_GATE, p_draft: id, p_body_sha: sha })
  if (error) throw new Error(error.message)
  const r = (data ?? {}) as { kept?: boolean; reason?: string }
  if (r.kept !== true) throw new Error(r.reason === 'body_changed' ? 'The text changed elsewhere. Reload and try again.' : 'Not saved.')
}
