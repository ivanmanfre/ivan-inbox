import { supabase } from './supabase'

function b64ToU8(s: string) {
  const pad = '='.repeat((4 - (s.length % 4)) % 4)
  const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)))
}

export type PushState = 'unsupported' | 'denied' | 'off' | 'on'

// ONE DEVICE, ONE ROW.
//
// Ivan, 2026-09-08: "keep receiving double notif on inbox on every dm reply".
// The feed-side dupe (inbound_reply_notice pushing on top of the DM push) had
// already been cut that morning; the phone still rang twice because
// push_subscriptions held TWO live Apple endpoints for the same iPhone — same
// user agent to the byte, one from 08-24, one from 09-02 — both labelled
// ivan-inbox, and every sender fans out to every row under the label
// (`{"subs":3,"results":["sent","sent","sent"]}` on each DM). The note above
// bet that a stale row would 410 and prune itself. Apple never 410'd it in
// fifteen days: a re-added home-screen install leaves the old subscription
// accepted at the vendor.
//
// So the launch-time reconcile now also drops the OTHER ivan-inbox rows that
// carry this device's user agent. The endpoint we just wrote is the one this
// install answers to; a sibling row with the same UA is either a previous
// install of this same phone or a zombie the vendor still accepts. Either way
// it is a second ring on one device. Scoped three ways — label, UA, not-this-
// endpoint — so the dashboard's rows and any other device are never touched.
async function dropSiblingRows(endpoint: string) {
  await supabase.from('push_subscriptions').delete()
    .eq('device_label', 'ivan-inbox')
    .eq('user_agent', navigator.userAgent)
    .neq('endpoint', endpoint)
}

// What's true for THIS device right now — drives the Settings toggle.
export async function getPushState(): Promise<PushState> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return 'unsupported'
  if (Notification.permission === 'denied') return 'denied'
  try {
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.getSubscription()
    return sub ? 'on' : 'off'
  } catch {
    return 'off'
  }
}

export async function enablePush(): Promise<boolean> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false
  if ((await Notification.requestPermission()) !== 'granted') return false
  const reg = await navigator.serviceWorker.ready
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: b64ToU8(import.meta.env.VITE_VAPID_PUBLIC_KEY),
  })
  const j = sub.toJSON()
  const { error } = await supabase.from('push_subscriptions').upsert(
    { endpoint: sub.endpoint, p256dh: j.keys!.p256dh, auth: j.keys!.auth, device_label: 'ivan-inbox', user_agent: navigator.userAgent },
    { onConflict: 'endpoint' })
  if (!error) await dropSiblingRows(sub.endpoint)
  return !error
}

// HEAL THE DRIFT ON EVERY LAUNCH.
//
// Ivan, 2026-08-23: "I'm not getting them on my phone and I have the app."
//
// The diagnosis (evidence/push-diagnosis.md) cleared the entire server chain.
// The trigger fires, and over 08-18 to 08-22 it pushed 80 times for 80 inbound
// messages with every log reading `{"subs":2,"results":["sent","sent"]}`. Zero
// 410s in five days. VAPID matches three ways. The deployed service worker's
// `push` listener calls showNotification and the payload shape agrees.
//
// 🔴 So the break is on the device, PAST Apple's 2xx, and the reason it lasted a
// month is that nothing ever repaired it. A push subscription is not permanent:
// iOS rotates or drops it when the PWA is reinstalled, when storage is evicted,
// or on some OS updates. The app subscribed ONCE, when he first flipped the
// toggle in Settings, and never looked again. There is no
// `pushsubscriptionchange` handler and there was no launch-time check, so the
// moment the device's real endpoint stopped matching the row in the database,
// the row became a token Apple still accepts and the phone no longer answers
// to. The server cannot see the difference and neither could we.
//
// This runs on every mount and costs one idempotent upsert. It never prompts:
// if permission was never granted, or was denied, it does nothing at all, so it
// cannot turn into a nag. If permission IS granted but the device has no
// subscription, that is the orphaned case, and re-subscribing is exactly the
// repair.
//
// It deletes exactly one kind of row: another ivan-inbox row carrying THIS
// device's user agent (see dropSiblingRows). `push_subscriptions` is shared
// with the dashboard and rows are told apart by `device_label`, so nothing
// outside the label is ever touched, and a row for a different device never
// matches the UA. The earlier bet — leave stale rows, the vendor 410s them —
// was measured false on 2026-09-08.
export async function reconcilePush(): Promise<'skipped' | 'healed' | 'ok' | 'failed'> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return 'skipped'
  if (Notification.permission !== 'granted') return 'skipped'
  try {
    const reg = await navigator.serviceWorker.ready
    const existing = await reg.pushManager.getSubscription()
    const sub = existing ?? await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: b64ToU8(import.meta.env.VITE_VAPID_PUBLIC_KEY),
    })
    const j = sub.toJSON()
    const { error } = await supabase.from('push_subscriptions').upsert(
      {
        endpoint: sub.endpoint,
        p256dh: j.keys!.p256dh,
        auth: j.keys!.auth,
        device_label: 'ivan-inbox',
        user_agent: navigator.userAgent,
      },
      { onConflict: 'endpoint' })
    if (error) return 'failed'
    await dropSiblingRows(sub.endpoint)
    return existing ? 'ok' : 'healed'
  } catch {
    return 'failed'
  }
}

// Unsubscribe this device and delete its row so the edge fn stops targeting it.
// Delete is endpoint-scoped + device_label-scoped: never touches other tools'
// rows in the shared push_subscriptions table.
export async function disablePush(): Promise<boolean> {
  try {
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.getSubscription()
    if (!sub) return true
    const endpoint = sub.endpoint
    await sub.unsubscribe()
    await supabase.from('push_subscriptions').delete()
      .eq('endpoint', endpoint).eq('device_label', 'ivan-inbox')
    return true
  } catch {
    return false
  }
}
