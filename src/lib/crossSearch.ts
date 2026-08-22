import { supabase } from './supabase'
import { LANE_LABEL, laneFilter, type ContentLane } from './content'
import { label } from './labels'

// CROSS-OBJECT SEARCH. Not an AI feature, and deliberately so: the measured
// problem is that four unlinked boxes each see one surface, and a keyword
// index over tables already reachable fixes it with no model, no embedding
// column, no new dependency and no new spend.
//
// WHAT WAS MEASURED (usage-evidence.md T5). Four search fields, none of them
// linked: DMs searches loaded threads, Content searches `title` and `topic` and
// NOT `post_body` (ContentList.tsx passes `d => [d.title, d.topic]` even though
// `post_body` is already selected), Magnets searches topic, and the palette can
// only offer rows that are in the DOM, which for the windowed DM list is
// roughly 12 to 25 of 139. Answering "what did we say to this person and what
// content have we made about their objection" cost 6-plus interactions across
// two surfaces and two refetches.
//
// 🔴 TENANCY IS THE WHOLE DESIGN, not a filter added at the end.
//
// Every query below is scoped to exactly ONE lane, and the lane is a required
// argument with no default, so there is no code path that runs a filterless
// search. A result therefore cannot carry another client's row into the lane
// Ivan is looking at, and the proof is that the per-lane counts sum to the
// unfiltered count with nothing left over (evidence/ai-tools/tenancy-probe.md).
//
// 🔴 AND THE TWO TABLES SPELL IVAN DIFFERENTLY. `carousel_drafts` and
// `lm_drafts_v2` write Ivan as `client_id IS NULL`; `inbox_messages_v` writes
// him as the literal `'ivan'` (2,863 rows). Using one filter shape for both
// returns a calm, empty, wrong result on half the search, which is exactly the
// failure `laneFilter`'s own comment was written about. So content goes through
// `laneFilter` and DMs go through `dmLaneValue`, and both are unit-tested.
//
// Constraints honoured: PostgREST clamps a select at 1000 rows whatever `limit`
// says, so every query is bounded well under it; `not.eq` is never used because
// it drops NULLs; no `in()` filter is built, so the 16KB URL ceiling is never
// approached.

export type CrossSurface = 'dm' | 'draft' | 'magnet'

export type CrossHit = {
  surface: CrossSurface
  /** The id the app opens: a prospect for a conversation, a row id otherwise. */
  id: string
  title: string
  sub: string
  snippet: string
  lane: ContentLane
  /** Only on drafts and magnets, so the window can open with a real queue row. */
  row?: { id: string; title: string; type: string | null; updated_at: string; status: string }
}

export type CrossResults = {
  hits: CrossHit[]
  counts: Record<CrossSurface, number>
  lane: ContentLane
  /** A surface that failed says so by name instead of silently returning nothing. */
  failed: string[]
}

export const CROSS_MIN = 2
const PER_SURFACE = 40
const DM_SCAN = 200
const SNIPPET = 110

/**
 * How DMs name a lane. `inbox_messages_v.client_id` holds the literal 'ivan',
 * unlike the content tables, and `arch` has zero rows there today, which is a
 * real answer and not a bug: the DM engine runs two tenants and the content
 * engine runs three.
 */
export function dmLaneValue(lane: ContentLane): string { return lane }

/**
 * PostgREST's `or=(...)` is parsed as a comma-separated list inside brackets,
 * so a query containing a comma, a bracket or a quote would rewrite the filter
 * rather than be searched for. Those characters are dropped, `%` and `_` lose
 * their wildcard meaning, and `*` is reserved as ilike's own wildcard here.
 */
export function safeTerm(q: string): string {
  return q
    .replace(/[,()"']/g, ' ')
    .replace(/[%_*\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * The body of PostgREST's `or=(...)`, which is what supabase-js `.or()` takes:
 * the comma-separated list WITHOUT the surrounding brackets.
 */
export function orIlike(cols: string[], term: string): string {
  return cols.map(c => `${c}.ilike.*${term}*`).join(',')
}

/** The matched words in context, so a hit says WHY it is a hit. */
export function snippet(text: string | null | undefined, term: string, width = SNIPPET): string {
  const t = (text ?? '').replace(/\s+/g, ' ').trim()
  if (!t) return ''
  const at = t.toLowerCase().indexOf(term.toLowerCase())
  if (at < 0) return t.length <= width ? t : `${t.slice(0, width)}…`
  const from = Math.max(0, at - Math.floor(width / 3))
  const cut = t.slice(from, from + width)
  return `${from > 0 ? '…' : ''}${cut}${from + width < t.length ? '…' : ''}`
}

/**
 * One conversation per person. The DM query returns MESSAGES, and a person who
 * said "margin" four times is one row on any list Ivan would want to read.
 * Newest match wins, because the query orders newest first.
 */
export function dedupeByProspect(hits: CrossHit[]): CrossHit[] {
  const seen = new Set<string>()
  const out: CrossHit[] = []
  for (const h of hits) {
    if (seen.has(h.id)) continue
    seen.add(h.id)
    out.push(h)
  }
  return out
}

type DmRow = {
  prospect_id: string; prospect_name: string | null; prospect_company: string | null
  client_id: string | null; message_text: string | null; direction: string | null
  created_at: string | null
}

type DraftRow = {
  id: string; title: string | null; topic: string | null; post_body: string | null
  status: string | null; type: string | null; updated_at: string | null
}

type MagnetRow = {
  id: string; topic: string | null; description: string | null; post_body: string | null
  status: string | null; updated_at: string | null
}

/**
 * The whole search, one lane, three surfaces, in parallel. Read only: every
 * call here is a select, and there is no write verb anywhere in this file.
 */
export async function crossSearch(query: string, lane: ContentLane): Promise<CrossResults> {
  const term = safeTerm(query)
  const empty: CrossResults = { hits: [], counts: { dm: 0, draft: 0, magnet: 0 }, lane, failed: [] }
  if (term.length < CROSS_MIN) return empty

  const f = laneFilter(lane)

  let draftQ = supabase.from('carousel_drafts')
    .select('id,title,topic,post_body,status,type,updated_at')
  draftQ = f.op === 'is' ? draftQ.is(f.column, null) : draftQ.eq(f.column, f.value)

  let magnetQ = supabase.from('lm_drafts_v2')
    .select('id,topic,description,post_body,status,updated_at')
  magnetQ = f.op === 'is' ? magnetQ.is(f.column, null) : magnetQ.eq(f.column, f.value)

  const [dm, draft, magnet] = await Promise.allSettled([
    supabase.from('inbox_messages_v')
      .select('prospect_id,prospect_name,prospect_company,client_id,message_text,direction,created_at')
      // The DM lane is the LITERAL, never laneFilter's null shape.
      .eq('client_id', dmLaneValue(lane))
      .or(orIlike(['prospect_name', 'prospect_company', 'message_text'], term))
      .order('created_at', { ascending: false })
      .limit(DM_SCAN),
    draftQ
      .or(orIlike(['title', 'topic', 'post_body'], term))
      .order('updated_at', { ascending: false })
      .limit(PER_SURFACE),
    magnetQ
      .or(orIlike(['topic', 'description', 'post_body'], term))
      .order('updated_at', { ascending: false })
      .limit(PER_SURFACE),
  ])

  const failed: string[] = []
  const hits: CrossHit[] = []

  if (dm.status === 'fulfilled' && !dm.value.error) {
    const rows = (dm.value.data ?? []) as DmRow[]
    const mapped = rows.map((r): CrossHit => ({
      surface: 'dm',
      id: r.prospect_id,
      title: r.prospect_name ?? 'Someone',
      sub: r.prospect_company ?? '',
      snippet: snippet(r.message_text, term),
      lane,
    }))
    hits.push(...dedupeByProspect(mapped).slice(0, PER_SURFACE))
  } else failed.push('conversations')

  if (draft.status === 'fulfilled' && !draft.value.error) {
    for (const r of (draft.value.data ?? []) as DraftRow[]) {
      hits.push({
        surface: 'draft',
        id: r.id,
        title: r.title || r.topic || 'Untitled draft',
        // Through the label map, never the raw value: this string is rendered.
        sub: label(r.status),
        snippet: snippet(r.post_body ?? r.topic, term),
        lane,
        row: {
          id: r.id,
          title: r.title || r.topic || 'Untitled draft',
          type: r.type,
          updated_at: r.updated_at ?? '',
          status: r.status ?? 'unknown',
        },
      })
    }
  } else failed.push('drafts')

  if (magnet.status === 'fulfilled' && !magnet.value.error) {
    for (const r of (magnet.value.data ?? []) as MagnetRow[]) {
      hits.push({
        surface: 'magnet',
        id: r.id,
        title: r.topic || 'Untitled lead magnet',
        sub: label(r.status),
        snippet: snippet(r.description ?? r.post_body, term),
        lane,
        row: {
          id: r.id,
          title: r.topic || 'Untitled lead magnet',
          type: null,
          updated_at: r.updated_at ?? '',
          status: r.status ?? 'unknown',
        },
      })
    }
  } else failed.push('lead magnets')

  return {
    hits,
    counts: {
      dm: hits.filter(h => h.surface === 'dm').length,
      draft: hits.filter(h => h.surface === 'draft').length,
      magnet: hits.filter(h => h.surface === 'magnet').length,
    },
    lane,
    failed,
  }
}

/** What a hit's badge prints. Never the table name, never the column name. */
export const SURFACE_LABEL: Record<CrossSurface, string> = {
  dm: 'Conversation',
  draft: 'Draft',
  magnet: 'Lead magnet',
}

export function laneName(lane: ContentLane): string { return LANE_LABEL[lane] ?? lane }
