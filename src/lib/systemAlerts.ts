import { supabase } from './supabase'

// system_alerts (db/027) — infrastructure facts that carry a deadline.
//
// The first of them is the Instagram grant behind the Rise mirror: Meta caps an
// Instagram Login long-lived token at 60 days, and once it lapses it cannot be
// refreshed at all, so recovery is the client clicking a fresh connect link.
// The failure is silent — posts start failing and the feed says nothing — which
// is exactly the class of thing that has to arrive somewhere Ivan reads.
//
// Why not the tables that already exist. n8nclaw_proactive_alerts is rendered
// only as a COUNT of rows OLDER than 14 days, captioned "historical, not
// actionable here" (ContentList.tsx), so a fresh row there is invisible for two
// weeks and then labelled history. ops_drafts approve POSTS TO A CLIENT SLACK
// CHANNEL. Neither one can carry this.

export type Severity = 'info' | 'warn' | 'critical'

export type SystemAlert = {
  id: string
  source: string
  dedupe_key: string
  severity: Severity
  title: string
  body: string | null
  action_url: string | null
  action_label: string | null
  created_at: string
  resolved_at: string | null
}

export const SYSTEM_ALERTS_TABLE = 'system_alerts'

const COLS = 'id, source, dedupe_key, severity, title, body, action_url, action_label, created_at, resolved_at'

// Open rows only. A dismissed alert is gone from the surface for good: the
// writer's dedupe_key is unique, so nothing re-inserts the same warning and
// nothing resurrects a row Ivan has already read.
export async function fetchSystemAlerts(limit = 20): Promise<SystemAlert[]> {
  const { data, error } = await supabase.from(SYSTEM_ALERTS_TABLE)
    .select(COLS)
    .is('resolved_at', null)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []) as unknown as SystemAlert[]
}

export async function dismissSystemAlert(id: string): Promise<void> {
  const { error } = await supabase.from(SYSTEM_ALERTS_TABLE)
    .update({ resolved_at: new Date().toISOString(), resolved_by: 'inbox' })
    .eq('id', id)
  if (error) throw error
}

const RANK: Record<Severity, number> = { critical: 0, warn: 1, info: 2 }

// Worst first, then newest. A critical row that landed on Monday outranks a
// warn that landed this morning: the ordering is by what it costs to ignore,
// never by when it arrived.
export function rankAlerts(rows: SystemAlert[]): SystemAlert[] {
  return rows.slice().sort((a, b) => {
    const r = (RANK[a.severity] ?? 3) - (RANK[b.severity] ?? 3)
    if (r !== 0) return r
    return Date.parse(b.created_at) - Date.parse(a.created_at)
  })
}

// The strip's own headline. Counting severities rather than printing a bare
// total, because "1 alert" and "1 critical alert" are different sentences and
// only one of them says whether to stop what you are doing.
//
// Loosened to `{ severity }[]` (not `SystemAlert[]`) so it can be fed either
// the raw fetch or the deduped/shaped list below — a SystemAlert satisfies
// this structurally, so nothing that already calls this changes.
export function alertSummary(rows: { severity: Severity }[]): string {
  const n = (s: Severity) => rows.filter(r => r.severity === s).length
  const parts = [
    n('critical') > 0 && `${n('critical')} critical`,
    n('warn') > 0 && `${n('warn')} warning${n('warn') === 1 ? '' : 's'}`,
    n('info') > 0 && `${n('info')} note${n('info') === 1 ? '' : 's'}`,
  ].filter(Boolean) as string[]
  return parts.join(' · ')
}

/* ============================================================================
   THE BRIEFING SHAPE (pass 3).

   The live surface measured 2026-08-21: 20 rows (fetchSystemAlerts caps at
   20), 1 byte-identical duplicate (bennett-ca, same title, same body, two
   different dedupe_keys a day apart — the writer's dedupe_key demonstrably
   does not prevent this), 6 separate scan-integrity warnings whose body is
   the exact string "- Meta unread, no ad claim shipped: unknown" for six
   different stores, 3 more sharing "- all 12 surfaced competitor
   advertiser(s)…", and one CRITICAL row whose body concatenates a WARN block
   for a second lane onto its own string. Every rule below is built off that
   real payload, not an invented shape — see phase3-today.md for the pulled
   fixtures.

   DEDUPE vs GROUP is a real distinction, not two names for one idea:
     - DEDUPE collapses a row that repeats the same SUBJECT (source + title)
       and the same BODY under a new id — the same event, re-inserted. Two
       rows about six different stores are not duplicates of each other even
       when their body text is identical; collapsing them by body alone would
       silently drop five stores' worth of information.
     - GROUP folds rows that share a FAILURE SHAPE (source + severity + body
       with digits stripped) into one row that counts them and keeps every
       member reachable. This is where "six identical bodies" actually gets
       handled, and it is why digits/ids are stripped for the comparison only
       — never from what a member displays.
   ============================================================================ */

const SEV_LABEL: Record<Severity, string> = { critical: 'CRITICAL', warn: 'WARN', info: 'INFO' }

function foldWhitespace(s: string): string {
  return s.trim().replace(/\s+/g, ' ')
}

function normalize(s: string | null | undefined): string {
  return foldWhitespace(s ?? '').toLowerCase()
}

function firstLine(s: string): string {
  return foldWhitespace(s.split('\n')[0] ?? '')
}

// The raw glyph this pass retires as a severity signal. Stripped from the
// title text itself so the drawn mark + text label is the only signal left,
// never a mixed glyph-plus-word.
const LEADING_EMOJI = /^[\u{1F300}-\u{1FAFF}\u{2190}-\u{27BF}\u{2B00}-\u{2BFF}\u{2600}-\u{26FF}️]+\s*/u
export function cleanTitle(title: string): string {
  return foldWhitespace(title.replace(LEADING_EMOJI, ''))
}

// digits are the part of a template that VARIES ("1 sent", "23.5/day", "51%");
// stripping them for the comparison is what makes two rows about the same
// recurring check (fired on two different days, with two different counts)
// read as one shape. Never applied to displayed text.
function shapeOf(body: string | null): string {
  return normalize(body).replace(/\d+(\.\d+)?/g, '#')
}

// A group's own title has to name the shape, not one member's specific
// subject. Stripping everything from the first colon on turns
// "Scan integrity: bennett-ca" into "Scan integrity" — the part every member
// in a scan-integrity group actually shares.
function baseShapeTitle(title: string): string {
  const t = cleanTitle(title)
  const i = t.indexOf(':')
  return (i > -1 ? t.slice(0, i) : t).trim()
}

/* ---- 5. split the concatenated card ---------------------------------- */

// A CRITICAL card carrying "CRITICAL\n…\nWARN\n…" inside its own body string
// is two alerts wearing one row. Only splits when the body's OWN first
// marker matches the row's declared severity (so an unrelated all-caps line
// — a store name, a lane name — can never be mistaken for a second alert),
// and duplicates any trailing shared telemetry onto both halves rather than
// dropping it from either.
export function splitConcatenated(a: SystemAlert): SystemAlert[] {
  const body = a.body
  if (!body) return [a]
  const m = body.match(/^(CRITICAL|WARN|INFO)\n([\s\S]*?)\n(CRITICAL|WARN|INFO)\n([\s\S]*)$/)
  if (!m) return [a]
  const [, firstMark, firstText, secondMark, rest] = m
  if (firstMark !== SEV_LABEL[a.severity]) return [a]
  const secondSeverity = (Object.keys(SEV_LABEL) as Severity[]).find(s => SEV_LABEL[s] === secondMark)
  if (!secondSeverity || secondSeverity === a.severity) return [a]

  const blank = rest.indexOf('\n\n')
  const secondText = blank > -1 ? rest.slice(0, blank) : rest
  const shared = blank > -1 ? rest.slice(blank + 2) : ''

  const firstBody = shared ? `${firstMark}\n${firstText}\n\n${shared}` : `${firstMark}\n${firstText}`
  const secondBody = shared ? `${secondMark}\n${secondText}\n\n${shared}` : `${secondMark}\n${secondText}`

  return [
    { ...a, body: firstBody },
    {
      ...a,
      severity: secondSeverity,
      // The row's own title belongs to the FIRST severity. The split-out
      // second half gets an honest, generic label rather than a guessed
      // rewrite of the original title — "also flagged" is true of every
      // source this can ever fire for, and invents nothing.
      title: `Also flagged: ${firstLine(secondText) || SEV_LABEL[secondSeverity].toLowerCase()}`,
      body: secondBody,
    },
  ]
}

/* ---- 1. dedupe on identical body --------------------------------------- */

export type AlertMember = {
  // Every real system_alerts.id folded into this member. >1 only when two
  // rows were byte-identical duplicates (same source, title and body) — a
  // split-derived pair still carries the ONE id its raw row had, since it is
  // one database row and dismissing it can only resolve that one row.
  ids: string[]
  source: string
  severity: Severity
  title: string
  body: string | null
  action_url: string | null
  action_label: string | null
  created_at: string
}

function severityRank(s: Severity): number {
  return s === 'critical' ? 0 : s === 'warn' ? 1 : 2
}

function worseOrNewer(a: SystemAlert, b: { severity: Severity; created_at: string }): boolean {
  const ra = severityRank(a.severity), rb = severityRank(b.severity)
  if (ra !== rb) return ra < rb
  return Date.parse(a.created_at) > Date.parse(b.created_at)
}

// Two rows are the SAME alert, re-inserted, only when source, title AND body
// all match after normalizing. Six rows about six different stores share a
// body but not a title, so they survive dedupe untouched — folding them here
// would silently drop five stores' worth of information, which grouping
// (below) is built to keep instead.
export function dedupeAlerts(rows: SystemAlert[]): AlertMember[] {
  const bySig = new Map<string, AlertMember>()
  for (const r of rows) {
    const sig = `${r.source}|${normalize(r.title)}|${normalize(r.body)}`
    const existing = bySig.get(sig)
    if (!existing) {
      bySig.set(sig, {
        ids: [r.id], source: r.source, severity: r.severity, title: cleanTitle(r.title),
        body: r.body, action_url: r.action_url, action_label: r.action_label, created_at: r.created_at,
      })
      continue
    }
    existing.ids.push(r.id)
    if (worseOrNewer(r, existing)) {
      existing.severity = r.severity
      existing.title = cleanTitle(r.title)
      existing.body = r.body
      existing.action_url = r.action_url
      existing.action_label = r.action_label
    }
    if (Date.parse(r.created_at) > Date.parse(existing.created_at)) existing.created_at = r.created_at
  }
  return [...bySig.values()]
}

/* ---- 2. group by kind with a count ------------------------------------- */

export type AlertGroup = {
  key: string
  severity: Severity
  members: AlertMember[]   // newest first
  count: number
  newestCreatedAt: string
}

// The domain word a group's count is counted IN. Grounded in the source name
// itself (dtc_scan_integrity fires once per store scan) rather than invented
// — anything without a known noun falls back to the generic "alerts".
const GROUP_NOUN: Record<string, string> = { dtc_scan_integrity: 'stores' }

export function groupAlerts(members: AlertMember[]): AlertGroup[] {
  const byKey = new Map<string, AlertMember[]>()
  for (const m of members) {
    const key = `${m.severity}|${m.source}|${shapeOf(m.body)}`
    const list = byKey.get(key)
    if (list) list.push(m)
    else byKey.set(key, [m])
  }
  return [...byKey.entries()].map(([key, list]) => {
    const sorted = list.slice().sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    return { key, severity: sorted[0].severity, members: sorted, count: sorted.length, newestCreatedAt: sorted[0].created_at }
  })
}

// Worst first, then newest — the same ordering rankAlerts already applies to
// raw rows, restated for the shaped list the strip actually renders.
export function rankGroups(groups: AlertGroup[]): AlertGroup[] {
  return groups.slice().sort((a, b) => {
    const r = severityRank(a.severity) - severityRank(b.severity)
    if (r !== 0) return r
    return Date.parse(b.newestCreatedAt) - Date.parse(a.newestCreatedAt)
  })
}

/* ---- 3. lead with the number: the group's own headline ----------------- */

// The dominant base title among a group's members — "Scan integrity" for six
// members all titled "Scan integrity: <store>", picked by majority rather
// than assumed, so a group whose members disagree on wording still resolves
// to whichever title is actually true of most of them.
function modeBaseTitle(members: AlertMember[]): string {
  const counts = new Map<string, number>()
  for (const m of members) counts.set(baseShapeTitle(m.title), (counts.get(baseShapeTitle(m.title)) ?? 0) + 1)
  let best = baseShapeTitle(members[0]?.title ?? ''), bestN = 0
  for (const [k, n] of counts) if (n > bestN) { best = k; bestN = n }
  return best
}

// "Scan integrity · 6 stores, same failure" — the count as a figure, the
// shape named, nothing about any one member invented.
export function groupHeadline(g: AlertGroup): string {
  const noun = GROUP_NOUN[g.members[0]?.source ?? ''] ?? 'alerts'
  return `${modeBaseTitle(g.members)} · ${g.count} ${noun}, same failure`
}

/* ---- 4. the human line vs the raw telemetry ---------------------------- */

function isMarkerLine(l: string): boolean {
  return l === 'CRITICAL' || l === 'WARN' || l === 'INFO'
}

// The row's own severity marker ("CRITICAL" / "WARN") is a leftover of the
// split above, not a sentence — it must never surface as the visible
// preview. This picks the first REAL line for display and returns every
// other line for the raw disclosure, so nothing is lost, only reordered.
export function bodyPreview(body: string | null): { preview: string | null; rest: string[] } {
  if (!body) return { preview: null, rest: [] }
  const lines = body.split('\n').map(l => l.trim()).filter(l => l.length > 0)
  const idx = lines.findIndex(l => !isMarkerLine(l))
  if (idx === -1) return { preview: null, rest: [] }
  // Every OTHER marker line (splitConcatenated already extracted the one that
  // mattered into its own row; a second one here is plumbing, not content)
  // is dropped from the raw disclosure too, not just the preview.
  return { preview: lines[idx].replace(/^-\s*/, ''), rest: lines.filter((l, i) => i !== idx && !isMarkerLine(l)) }
}

/* ---- the pipeline the component actually calls -------------------------- */

// split -> dedupe -> group -> rank. Each stage is independently testable
// above; this is only their composition.
export function shapeAlerts(rows: SystemAlert[]): AlertGroup[] {
  return rankGroups(groupAlerts(dedupeAlerts(rows.flatMap(splitConcatenated))))
}
