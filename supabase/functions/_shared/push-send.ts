// push-send.ts — ONE web-push sender for the three functions that push.
//
// It is a lift, not a rewrite: the body below is the block that has been living
// inline in inbox-push since 2026-07-25, moved here byte-for-byte in behaviour so
// that inbox-notify and inbox-turn-run cannot drift into a second, subtly
// different notion of "sent". The two things that were NEVER negotiable and are
// preserved exactly:
//
//   - the VAPID pair is the INBOX-scoped one (INBOX_VAPID_*). The project has no
//     shared VAPID_* secrets and the subscribe key in the app must match the key
//     that signs here, or every send 403s.
//   - 404/410 from the push service means the subscription is dead at the vendor,
//     not that the send failed. The row is deleted and the result reads 'pruned'.
//     Leaving those rows behind is how a subscription table rots.
//
// inbox-morning-push is deliberately NOT a caller. It is out of this run's scope.
import webpush from 'npm:web-push@3.6.7'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

export interface PushPayload {
  title: string
  body: string
  url: string
  /** Collapses same-tag notifications on the device. Absent = every push stands alone. */
  tag?: string
  data?: Record<string, unknown>
}

export interface PushOutcome {
  subs: number
  results: string[]
}

/**
 * Send one payload to every subscription carrying `deviceLabel` (default the
 * inbox's own label). Never throws: a caller writing a row wants the outcome, not
 * an exception that loses the row it was about to record.
 */
export async function sendPush(
  db: SupabaseClient,
  payload: PushPayload,
  opts?: { deviceLabel?: string },
): Promise<PushOutcome> {
  const label = opts?.deviceLabel ?? 'ivan-inbox'
  const { data: subs } = await db.from('push_subscriptions').select('*').eq('device_label', label)
  // No subscribers is a fact, not a failure — the UI half of a lane can ship after
  // the sender. Return cleanly without touching VAPID so the chain stays readable
  // in the function log.
  if (!subs || subs.length === 0) return { subs: 0, results: [] }

  webpush.setVapidDetails(
    Deno.env.get('VAPID_SUBJECT') ?? 'mailto:im@ivanmanfredi.com',
    Deno.env.get('INBOX_VAPID_PUBLIC_KEY')!,
    Deno.env.get('INBOX_VAPID_PRIVATE_KEY')!,
  )

  const json = JSON.stringify(payload)
  const results = await Promise.all(subs.map((s: { id: string; endpoint: string; p256dh: string; auth: string }) =>
    webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, json)
      .then(() => 'sent')
      .catch(async (e: { statusCode?: number }) => {
        if (e.statusCode === 404 || e.statusCode === 410) {
          await db.from('push_subscriptions').delete().eq('id', s.id)
          return 'pruned'
        }
        return `error:${e.statusCode}`
      })))

  return { subs: subs.length, results }
}
