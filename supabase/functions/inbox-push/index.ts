import { createClient } from 'npm:@supabase/supabase-js@2'
import { sendPush } from '../_shared/push-send.ts'

Deno.serve(async (req) => {
  if (req.headers.get('x-inbox-secret') !== Deno.env.get('INBOX_PUSH_SECRET'))
    return new Response('unauthorized', { status: 401 })
  const { message_id } = await req.json()
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data: m } = await db.from('inbox_messages_v').select('*').eq('id', message_id).single()
  if (!m || m.direction !== 'inbound') return new Response('skip')
  // The payload and the read above are unchanged. Only the send moved: the VAPID
  // setup, the fan-out and the 404/410 prune now live in _shared/push-send.ts so
  // inbox-notify and inbox-turn-run push through the same code rather than a copy.
  const { subs, results } = await sendPush(db, {
    title: `${m.prospect_name} · ${m.client_id === 'risedtc' ? 'Rise' : 'Ivan'}`,
    body: (m.message_text ?? '').slice(0, 140),
    // Relative URL: resolves against the sw scope (/ivan-inbox/ on GH Pages).
    // A leading slash resolves to the *user root* and the app never loads.
    url: `./#thread/${m.prospect_id}`,
  })
  console.log(JSON.stringify({ message_id, subs, results }))
  return new Response('ok')
})
