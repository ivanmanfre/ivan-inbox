/* ==========================================================================
   src/lib/salesPacks.ts — the read layer for the Sales section.

   One row per (prospect, document) in `sales_packs` (db/052). The browser only
   ever READS: every body is written on the Mac by the publisher, with the
   service key, from files on disk. There is no write path here on purpose — a
   page that could rewrite a pack could rewrite the words in front of him while
   he is on the call.

   Two reads, deliberately split (D6):
     · `fetchPackIndex` selects every column EXCEPT `body`, because the list
       only needs to know WHICH documents exist for whom. The largest single
       body on disk today is ~52 KB and five prospects times five documents
       would put ~400 KB on the wire for a screen that shows none of it.
     · `fetchPackBody` pulls exactly one body, when a tab is opened.

   The calendar half lives here too, as a sibling of `fetchUpcomingEvents` in
   nextCall.ts rather than an edit to it: Today owns that fetcher and Today is
   out of scope for this run, so the week read is a second function over the
   same table, the same columns and the same `isRealBooking` filter.
   ========================================================================== */
import { supabase } from './supabase'
import { isRealBooking, type CalendarEvent } from './nextCall'

// ---------------------------------------------------------------------------
// Packs
// ---------------------------------------------------------------------------

export type PackKind = 'card' | 'call_sheet' | 'audience_audit' | 'asset_ideas' | 'prospect' | 'extra'

/**
 * Tab order, and the only kinds the surface offers. `extra` is a valid row kind
 * in the table (the publisher can park a document it has no name for) but it is
 * not a tab: a tab with no stated meaning is a tab nobody opens on a live call.
 * `compare` is a seventh, VIRTUAL tab — a link card, never a row.
 */
export const PACK_KINDS: PackKind[] = ['card', 'call_sheet', 'audience_audit', 'asset_ideas', 'prospect']

/** What the list row needs to draw a heading without opening a dossier. */
export type PackMeta = {
  name?: string
  company?: string
  domain?: string
  when?: string
  bytes?: number
}

export type SalesPack = {
  id: string
  prospect_slug: string
  kind: PackKind
  title: string
  mime: string
  source_path: string | null
  source_mtime: string | null
  call_at: string | null
  meta: PackMeta
  updated_at: string
}

export type SalesPackBody = SalesPack & { body: string }

const PACK_COLS =
  'id, prospect_slug, kind, title, mime, source_path, source_mtime, call_at, meta, updated_at'

/**
 * Every pack the user owns, minus the bodies. RLS pins the rows to his uid, so
 * there is no user filter here to forget.
 */
export async function fetchPackIndex(): Promise<SalesPack[]> {
  const { data, error } = await supabase
    .from('sales_packs')
    .select(PACK_COLS)
    .order('prospect_slug', { ascending: true })
    .order('kind', { ascending: true })
  if (error) throw error
  // `sales_packs` carries no generated schema type in this client, same as
  // `calendar_events` and `transcripts`: PostgREST-js cannot infer the select
  // shape and falls back to its safety-net error type, so this casts through
  // unknown exactly as every other ad-hoc read in this codebase does.
  return ((data ?? []) as unknown as SalesPack[]).map(normalise)
}

/** One document. `null` when the pack was never published (or was unpublished). */
export async function fetchPackBody(slug: string, kind: PackKind): Promise<SalesPackBody | null> {
  const { data, error } = await supabase
    .from('sales_packs')
    .select(`${PACK_COLS}, body`)
    .eq('prospect_slug', slug)
    .eq('kind', kind)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  const row = data as unknown as SalesPackBody
  return { ...normalise(row), body: row.body ?? '' }
}

/** `meta` is `jsonb` and can arrive as null from a row written before the column had a default. */
function normalise<T extends { meta: PackMeta }>(row: T): T {
  return row.meta ? row : { ...row, meta: {} }
}

/**
 * A fresh publish from the Mac shows up without a reload.
 *
 * ONE CHANNEL PER SUBSCRIBER, with a unique topic. `supabase.channel(topic)`
 * hands back the EXISTING channel for a topic it already holds, so a second
 * subscriber on the same literal topic would bind `postgres_changes` to an
 * already-subscribed channel and throw inside the effect — the trap
 * `useRunnerJobs`, `useOps` and `useContent` each carry a comment about
 * (src/wb/ask/jobs.ts L250-300). The counter here is the same guard those hooks
 * get from React's `useId`, expressed for a plain function that has no hook to
 * lean on.
 */
let packChannelSeq = 0

export function subscribePacks(onChange: () => void): () => void {
  const topic = `sales_packs:${++packChannelSeq}`
  const ch = supabase
    .channel(topic)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'sales_packs' }, () => onChange())
    .subscribe()
  return () => { void supabase.removeChannel(ch) }
}

/** The compare page, as a link card on the pack's last tab. */
export const COMPARE_URL = 'https://inboundonsteroids.com/compare'

// ---------------------------------------------------------------------------
// The week's calls
// ---------------------------------------------------------------------------

export type WeekEvent = CalendarEvent

// nextCall.ts keeps its column list private, so this is a deliberate copy and
// not an edit to Today's fetcher to export it. The two lists are asserted equal
// in salesPacks.test.ts, so a column added there and forgotten here fails a test
// instead of a call.
const EVENT_COLS = 'id, title, start_time, end_time, attendees, meeting_url, is_all_day, is_test, ' +
  'meeting_type, source, referral_token, booking_source_path'

/** Exported for the test that pins it against nextCall's own list. */
export const WEEK_EVENT_COLS = EVENT_COLS

/**
 * Every real booking that STARTS inside [from, to]. Same table, same columns and
 * the same client-side `is_test` filter as `fetchUpcomingEvents` — `.eq('is_test',
 * false)` would drop every Google-Calendar row, which never writes the column at
 * all, and that NULL-drop is the trap this codebase's PostgREST notes warn about.
 *
 * The range is on `start_time` at both ends (Today's fetcher gates the lower
 * bound on `end_time`, because it is answering "what is still ahead of me"; this
 * one is answering "what does the week hold", and a call belongs to the day it
 * starts on).
 */
export async function fetchWeekEvents(from: Date, to: Date): Promise<WeekEvent[]> {
  const { data, error } = await supabase
    .from('calendar_events')
    .select(EVENT_COLS)
    .gte('start_time', from.toISOString())
    .lte('start_time', to.toISOString())
    .eq('is_all_day', false)
    .order('start_time', { ascending: true })
    .limit(100)
  if (error) throw error
  return ((data ?? []) as unknown as WeekEvent[]).filter(isRealBooking)
}
