import webpush from 'npm:web-push@3.6.7'
import { createClient } from 'npm:@supabase/supabase-js@2'

Deno.serve(async (req) => {
  if (req.headers.get('x-inbox-secret') !== Deno.env.get('INBOX_PUSH_SECRET'))
    return new Response('unauthorized', { status: 401 })
  const { message_id } = await req.json()
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data: m } = await db.from('inbox_messages_v').select('*').eq('id', message_id).single()
  if (!m || m.direction !== 'inbound') return new Response('skip')
  const { data: subs } = await db.from('push_subscriptions').select('*').eq('device_label', 'ivan-inbox')
  // No inbox subscribers yet (UI half ships later) — nothing to send. Return
  // cleanly without touching VAPID so the chain is observable via logs.
  if (!subs || subs.length === 0) {
    console.log(JSON.stringify({ message_id, subs: 0, results: [] }))
    return new Response('ok')
  }
  // Inbox-scoped keypair (INBOX_VAPID_*): the project has no shared VAPID_*
  // secrets, and the subscribe key in the app must match the signing key here.
  webpush.setVapidDetails(
    Deno.env.get('VAPID_SUBJECT') ?? 'mailto:im@ivanmanfredi.com',
    Deno.env.get('INBOX_VAPID_PUBLIC_KEY')!, Deno.env.get('INBOX_VAPID_PRIVATE_KEY')!)
  const payload = JSON.stringify({
    title: `${m.prospect_name} · ${m.client_id === 'risedtc' ? 'Rise' : 'Ivan'}`,
    body: (m.message_text ?? '').slice(0, 140),
    url: `/#thread/${m.prospect_id}`,
  })
  const results = await Promise.all((subs ?? []).map(s =>
    webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload)
      .then(() => 'sent')
      .catch(async (e: { statusCode?: number }) => {
        if (e.statusCode === 404 || e.statusCode === 410) {
          await db.from('push_subscriptions').delete().eq('id', s.id)
          return 'pruned'
        }
        return `error:${e.statusCode}`
      })))
  console.log(JSON.stringify({ message_id, subs: (subs ?? []).length, results }))
  return new Response('ok')
})
