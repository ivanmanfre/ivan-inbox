import { createClient } from 'npm:@supabase/supabase-js@2'
import { readEmailStats, type MailboxRow } from './handler.ts'

// INBOX_EMAIL_STATS_V1: Instantly counters for Ivan's Lanes page. Same owner check as inbox-calendar.
Deno.serve(async req => {
  const origin = req.headers.get('origin') ?? ''
  const headers = { 'Access-Control-Allow-Origin': origin === 'https://ivanmanfre.github.io' || /^http:\/\/localhost:\d{4,5}$/.test(origin) ? origin : 'https://ivanmanfre.github.io',
    'Access-Control-Allow-Headers': 'authorization, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Content-Type': 'application/json', Vary: 'Origin' }
  const respond = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers })
  if (req.method === 'OPTIONS') return respond({ ok: true })
  if (req.method !== 'POST') return respond({ error: 'Method not allowed.' }, 405)
  const url = Deno.env.get('SUPABASE_URL'), anon = Deno.env.get('SUPABASE_ANON_KEY'), service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'), allowed = Deno.env.get('INBOX_CLAUDE_ALLOWED_USER_ID')
  if (!url || !anon || !service || !allowed) return respond({ error: 'Email stats are not configured.' }, 503)
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer /, '')
  if (!token) return respond({ error: 'Sign in again.' }, 401)
  try {
    const { data, error } = await createClient(url, anon, { auth: { persistSession: false } }).auth.getUser(token)
    if (error || !data.user) return respond({ error: 'Sign in again.' }, 401)
    if (data.user.id !== allowed) return respond({ error: 'Access denied.' }, 403)
  } catch { return respond({ error: 'Login verification is unavailable. Try again.' }, 503) }
  const sb = createClient(url, service, { auth: { persistSession: false } })
  const { data: key, error: ke } = await sb.from('integration_config').select('value').eq('key', 'ivan_instantly_api_key').single()
  if (ke || !key?.value) return respond({ error: 'The Instantly key is missing.' }, 503)
  const since = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10)
  const { data: boxes, error: be } = await sb.from('instantly_mailbox_health').select('day,email,health_score,warmup_spam,problems').gte('day', since).limit(200)
  // Instantly needs a browser User-Agent or Cloudflare answers 403/1010.
  const get = async (path: string) => {
    const r = await fetch('https://api.instantly.ai' + path, { headers: { Authorization: `Bearer ${key.value}`, 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(9000) })
    if (!r.ok) throw Error(r.status === 429 ? 'Instantly is rate-limiting right now. Try again in a minute.' : `Instantly answered ${r.status}.`)
    return r.json()
  }
  try {
    return respond(await readEmailStats(get, be ? [] : (boxes ?? []) as MailboxRow[]))
  } catch (e) {
    return respond({ error: e instanceof Error && /Instantly/.test(e.message) ? e.message : 'Instantly could not be read. Try again.' }, 502)
  }
})
