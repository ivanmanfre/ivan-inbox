// content-plan-quotes: English versions of call quotes, cached on client_ideas.
//
// Server-to-server only (pg_cron every 30 minutes). The gate is `x-inbox-secret`
// equal to INBOX_PUSH_SECRET, checked before anything else, same as inbox-notify.
// Deployed with --no-verify-jwt for that reason.
//
// One proxy call per due idea (content_plan_quotes_due: plan-horizon ideas whose
// cached English is missing or stale). A refused, empty or failed answer writes
// nothing; content_plan_quote_save only writes while the source quote is unchanged.
// Quote text and keys are never logged.
// No supabase-js: on 2026-10-12 the server-side bundler answered "internal error" for
// any npm import in a new function, so the three PostgREST calls are plain fetch.
import { buildBody, readAnswer } from './quotes.ts'

const JSON_HEADERS = { 'Content-Type': 'application/json' }
const CALL_TIMEOUT_MS = 60_000
const BUDGET_MS = 110_000 // stop starting new calls after this; the rest stay due for the next run
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

  const { data: due, ok: dueOk } = await rest('rpc/content_plan_quotes_due', { p_limit: 20 })
  if (!dueOk) return err(500, 'due_read_failed')
  const rows = (due ?? []) as { idea_id: string; src: string }[]

  const started = Date.now()
  let saved = 0
  let skipped = 0
  const reasons: Record<string, number> = {}
  const skip = (why: string) => { skipped++; reasons[why] = (reasons[why] ?? 0) + 1 }

  async function one(row: { idea_id: string; src: string }) {
    if (Date.now() - started > BUDGET_MS) return skip('budget')
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), CALL_TIMEOUT_MS)
    let answer: string | null = null
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify(buildBody(row.src)),
        signal: ctl.signal,
      })
      if (!res.ok) { await res.body?.cancel(); return skip('http_' + res.status) }
      answer = readAnswer(await res.json())
    } catch {
      return skip('fetch_failed')
    } finally {
      clearTimeout(timer)
    }
    if (!answer) return skip('refused_or_empty')
    const { data: wrote, ok } = await rest('rpc/content_plan_quote_save', { p_idea: row.idea_id, p_src: row.src, p_en: answer })
    if (!ok) return skip('save_failed')
    if (wrote === true) saved++
    else skip('source_changed')
  }

  const queue = [...rows]
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    for (let r = queue.shift(); r; r = queue.shift()) await one(r)
  }))

  const out = { due: rows.length, saved, skipped, reasons }
  console.log('content-plan-quotes', JSON.stringify(out))
  return new Response(JSON.stringify(out), { headers: JSON_HEADERS })
})
