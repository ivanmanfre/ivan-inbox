// inbox-turn-run — the completion webhook the container POSTs when a turn ends.
//
// This is what makes a turn survive the tab that started it. The broker
// (inbox-claude) writes the row and streams the answer while the client is
// watching; the container owns the process past that point and calls in here when
// it exits, whether anybody is still looking or not. The ROW is the truth; the
// stream is only the fast path.
//
// Server-to-server: `x-inbox-secret` = INBOX_PUSH_SECRET, checked before the body
// is read, never the anon key. Deployed with --no-verify-jwt for that reason.
import { createClient } from 'npm:@supabase/supabase-js@2'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { notify } from '../_shared/notify.ts'

const JSON_HEADERS = { 'Content-Type': 'application/json' }

/** A turn still 'running' after this long has lost its container. */
const LOST_AFTER_MS = 15 * 60 * 1000
/**
 * Below this, the operator was almost certainly still watching the stream when
 * the answer landed, so a push would only tell them what they just read.
 */
const PUSH_IF_SLOWER_THAN_MS = 20_000

function err(status: number, code: string, detail?: string) {
  return new Response(JSON.stringify({ error: code, detail }), { status, headers: JSON_HEADERS })
}

interface TurnSource { kind: string; path: string; at?: string }

/**
 * The container reports sources as raw strings: a file path it read, or a query it
 * ran. Give each one a kind so the UI can say "read this memory file" rather than
 * printing a container-local path at Ivan.
 */
function classifySource(raw: string): TurnSource['kind'] {
  const s = raw.toLowerCase()
  if (s.startsWith('brain-query') || s.includes('claude-brain-query') || s.includes('/recall')) return 'brain'
  if (s.includes('n8nclaw_daily_summaries') || s.startsWith('summary:')) return 'summary'
  if (s.includes('.claude/memory') || s.includes('claude_memory')) return 'memory'
  return 'file'
}

function mergeSources(existing: unknown, incoming: unknown, at: string): TurnSource[] {
  const out: TurnSource[] = []
  const seen = new Set<string>()
  // The broker's own grounding sources come first: they are what the turn was
  // BUILT on, and they stay even if the container read nothing.
  if (Array.isArray(existing)) {
    for (const e of existing) {
      if (!e || typeof e !== 'object') continue
      const path = String((e as Record<string, unknown>).path ?? '')
      if (!path || seen.has(path)) continue
      seen.add(path)
      out.push(e as TurnSource)
    }
  }
  if (Array.isArray(incoming)) {
    for (const raw of incoming) {
      if (typeof raw !== 'string' || !raw.trim()) continue
      const path = raw.trim()
      // A source is a path or a query name, never prose and never a placeholder.
      // A shell blob (any inner whitespace or newline) and the literal 'auto' are
      // what the container sends when it has nothing real to report, and both end
      // up on Ivan's screen as a file he never read.
      if (/\s/.test(path) || path === 'auto') continue
      if (seen.has(path)) continue
      seen.add(path)
      out.push({ kind: classifySource(path), path, at })
    }
  }
  return out.slice(0, 120)
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/** The watchdog. No cron is scheduled by this run; it is called from the gate. */
async function sweep(db: SupabaseClient) {
  // created_at, not started_at: the broker sets both at insert, and created_at is
  // never null, so it cannot skip a row whose start was never recorded.
  const cutoff = new Date(Date.now() - LOST_AFTER_MS).toISOString()
  const { data, error } = await db
    .from('inbox_turns')
    .update({
      status: 'error',
      error_code: 'lost',
      error_detail: 'no completion webhook within 15 minutes; the container is gone',
      finished_at: new Date().toISOString(),
    })
    .eq('status', 'running')
    .lt('created_at', cutoff)
    .select('id')
  if (error) return err(500, 'sweep_failed', error.message)
  return new Response(JSON.stringify({ swept: data?.length ?? 0, ids: (data ?? []).map((r) => r.id) }), {
    headers: JSON_HEADERS,
  })
}

Deno.serve(async (req) => {
  const secret = Deno.env.get('INBOX_PUSH_SECRET')
  if (!secret) return err(503, 'turn_run_not_configured')
  if (req.headers.get('x-inbox-secret') !== secret) return err(401, 'unauthorized')
  if (req.method !== 'POST') return err(405, 'method_not_allowed')

  let p: Record<string, unknown>
  try {
    p = await req.json() as Record<string, unknown>
  } catch {
    return err(400, 'bad_json')
  }

  const db = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  )

  if (p.action === 'sweep') return await sweep(db)

  const turnId = typeof p.turn_id === 'string' ? p.turn_id.trim() : ''
  if (!turnId) return err(400, 'turn_id_required')

  const { data: row, error: findErr } = await db
    .from('inbox_turns').select('*').eq('id', turnId).maybeSingle()
  if (findErr) return err(500, 'turn_lookup_failed', findErr.message)
  if (!row) return err(404, 'turn_not_found')

  const now = new Date()
  const nowIso = now.toISOString()

  // ---- status -------------------------------------------------------------
  // An aborted turn stays aborted. Ivan pressed stop; the container finishing
  // anyway does not un-press it.
  const failed = p.is_error === true || (num(p.returncode) ?? 0) !== 0 || (p.error != null && p.error !== '')
  const status = row.status === 'aborted' ? 'aborted' : (failed ? 'error' : 'done')

  const errorText = typeof p.error === 'string' ? p.error : null
  const stderrTail = typeof p.stderr_tail === 'string' ? p.stderr_tail.trim() : ''

  const patch: Record<string, unknown> = {
    status,
    answer: typeof p.result === 'string' ? p.result : row.answer,
    ran_on: typeof p.model === 'string' ? p.model : row.ran_on,
    session_id: typeof p.session_id === 'string' ? p.session_id : row.session_id,
    resumed: typeof p.resumed === 'boolean' ? p.resumed : row.resumed,
    cost_usd: num(p.total_cost_usd),
    duration_ms: num(p.duration_ms),
    num_turns: num(p.num_turns),
    usage: p.usage ?? null,
    tool_events: Array.isArray(p.tool_events) ? p.tool_events.slice(0, 200) : [],
    sources: mergeSources(row.sources, p.sources, nowIso),
    finished_at: nowIso,
  }
  if (status === 'error') {
    patch.error_code = errorText === 'timeout'
      ? 'timeout'
      : (errorText ? 'upstream_error' : `returncode_${num(p.returncode) ?? 'unknown'}`)
    patch.error_detail = [errorText, stderrTail].filter(Boolean).join('\n').slice(0, 2000) || null
  }

  const { error: updErr } = await db.from('inbox_turns').update(patch).eq('id', turnId)
  if (updErr) return err(500, 'turn_update_failed', updErr.message)

  // ---- thread -------------------------------------------------------------
  const { data: thread } = await db
    .from('inbox_threads').select('*').eq('id', row.thread_id).maybeSingle()
  if (thread) {
    const tPatch: Record<string, unknown> = { last_turn_at: nowIso, updated_at: nowIso }
    if (status === 'done') {
      // The container has now demonstrably held this session, so from here the
      // broker may send a delta instead of the whole memory envelope.
      tPatch.session_started_at = thread.session_started_at ?? nowIso
      const groundedOn = (row.grounding as Record<string, unknown> | null)?.summary_date
      if (typeof groundedOn === 'string' && groundedOn) tPatch.grounded_summary_date = groundedOn
    }
    // The broker expected a resume and the container started fresh under the same
    // id. The envelope it just skipped never arrived, so the session is new: clear
    // the clock and count it, which is the signal the broker keys off next turn.
    // null, not nowIso: a timestamp here tells the broker the container already
    // holds the envelope, so every later turn skips it too and the thread stays
    // amnesiac. Clearing it makes the broker re-send the envelope once.
    if (row.resumed === true && p.resumed === false) {
      tPatch.session_reset_count = (thread.session_reset_count ?? 0) + 1
      tPatch.session_started_at = null
    }
    await db.from('inbox_threads').update(tPatch).eq('id', row.thread_id)
  }

  // ---- push ---------------------------------------------------------------
  // Only when the operator plausibly stopped watching: they closed the tab, or
  // the turn took long enough that nobody sat through it.
  const startedMs = row.started_at ? Date.parse(row.started_at) : Date.parse(row.created_at)
  const elapsed = now.getTime() - startedMs
  const worthTelling = (status === 'done' || status === 'error') &&
    (row.client_gone_at != null || elapsed > PUSH_IF_SLOWER_THAN_MS)

  let pushed = false
  if (worthTelling) {
    try {
      const answer = typeof patch.answer === 'string' ? patch.answer : ''
      const out = await notify(db, {
        family: 'claude_turn',
        source: 'inbox-turn-run',
        dedupe_key: `turn:${turnId}`,
        severity: status === 'error' ? 'attention' : 'info',
        push: true,
        title: String(row.prompt ?? 'Claude turn').slice(0, 60),
        body: (status === 'error' ? (patch.error_detail as string | null) ?? 'The turn failed.' : answer).slice(0, 140),
        url: `./#exp/v2/ask?thread=${row.thread_id}&turn=${turnId}`,
      })
      pushed = out.pushed
    } catch (e) {
      // A failed notification must never fail the webhook: the turn row is already
      // written and the container will not send this payload twice.
      console.error('turn notify failed', turnId, e)
    }
  }

  return new Response(JSON.stringify({ id: turnId, status, pushed }), { headers: JSON_HEADERS })
})
