import webpush from 'npm:web-push@3.6.7'
import { createClient } from 'npm:@supabase/supabase-js@2'

// Morning brief push (fired by pg_cron at 09:30 UTC = 06:30 BA).
// BORN-DEAD: no-ops until integration_config.morning_push_enabled = 'true'.
// Auth mirrors inbox-push: x-inbox-secret header, verify_jwt off.
Deno.serve(async (req) => {
  if (req.headers.get('x-inbox-secret') !== Deno.env.get('INBOX_PUSH_SECRET'))
    return new Response('unauthorized', { status: 401 })
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data: cfg } = await db.from('integration_config')
    .select('value').eq('key', 'morning_push_enabled').maybeSingle()
  if (cfg?.value !== 'true') {
    console.log(JSON.stringify({ morning_push: 'disabled' }))
    return new Response('disabled')
  }
  // Counts mode = the same filtered definition that feeds badge + Today hero
  // (no scan opens, no autoreplies, 72h cutoff) — push body inherits the cuts.
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const res = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/get-morning-brief?mode=counts`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  })
  if (!res.ok) {
    console.log(JSON.stringify({ morning_push: 'counts_fetch_failed', status: res.status }))
    return new Response('counts failed', { status: 502 })
  }
  const c = await res.json()
  const approvals = (c.approvals?.comments ?? 0) + (c.approvals?.dms ?? 0) + (c.approvals?.feed ?? 0)
  const payload = JSON.stringify({
    title: 'Morning brief',
    body: `${c.urgencies_count ?? 0} urgent · ${approvals} approvals`,
    // Relative: resolves against the sw scope (/ivan-inbox/ on GH Pages).
    url: './#today',
  })
  const { data: subs } = await db.from('push_subscriptions').select('*').eq('device_label', 'ivan-inbox')
  if (!subs || subs.length === 0) {
    console.log(JSON.stringify({ morning_push: 'no_subs' }))
    return new Response('ok')
  }
  webpush.setVapidDetails(
    Deno.env.get('VAPID_SUBJECT') ?? 'mailto:im@ivanmanfredi.com',
    Deno.env.get('INBOX_VAPID_PUBLIC_KEY')!, Deno.env.get('INBOX_VAPID_PRIVATE_KEY')!)
  const results = await Promise.all(subs.map(s =>
    webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload)
      .then(() => 'sent')
      .catch(async (e: { statusCode?: number }) => {
        if (e.statusCode === 404 || e.statusCode === 410) {
          await db.from('push_subscriptions').delete().eq('id', s.id)
          return 'pruned'
        }
        return `error:${e.statusCode}`
      })))
  console.log(JSON.stringify({ morning_push: 'fired', subs: subs.length, results }))
  return new Response('ok')
})
