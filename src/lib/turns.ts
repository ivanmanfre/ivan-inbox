import { supabase } from './supabase'

// turns.ts — the client data layer for db/049: persisted Claude turns, the
// threads that hold their CLI session, and the one notification feed.
//
// Two rules the whole file exists to keep:
//
// 1. READS GO THROUGH THE VIEWS. inbox_threads_v / inbox_turns_v /
//    inbox_notifications_v are security_invoker, so the base-table RLS is what
//    decides visibility and the service-role-only columns (usage, push_result)
//    can be withheld later without a client change. Never select the base table
//    for a read.
// 2. WRITES ARE TWO NARROW PATHS AND NOTHING ELSE. The browser may stop its own
//    turn (status -> 'aborted') and it may stamp read_at / dismissed_at on a
//    notification. Those are the only column grants `authenticated` holds, so
//    anything else here would fail at the database rather than at review — but
//    it would fail at RUNTIME, on Ivan, which is why it is written down instead.
//
// The ROW is the truth, not the stream. A turn is written the moment the broker
// accepts the prompt and finished by a webhook that lands whether or not the tab
// is still open, so a phone that locked mid-answer reads the answer back out of
// here rather than losing it.

export type TurnStatus = 'queued' | 'running' | 'done' | 'error' | 'aborted'
export type NotificationSeverity = 'info' | 'attention' | 'error'

// What the broker grounded a turn on: one entry per assembled block, so a
// transcript scrolled back through can still say which memory answered.
export type TurnSource = { kind: string; path: string; at?: string | null }
export type ToolEvent = { t?: number; name: string; summary?: string }

export type Thread = {
  id: string
  title: string | null
  session_id: string
  // null = the container has never held this session, so the next turn carries
  // the full memory envelope again. This flag is what `send` reads to decide
  // whether to replay anything at all.
  session_started_at: string | null
  session_reset_count: number
  grounded_summary_date: string | null
  grounding: Record<string, unknown> | null
  model: string | null
  last_turn_at: string | null
  created_at: string
  turn_count: number
  last_status: TurnStatus | null
}

export type TurnRow = {
  id: string
  thread_id: string
  prompt: string
  context: string | null
  context_chars: number | null
  model: string | null
  ran_on: string | null
  status: TurnStatus
  answer: string | null
  tool_events: ToolEvent[]
  sources: TurnSource[]
  grounding: Record<string, unknown> | null
  resumed: boolean | null
  cost_usd: number | null
  duration_ms: number | null
  client_gone_at: string | null
  error_code: string | null
  error_detail: string | null
  created_at: string
  started_at: string | null
  finished_at: string | null
}

export type Notification = {
  id: string
  family: string
  source: string | null
  severity: NotificationSeverity
  title: string
  body: string | null
  url: string | null
  media: Record<string, unknown> | null
  group_key: string | null
  tenant: string | null
  count: number
  first_seen_at: string
  last_seen_at: string
  created_at: string
  read_at: string | null
  dismissed_at: string | null
}

export const THREADS_VIEW = 'inbox_threads_v'
export const TURNS_VIEW = 'inbox_turns_v'
export const NOTIFICATIONS_VIEW = 'inbox_notifications_v'
export const TURNS_TABLE = 'inbox_turns'
export const NOTIFICATIONS_TABLE = 'inbox_notifications'

// Column lists rather than '*': the views will grow, and a client that selects
// everything starts shipping columns nobody chose to send to the browser.
const THREAD_COLS =
  'id, title, session_id, session_started_at, session_reset_count, grounded_summary_date, ' +
  'grounding, model, last_turn_at, created_at, turn_count, last_status'

const TURN_COLS =
  'id, thread_id, prompt, context, context_chars, model, ran_on, status, answer, tool_events, ' +
  'sources, grounding, resumed, cost_usd, duration_ms, client_gone_at, error_code, error_detail, ' +
  'created_at, started_at, finished_at'

const NOTIFICATION_COLS =
  'id, family, source, severity, title, body, url, media, group_key, tenant, count, ' +
  'first_seen_at, last_seen_at, created_at, read_at, dismissed_at'

// A turn id is minted in the browser and travels to the broker, to Railway and
// back through a webhook. Anything that is not a uuid on the way in is a
// corrupted cache, not a thread — validate before it becomes a query.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-9a-f][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v)
}

// ---------- reads ----------

/** Newest threads first. Archived threads are gone from every picker. */
export async function listThreads(limit = 30): Promise<Thread[]> {
  const { data, error } = await supabase.from(THREADS_VIEW)
    .select(THREAD_COLS)
    .is('archived_at', null)
    .order('last_turn_at', { ascending: false, nullsFirst: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []) as unknown as Thread[]
}

export async function getThread(id: string): Promise<Thread | null> {
  const { data, error } = await supabase.from(THREADS_VIEW)
    .select(THREAD_COLS)
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return (data ?? null) as unknown as Thread | null
}

/** The thread a fresh tab lands in when localStorage has nothing to say. */
export async function latestThread(): Promise<Thread | null> {
  const { data, error } = await supabase.from(THREADS_VIEW)
    .select(THREAD_COLS)
    .is('archived_at', null)
    .order('last_turn_at', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return (data ?? null) as unknown as Thread | null
}

// Oldest first: this is a transcript, and it is rendered in the order it was
// spoken. The cap is generous but real — an unbounded select on a year-old
// thread is the same defect as the unbounded inbox page.
export const MAX_TURNS = 200

export async function listTurns(threadId: string): Promise<TurnRow[]> {
  const { data, error } = await supabase.from(TURNS_VIEW)
    .select(TURN_COLS)
    .eq('thread_id', threadId)
    .order('created_at', { ascending: true })
    .limit(MAX_TURNS)
  if (error) throw error
  return (data ?? []) as unknown as TurnRow[]
}

export async function getTurn(id: string): Promise<TurnRow | null> {
  const { data, error } = await supabase.from(TURNS_VIEW)
    .select(TURN_COLS)
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return (data ?? null) as unknown as TurnRow | null
}

// ---------- the two permitted writes ----------

/**
 * Stop a turn. Never throws: the row may already have finished between the tap
 * and the request, and the RLS policy refuses the update in exactly that case —
 * which is the right outcome, not an error to put in front of Ivan. The `.in()`
 * on status mirrors the policy so the refusal is a no-op rather than a 403 the
 * caller has to interpret.
 */
export async function abortTurn(id: string): Promise<boolean> {
  try {
    const { error } = await supabase.from(TURNS_TABLE)
      .update({ status: 'aborted' })
      .eq('id', id)
      .in('status', ['queued', 'running'])
    return !error
  } catch {
    return false
  }
}

export async function listNotifications(
  opts: { limit?: number; includeDismissed?: boolean } = {},
): Promise<Notification[]> {
  const { limit = 200, includeDismissed = false } = opts
  let q = supabase.from(NOTIFICATIONS_VIEW).select(NOTIFICATION_COLS)
  if (!includeDismissed) q = q.is('dismissed_at', null)
  const { data, error } = await q.order('created_at', { ascending: false }).limit(limit)
  if (error) throw error
  return (data ?? []) as unknown as Notification[]
}

/** Stamp read_at on rows that do not have it. An empty list is not a query. */
export async function markNotificationsRead(ids: string[]): Promise<void> {
  const clean = ids.filter(isUuid)
  if (!clean.length) return
  const { error } = await supabase.from(NOTIFICATIONS_TABLE)
    .update({ read_at: new Date().toISOString() })
    .in('id', clean)
    .is('read_at', null)
  if (error) throw error
}

export async function dismissNotification(id: string): Promise<void> {
  const { error } = await supabase.from(NOTIFICATIONS_TABLE)
    .update({ dismissed_at: new Date().toISOString() })
    .eq('id', id)
    .is('dismissed_at', null)
  if (error) throw error
}

/** Dismiss every live row a group folded together, in one statement. */
export async function dismissGroup(groupKey: string): Promise<void> {
  const { error } = await supabase.from(NOTIFICATIONS_TABLE)
    .update({ dismissed_at: new Date().toISOString() })
    .eq('group_key', groupKey)
    .is('dismissed_at', null)
  if (error) throw error
}

// ---------- pure ----------

export type NotificationGroup = {
  // Stable across refetches so a list can key on it.
  key: string
  groupKey: string | null
  family: string
  // The row the group is rendered as. Everything else hides behind it.
  latest: Notification
  items: Notification[]
  // Sum of the rows' own `count`, which is already a fold: inbox-notify
  // increments it when the same dedupe_key fires again inside 24h. A group of
  // three rows that each fired twice is six events, not three.
  count: number
  unread: number
  lastSeenAt: string
}

// A producer that sets group_key has said how it wants to be folded, so that
// wins. Everything else folds on family + the title with its numbers taken out,
// because "3 drafts waiting" and "5 drafts waiting" are one situation reported
// twice, not two situations.
function foldKey(n: Notification): string {
  if (n.group_key) return `g:${n.group_key}`
  const shape = n.title.replace(/\d+/g, '').replace(/\s+/g, ' ').trim().toLowerCase()
  return `f:${n.family}:${shape}`
}

const seenAt = (n: Notification): string => n.last_seen_at || n.created_at

export function groupNotifications(rows: Notification[]): NotificationGroup[] {
  const byKey = new Map<string, Notification[]>()
  for (const n of rows) {
    const k = foldKey(n)
    const bucket = byKey.get(k)
    if (bucket) bucket.push(n)
    else byKey.set(k, [n])
  }
  const groups: NotificationGroup[] = []
  for (const [key, items] of byKey) {
    // Newest first inside the group too: the headline is the latest state of
    // the situation, not the first time it was noticed.
    const sorted = [...items].sort((a, b) => seenAt(b).localeCompare(seenAt(a)))
    const latest = sorted[0]
    groups.push({
      key,
      groupKey: latest.group_key ?? null,
      family: latest.family,
      latest,
      items: sorted,
      count: sorted.reduce((s, n) => s + (n.count || 1), 0),
      unread: sorted.filter(n => !n.read_at).length,
      lastSeenAt: seenAt(latest),
    })
  }
  return groups.sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt))
}

// Where a notification with nothing usable to point at lands. Today is the one
// surface that is always meaningful, so a broken deep link costs a wasted tap
// rather than an empty screen.
export const NOTIFICATION_FALLBACK_HASH = '#exp/v2/today'

// A hash this app will actually route. Anything with whitespace, a quote or a
// scheme in it is not a route, it is someone's idea of one.
const SAFE_HASH_RE = /^#[A-Za-z0-9/_\-.~!$&'()*+,;=:@%?[\]]*$/

/**
 * The hash to navigate to for a notification. Pure, and deliberately narrow:
 *
 * - `./#exp/v2/ask?thread=…` (what inbox-notify writes) resolves to just the
 *   hash part, because this app routes on the fragment and a relative path
 *   would reload the whole bundle.
 * - An ABSOLUTE url is not navigated in-app at all. inbox-notify allows
 *   `https://` for links that point somewhere else entirely (a LinkedIn post,
 *   a report), and pushing a foreign origin through the hash router would
 *   render an empty pane. The UI opens those as external links off `n.url`
 *   itself; this function's job is only the in-app route.
 * - Missing, malformed or non-hash urls fall back rather than throwing.
 */
export function notificationDeepLink(n: { url?: string | null }): string {
  const raw = (n.url ?? '').trim()
  if (!raw) return NOTIFICATION_FALLBACK_HASH
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return NOTIFICATION_FALLBACK_HASH
  const at = raw.indexOf('#')
  if (at < 0) return NOTIFICATION_FALLBACK_HASH
  // './#exp/…' and '/#exp/…' and a bare '#exp/…' all reduce to the same thing.
  const head = raw.slice(0, at)
  if (head && head !== './' && head !== '/' && head !== '.') return NOTIFICATION_FALLBACK_HASH
  const hash = raw.slice(at)
  if (hash.length < 2 || !SAFE_HASH_RE.test(hash)) return NOTIFICATION_FALLBACK_HASH
  return hash
}
