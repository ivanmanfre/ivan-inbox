// inbox-bot-tick - the clock that gives Claude something to say.
//
// Every 30 minutes (pg_cron 'inbox-bot-tick', db/061) this reads the feed rows
// Ivan has not read, hands them to the broker's server door as one bot turn, and
// returns. It does NOT hold the stream: the broker writes the row before it
// streams, so the row is the truth and inbox-turn-run finishes it (decision D3).
//
// BORN-DEAD: no-ops until integration_config.bot_tick_enabled = 'true'. A body
// of {"force": true} bypasses that one gate and nothing else, so the gates can
// run while the flag is still off.
//
// Auth mirrors inbox-morning-push: x-inbox-secret = INBOX_PUSH_SECRET, checked
// before anything else, verify_jwt off. The broker call carries the service key
// as a bearer as well, because the platform gateway on inbox-claude verifies a
// JWT before that function's own code runs.
//
// Mute list (families the bot never reads): chat, claude_turn, health_reminder,
// bot. It lives in ./bundle.ts as MUTED_FAMILIES, one definition, read both by
// the SQL filter below and by selectRows. `bot` is there because an actionable
// bot message now writes its own notification row (2026-09-12, decision D5) and
// a bot that can read its own push answers itself every 30 minutes.
//
// The two rules this function holds, whatever else changes:
//   1. It NEVER notifies. A bot turn writes no inbox_notifications row and
//      never pushes; that is inbox-turn-run's half of the same rule.
//   2. It ALWAYS stamps before it calls. Every row that entered the bundle gets
//      group_key = 'bot:<turn_id>' before the broker is asked for anything, and
//      if the broker refuses, every one of them is unstamped again.
import { createClient } from 'npm:@supabase/supabase-js@2'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { buildBundle, type FeedRow, LAST_HEAD_CHARS, MUTED_FAMILIES, selectRows } from './bundle.ts'

const JSON_HEADERS = { 'Content-Type': 'application/json' }

/** The one operator, same id the broker's allowlist holds. */
const OPERATOR_ID = Deno.env.get('INBOX_CLAUDE_ALLOWED_USER_ID')

/** How many unread rows one tick will even look at. */
const SELECT_LIMIT = 200

/** Used when integration_config has no bot_daily_turn_cap, or a non-number. */
const DEFAULT_DAILY_CAP = 24

/** The standing instruction. Canonical home for prompts is content_prompts. */
const BRIEF_SLUG = 'inbox-bot-brief'
const BRIEF_SCOPE = 'client:ivan'

/** One JSON line in the log and the same JSON to the caller. The cron reads the
 *  log; a gate script reads the body; they must never be able to disagree. */
function say(body: Record<string, unknown>, status = 200) {
  console.log(JSON.stringify(body))
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS })
}

function err(status: number, code: string, detail?: string) {
  return new Response(JSON.stringify({ error: code, detail }), { status, headers: JSON_HEADERS })
}

/** Start of the current UTC day, which is what the daily cap counts from. */
function utcDayStart(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString()
}

/**
 * Put the rows back the way they were found. Called only when the broker
 * refused. Each row gets ITS OWN previous group_key back (a producer's key, or
 * null), not a blanket null: skeptic S1 (waves/W2-skeptic.md, hole 6b) showed
 * 404 live rows carry a producer key the feed folds by.
 */
async function unstamp(db: SupabaseClient, groupKey: string, previous: Map<string, string | null>) {
  for (const [id, prev] of previous) {
    const { error } = await db
      .from('inbox_notifications')
      .update({ group_key: prev })
      .eq('id', id)
      .eq('group_key', groupKey)
    if (error) console.error('unstamp failed', { id, message: error.message })
  }
}

/**
 * One tick at a time, taken atomically. Two ticks a second apart both passed
 * the busy check (S1 hole 3: two turns, same session, two near-identical
 * messages). The lock is one integration_config row: the UPDATE is atomic, so
 * only the first caller sees 'free' (or a holder older than LOCK_STALE_MS, a
 * tick that died). Released on every exit after it is taken.
 */
const LOCK_KEY = 'bot_tick_lock'
const LOCK_FREE = 'free'
const LOCK_STALE_MS = 10 * 60 * 1000

async function takeLock(db: SupabaseClient, holder: string): Promise<boolean> {
  const stale = new Date(Date.now() - LOCK_STALE_MS).toISOString()
  const { data, error } = await db
    .from('integration_config')
    .update({ value: holder, updated_at: new Date().toISOString() })
    .eq('key', LOCK_KEY)
    .or(`value.eq.${LOCK_FREE},updated_at.lt.${stale}`)
    .select('key')
  if (error) {
    console.error('lock update failed', error.message)
    return false
  }
  return (data?.length ?? 0) === 1
}

async function releaseLock(db: SupabaseClient, holder: string) {
  const { error } = await db
    .from('integration_config')
    .update({ value: LOCK_FREE, updated_at: new Date().toISOString() })
    .eq('key', LOCK_KEY)
    .eq('value', holder)
  if (error) console.error('lock release failed', error.message)
}

Deno.serve(async (req) => {
  // 1. secret, before anything else touches the request
  const secret = Deno.env.get('INBOX_PUSH_SECRET')
  if (!secret) return err(503, 'bot_tick_not_configured')
  if (req.headers.get('x-inbox-secret') !== secret) return err(401, 'unauthorized')
  if (req.method !== 'POST') return err(405, 'method_not_allowed')

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!SUPABASE_URL || !SERVICE_KEY || !OPERATOR_ID) {
    console.error('refusing: incomplete config', {
      url: !!SUPABASE_URL, service: !!SERVICE_KEY, operator: !!OPERATOR_ID,
    })
    return err(503, 'bot_tick_not_configured')
  }

  // pg_cron sends '{}'. A gate script sends {"force": true}. Neither is allowed
  // to steer anything else, so only that one field is read.
  const reqBody = await req.json().catch(() => ({})) as Record<string, unknown>
  const forced = reqBody?.force === true

  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

  // ---- 1. the flag -------------------------------------------------------
  const { data: cfg } = await db
    .from('integration_config')
    .select('key, value')
    .in('key', ['bot_tick_enabled', 'bot_daily_turn_cap'])
  const cfgMap = new Map((cfg ?? []).map((r: { key: string; value: string }) => [r.key, r.value]))
  if (cfgMap.get('bot_tick_enabled') !== 'true' && !forced) {
    return say({ bot_tick: 'disabled' })
  }

  // ---- 1b. the lock ------------------------------------------------------
  const lockHolder = crypto.randomUUID()
  if (!(await takeLock(db, lockHolder))) {
    return say({ bot_tick: 'busy', lock: 'held', ...(forced ? { forced: true } : {}) })
  }
  try {

  // ---- 2. the one bot thread --------------------------------------------
  let threadId: string
  let createdThread = false
  const { data: existing, error: tErr } = await db
    .from('inbox_threads')
    .select('id')
    .eq('user_id', OPERATOR_ID)
    .eq('kind', 'bot')
    .maybeSingle()
  if (tErr) return say({ bot_tick: 'thread_lookup_failed', error: tErr.message.slice(0, 200) }, 500)
  if (existing) {
    threadId = existing.id
  } else {
    const { data: made, error: mkErr } = await db
      .from('inbox_threads')
      .insert({ user_id: OPERATOR_ID, kind: 'bot', title: 'Claude' })
      .select('id')
      .single()
    if (mkErr || !made) {
      return say({ bot_tick: 'thread_create_failed', error: mkErr?.message.slice(0, 200) }, 500)
    }
    threadId = made.id
    createdThread = true
    console.log(JSON.stringify({ bot_tick: 'created_thread', thread_id: threadId }))
  }

  // ---- 3. busy: never stamp rows for a turn that will not start ----------
  // The broker answers 409 thread_busy anyway; checking here is what keeps the
  // rows untouched when it would.
  const { data: openTurns, error: busyErr } = await db
    .from('inbox_turns')
    .select('id, thread_id')
    .eq('origin', 'bot')
    .in('status', ['queued', 'running'])
  if (busyErr) return say({ bot_tick: 'busy_lookup_failed', error: busyErr.message.slice(0, 200) }, 500)
  const openIds = (openTurns ?? []).map((t: { id: string }) => t.id)
  const busyHere = (openTurns ?? []).find((t: { thread_id: string }) => t.thread_id === threadId)
  if (busyHere) {
    return say({
      bot_tick: 'busy',
      turn_id: busyHere.id,
      ...(createdThread ? { created_thread: threadId } : {}),
      ...(forced ? { forced: true } : {}),
    })
  }

  // ---- 4. the daily cap --------------------------------------------------
  const capRaw = Number(cfgMap.get('bot_daily_turn_cap'))
  const cap = Number.isFinite(capRaw) && capRaw > 0 ? capRaw : DEFAULT_DAILY_CAP
  const { count: todayCount, error: capErr } = await db
    .from('inbox_turns')
    .select('id', { count: 'exact', head: true })
    .eq('origin', 'bot')
    .gte('created_at', utcDayStart(new Date()))
  if (capErr) return say({ bot_tick: 'cap_lookup_failed', error: capErr.message.slice(0, 200) }, 500)
  if ((todayCount ?? 0) >= cap) {
    return say({ bot_tick: 'capped', count: todayCount ?? 0, cap, ...(forced ? { forced: true } : {}) })
  }

  // ---- 5. the rows -------------------------------------------------------
  const { data: rawRows, error: rowsErr } = await db
    .from('inbox_notifications')
    .select('id, family, severity, tenant, count, title, body, url, group_key, created_at')
    .is('read_at', null)
    .is('dismissed_at', null)
    .not('family', 'in', `(${MUTED_FAMILIES.join(',')})`)
    .order('created_at', { ascending: true })
    .limit(SELECT_LIMIT)
  if (rowsErr) return say({ bot_tick: 'rows_lookup_failed', error: rowsErr.message.slice(0, 200) }, 500)
  const candidates = selectRows((rawRows ?? []) as FeedRow[], openIds)
  if (candidates.length === 0) {
    return say({
      bot_tick: 'quiet',
      ...(createdThread ? { created_thread: threadId } : {}),
      ...(forced ? { forced: true } : {}),
    })
  }

  // ---- 6. the bundle -----------------------------------------------------
  const turnId = crypto.randomUUID()
  const { data: lastDone } = await db
    .from('inbox_turns')
    .select('answer')
    .eq('thread_id', threadId)
    .eq('origin', 'bot')
    .eq('status', 'done')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const lastHead = typeof lastDone?.answer === 'string' ? lastDone.answer.slice(0, LAST_HEAD_CHARS) : null
  const bundle = buildBundle(candidates, lastHead)

  // ---- 7. stamp, before the broker is asked anything ---------------------
  const groupKey = `bot:${turnId}`
  const previousKeys = new Map(candidates.filter((r) => bundle.included.includes(r.id)).map((r) => [r.id, r.group_key ?? null]))
  const { error: stampErr } = await db
    .from('inbox_notifications')
    .update({ group_key: groupKey })
    .in('id', bundle.included)
  if (stampErr) return say({ bot_tick: 'stamp_failed', error: stampErr.message.slice(0, 200) }, 500)
  console.log(JSON.stringify({ bot_tick: 'stamped', stamped: bundle.included.length, turn_id: turnId }))

  // ---- 8. the standing instruction --------------------------------------
  const { data: brief } = await db
    .from('content_prompts')
    .select('body')
    .eq('slug', BRIEF_SLUG)
    .eq('scope', BRIEF_SCOPE)
    .eq('is_active', true)
    .maybeSingle()
  const briefBody = typeof brief?.body === 'string' ? brief.body.trim() : ''
  if (!briefBody) {
    // A turn with no standing instruction is a turn with no voice rules, which
    // is worse than no turn. Put the rows back and say why.
    await unstamp(db, groupKey, previousKeys)
    return say({ bot_tick: 'no_brief', slug: BRIEF_SLUG, scope: BRIEF_SCOPE }, 503)
  }

  // ---- 9. the broker's server door --------------------------------------
  const brokerUrl = `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/inbox-claude`
  let res: Response
  try {
    res = await fetch(brokerUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-inbox-secret': secret,
        // The platform gateway verifies a JWT on inbox-claude before the
        // function's own code runs, so the service key rides as the bearer. The
        // broker itself reads only x-inbox-secret on the server door.
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
      },
      body: JSON.stringify({
        origin: 'bot',
        operator_id: OPERATOR_ID,
        thread_id: threadId,
        turn_id: turnId,
        prompt: bundle.text,
        system_append: briefBody,
      }),
    })
  } catch (e) {
    await unstamp(db, groupKey, previousKeys)
    const detail = e instanceof Error ? e.message.slice(0, 200) : 'fetch failed'
    return say({ bot_tick: 'broker_error', status: 0, error: detail })
  }

  if (res.status !== 200) {
    const detail = (await res.text().catch(() => '')).slice(0, 300)
    await unstamp(db, groupKey, previousKeys)
    return say({ bot_tick: 'broker_error', status: res.status, error: detail })
  }

  // The broker wrote the row before it started streaming, so the row is the
  // truth from here. Drop the stream rather than sit on it for minutes: the
  // container's detached task finishes the turn and POSTs inbox-turn-run, which
  // folds these rows. The cancel stamps client_gone_at, which is harmless on a
  // bot turn because that path never notifies (decision D3).
  const brokerTurnId = res.headers.get('x-broker-turn-id')
  await res.body?.cancel().catch(() => {})

  return say({
    bot_tick: 'started',
    turn_id: turnId,
    broker_turn_id: brokerTurnId,
    rows: bundle.included.length,
    thread_id: threadId,
    ...(createdThread ? { created_thread: threadId } : {}),
    ...(forced ? { forced: true } : {}),
  })
  } finally {
    await releaseLock(db, lockHolder)
  }
})
