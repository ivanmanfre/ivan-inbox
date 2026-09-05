// notify.ts — the one notification feed's single write path.
//
// Everything that wants Ivan's attention (a finished Claude turn, an n8n workflow
// that died, a client reply) ends up as one row in inbox_notifications and, when
// it is worth waking a phone for, one web push. The logic lives here rather than
// in the HTTP handler so inbox-turn-run can call it in-process: an edge function
// that HTTP-hops to its neighbour pays a cold start and, worse, can lose the
// notification while the row that caused it is already written.
//
// Fails closed on shape: a producer that gets a field wrong gets a named 400, not
// a row that later reads as a lie.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { sendPush } from './push-send.ts'

const FAMILY_RE = /^[a-z][a-z0-9_]{1,39}$/
const SEVERITIES = ['info', 'attention', 'error'] as const
export type Severity = (typeof SEVERITIES)[number]

/** Repeats fold into one row for this long. Matches the partial index on dedupe_key. */
const DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000
const PUSH_BODY_CHARS = 140

/**
 * Push-vs-feed default, per family (BALLOT row 3, applied 2026-09-05).
 *
 * Before this map the only rule was `severity !== 'info'`, which pushed every
 * 'attention' row: 17 draft-pending and 12.5 engine-health notices a day each
 * bought a buzz, so the phone taught him to ignore it. A family key is the
 * honest unit for that decision because volume and worth are properties of the
 * producer, not of one row's severity.
 *
 * `true`  interrupt the phone.
 * `false` wait in the feed, whatever severity the row carries - these are the
 *         families measured as routine chatter (heartbeats, no-op health
 *         checks, digests, publish confirmations).
 * absent  fall through to severity: only a hard 'error' (critical) wakes the
 *         phone; 'attention' (warn) and 'info' wait in the feed.
 *
 * A producer that passes an explicit `push` flag still wins over all of this.
 */
export const PUSH_DEFAULT: Record<string, boolean> = {
  // --- interrupt --------------------------------------------------------
  claude_turn: true,          // an answer (or a failed turn) he is waiting on
  inbound_reply_notice: true, // a human replied on ARCH / RISE / Ivan
  booking_notice: true,       // a lead booked; the money event
  reminder: true,             // reminders he set himself
  night_brief: true,          // the night brief
  thursday_brief: true,       // the Thursday brief

  // --- feed only --------------------------------------------------------
  outreach_engine_ops: false,       // engine heartbeats / pace
  system_watchdog_digest: false,    // health + liveness no-ops
  seat_health: false,               // seat liveness
  health_reminder: false,           // personal, never a work interrupt
  content_sourcing_pipeline: false, // Dreaming / sourcing digests
  reporting_digest: false,          // daily-journal + recap digests
  content_board_activity: false,    // publish confirmations, schedule taps
  chat: false,                      // a live conversation, not a notification
}

/**
 * The default push decision for a family that passed no explicit `push` flag.
 * Kept as a function (not an inline lookup) so the fall-through rule has one
 * definition and the tests can name it.
 */
export function pushDefault(family: string, severity: Severity): boolean {
  const explicit = PUSH_DEFAULT[family]
  if (typeof explicit === 'boolean') return explicit
  return severity === 'error'
}

export interface NotifyInput {
  family: string
  source?: string | null
  dedupe_key?: string | null
  severity?: string | null
  title: string
  body?: string | null
  url?: string | null
  media?: Record<string, unknown> | null
  group_key?: string | null
  tenant?: string | null
  push?: boolean | null
}

export interface NotifyResult {
  id: string
  pushed: boolean
  deduped: boolean
  subs: number
  results: string[]
}

/** A refusal with a machine-readable code. Never carries a stack out to a caller. */
export class NotifyError extends Error {
  readonly code: string
  readonly status: number
  constructor(status: number, code: string, detail?: string) {
    super(detail ?? code)
    this.code = code
    this.status = status
  }
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null
}

/**
 * Validate the producer's body into the row shape. Split out so the HTTP wrapper
 * and inbox-turn-run's in-process call are held to exactly the same rules.
 */
export function validateNotify(raw: unknown): Required<Pick<NotifyInput, 'family' | 'title'>> & NotifyInput {
  if (!raw || typeof raw !== 'object') throw new NotifyError(400, 'bad_body')
  const b = raw as Record<string, unknown>

  const family = str(b.family)
  if (!family) throw new NotifyError(400, 'family_required')
  if (!FAMILY_RE.test(family)) {
    throw new NotifyError(400, 'bad_family', 'family must match ^[a-z][a-z0-9_]{1,39}$')
  }

  const title = str(b.title)
  if (!title) throw new NotifyError(400, 'title_required')
  if (title.length > 200) throw new NotifyError(400, 'title_too_long')

  const body = typeof b.body === 'string' ? b.body : null
  if (body && body.length > 4000) throw new NotifyError(400, 'body_too_long')

  const severity = str(b.severity) ?? 'info'
  if (!(SEVERITIES as readonly string[]).includes(severity)) {
    throw new NotifyError(400, 'bad_severity', `severity must be one of ${SEVERITIES.join(', ')}`)
  }

  // Relative or https, nothing else. A push payload's url is handed straight to
  // the service worker; an http:// or javascript: url there is somebody else's
  // navigation on Ivan's phone.
  const url = str(b.url)
  if (url && !(url.startsWith('./') || url.startsWith('https://'))) {
    throw new NotifyError(400, 'bad_url', "url must start with './' or 'https://'")
  }

  const tenant = str(b.tenant)
  if (tenant && tenant.length > 40) throw new NotifyError(400, 'bad_tenant')

  const media = b.media == null ? null : (typeof b.media === 'object' ? b.media as Record<string, unknown> : null)
  if (b.media != null && media === null) throw new NotifyError(400, 'bad_media', 'media must be an object')

  const push = typeof b.push === 'boolean' ? b.push : null

  return {
    family,
    title,
    body,
    severity,
    url,
    media,
    push,
    source: str(b.source),
    dedupe_key: str(b.dedupe_key),
    group_key: str(b.group_key),
    tenant,
  }
}

/**
 * Write (or fold into) one notification row, then push if the row earns it.
 * `db` must be a service-role client: the browser has no insert path here.
 */
export async function notify(db: SupabaseClient, raw: unknown): Promise<NotifyResult> {
  const n = validateNotify(raw)

  // ---- dedupe: same key, seen inside the window, not already dismissed -----
  if (n.dedupe_key) {
    const since = new Date(Date.now() - DEDUPE_WINDOW_MS).toISOString()
    const { data: hit, error: findErr } = await db
      .from('inbox_notifications')
      .select('id, count')
      .eq('dedupe_key', n.dedupe_key)
      .gt('last_seen_at', since)
      .is('dismissed_at', null)
      .order('last_seen_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (findErr) throw new NotifyError(500, 'dedupe_lookup_failed', findErr.message)

    if (hit) {
      // The newest telling wins the visible fields; the count is what says it
      // happened again. No push: the operator has already been told once.
      const { error: updErr } = await db
        .from('inbox_notifications')
        .update({
          count: (hit.count ?? 1) + 1,
          last_seen_at: new Date().toISOString(),
          title: n.title,
          body: n.body,
          severity: n.severity,
          media: n.media,
        })
        .eq('id', hit.id)
      if (updErr) throw new NotifyError(500, 'dedupe_update_failed', updErr.message)
      return { id: hit.id, pushed: false, deduped: true, subs: 0, results: [] }
    }
  }

  const { data: row, error: insErr } = await db
    .from('inbox_notifications')
    .insert({
      family: n.family,
      source: n.source,
      dedupe_key: n.dedupe_key,
      severity: n.severity,
      title: n.title,
      body: n.body,
      url: n.url,
      media: n.media,
      group_key: n.group_key,
      tenant: n.tenant,
    })
    .select('id')
    .single()
  if (insErr || !row) throw new NotifyError(500, 'insert_failed', insErr?.message)

  // Producer's call if it made one; otherwise the family map decides and a
  // family it has never seen falls through to severity. Silence is the
  // default for routine chatter.
  const shouldPush = n.push ?? pushDefault(n.family, (n.severity ?? 'info') as Severity)
  if (!shouldPush) return { id: row.id, pushed: false, deduped: false, subs: 0, results: [] }

  const out = await sendPush(db, {
    title: n.title,
    body: (n.body ?? '').slice(0, PUSH_BODY_CHARS),
    // The service worker resolves this against its own scope, so './' is the
    // form that lands inside the app rather than at the user root.
    url: n.url ?? './',
    // Same group collapses on the device instead of stacking; a row with no
    // group is its own tag so it can never swallow an unrelated notification.
    tag: n.group_key ?? row.id,
    // The worker forwards this to every open tab so a feed can refetch just its
    // own family instead of reloading everything on every push.
    family: n.family,
  })

  // Nobody subscribed is not a delivery. Stamping pushed_at on a send that
  // reached zero devices is how a quiet phone reads as a healthy lane.
  const delivered = out.subs > 0
  await db.from('inbox_notifications')
    .update({
      ...(delivered ? { pushed_at: new Date().toISOString() } : {}),
      push_result: out,
    })
    .eq('id', row.id)

  return { id: row.id, pushed: delivered, deduped: false, subs: out.subs, results: out.results }
}
