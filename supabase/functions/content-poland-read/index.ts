// content-poland-read: "is this post about Poland?" for Ivan's drafts, one proxy read each (db/299p).
//
// Server-to-server only (pg_cron twice an hour, only when something is due). The gate is `x-inbox-secret`
// equal to INBOX_PUSH_SECRET, checked before anything else, same as content-plan-quotes. Deployed with
// --no-verify-jwt for that reason.
//
// content_poland_due lists drafts with no content-brain vote and no read of their current body. A refused,
// empty or unparseable answer writes nothing (the draft stays due); content_poland_save writes only while the
// body is the one that was read. Post text and keys are never logged.
// No supabase-js (the server-side bundler refused npm imports in new functions on 2026-10-12): plain fetch.
import { buildBody, MODEL, readAnswer } from './read.ts'

const JSON_HEADERS = { 'Content-Type': 'application/json' }
const CALL_TIMEOUT_MS = 60_000
const BUDGET_MS = 80_000 // stop starting new calls after this; the rest stay due for the next run
const CONCURRENCY = 3

function err(status: number, code: string) {
  return new Response(JSON.stringify({ error: code }), { status, headers: JSON_HEADERS })
}

Deno.serve(async (req) => {
  const secret = Deno.env.get('INBOX_PUSH_SECRET')
  if (!secret) return err(503, 'not_configured')
  if (req.headers.get('x-inbox-secret') !== secret) return err(401, 'unauthorized')
  if (req.method !== 'POST') return err(405, 'method_not_allowed')

  const base = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '')
  const sk = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!base || !sk) return err(503, 'not_configured')
  const rest = async (path: string, body?: unknown): Promise<{ data: unknown; ok: boolean }> => {
    try {
      const res = await fetch(`${base}/rest/v1/${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { apikey: sk, Authorization: `Bearer ${sk}`, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      if (!res.ok) { await res.body?.cancel(); return { data: null, ok: false } }
      return { data: await res.json(), ok: true }
    } catch {
      return { data: null, ok: false }
    }
  }

  const { data: cfg, ok: cfgOk } = await rest('integration_config?select=key,value&key=in.(railway_proxy_key,railway_proxy_url)')
  if (!cfgOk) return err(500, 'config_read_failed')
  const conf = Object.fromEntries(((cfg ?? []) as { key: string; value: string }[]).map((r) => [r.key, r.value]))
  const key = conf.railway_proxy_key
  let url = String(conf.railway_proxy_url ?? '').replace(/\/$/, '')
  if (!key || !url) return err(503, 'proxy_not_configured')
  if (!url.endsWith('/v1/messages')) url += '/v1/messages'

  let limit = 20
  try { const b = await req.json() as { limit?: unknown }; if (typeof b?.limit === 'number' && b.limit > 0) limit = Math.min(40, Math.floor(b.limit)) } catch { /* empty body */ }
  const { data: due, ok: dueOk } = await rest('rpc/content_poland_due', { p_limit: limit })
  if (!dueOk) return err(500, 'due_read_failed')
  const rows = (due ?? []) as { draft_id: string; body: string; body_md5: string }[]

  const started = Date.now()
  let saved = 0, poland = 0, skipped = 0
  const reasons: Record<string, number> = {}
  const skip = (why: string) => { skipped++; reasons[why] = (reasons[why] ?? 0) + 1 }

  async function one(row: { draft_id: string; body: string; body_md5: string }) {
    if (Date.now() - started > BUDGET_MS) return skip('budget')
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), CALL_TIMEOUT_MS)
    let answer: ReturnType<typeof readAnswer> = null
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify(buildBody(row.body)),
        signal: ctl.signal,
      })
      if (!res.ok) { await res.body?.cancel(); return skip('http_' + res.status) }
      answer = readAnswer(await res.json())
    } catch {
      return skip('fetch_failed')
    } finally {
      clearTimeout(timer)
    }
    if (!answer) return skip('refused_or_unreadable')
    const { data: wrote, ok } = await rest('rpc/content_poland_save', {
      p_draft: row.draft_id, p_body_md5: row.body_md5, p_is_poland: answer.poland, p_why: answer.why, p_model: MODEL,
    })
    if (!ok) return skip('save_failed')
    if (wrote === true) { saved++; if (answer.poland) poland++ }
    else skip('body_changed')
  }

  const queue = [...rows]
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    for (let r = queue.shift(); r; r = queue.shift()) await one(r)
  }))

  const out = { due: rows.length, saved, poland, skipped, reasons }
  console.log('content-poland-read', JSON.stringify(out))
  return new Response(JSON.stringify(out), { headers: JSON_HEADERS })
})
