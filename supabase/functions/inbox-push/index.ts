import { createClient } from 'npm:@supabase/supabase-js@2'
import { sendPush } from '../_shared/push-send.ts'
import { presentPush } from '../_shared/alert-kinds.ts'

Deno.serve(async (req) => {
  if (req.headers.get('x-inbox-secret') !== Deno.env.get('INBOX_PUSH_SECRET'))
    return new Response('unauthorized', { status: 401 })
  const { message_id } = await req.json()
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data: m } = await db.from('inbox_messages_v').select('*').eq('id', message_id).single()
  if (!m || m.direction !== 'inbound') return new Response('skip')
  // The read above is unchanged. Only the send moved: the VAPID setup, the
  // fan-out and the 404/410 prune now live in _shared/push-send.ts so
  // inbox-notify and inbox-turn-run push through the same code rather than a copy.
  //
  // This is THE inbound-reply push (the feed's inbound_reply_notice row is
  // feed-only since 2026-09-08, precisely because this is the one that rings),
  // so it is run through the same family-to-kind map every other push uses
  // (alert-kinds.ts): the lock screen leads with the "reply" glyph/label,
  // the name/tenant that used to be the whole title becomes the subject after
  // it, and the message text is the body, unchanged apart from the same
  // markdown/URL/em-dash cleanup every other family gets.
  const nameSubject = `${m.prospect_name} · ${m.client_id === 'risedtc' ? 'Rise' : m.client_id === 'arch' ? 'ARCH' : 'Ivan'}`
  const presented = presentPush({
    family: 'inbound_reply_notice',
    severity: 'info',
    title: nameSubject,
    body: (m.message_text ?? '').slice(0, 140),
  })
  const { subs, results } = await sendPush(db, {
    title: presented.title,
    // presentPush can add a couple of characters back (an em dash becomes
    // ". "), so re-slice after it, the same as notify.ts does.
    body: presented.body.slice(0, 140),
    // Relative URL: resolves against the sw scope (/ivan-inbox/ on GH Pages).
    // A leading slash resolves to the *user root* and the app never loads.
    url: `./#thread/${m.prospect_id}`,
    // The service worker hangs the reply card under this family and the open
    // tabs refetch the DMs feed.
    family: 'inbound_reply_notice',
  })
  console.log(JSON.stringify({ message_id, subs, results }))
  return new Response('ok')
})
