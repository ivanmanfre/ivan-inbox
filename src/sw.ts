/// <reference lib="webworker" />
declare const self: ServiceWorkerGlobalScope
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching'
import { clientsClaim } from 'workbox-core'

// A new build must REPLACE the running one, not queue behind it. Without these
// two lines an updated worker sits in `waiting` until every tab of the app is
// closed — and Ivan keeps tabs open for days, so five deploys in one afternoon
// all landed on a browser still serving the old bundle (2026-08-03: "have u
// even deployed bc this has no changes applied"). `registerType: 'autoUpdate'`
// only injects the registration script; with `injectManifest` the skip is OURS
// to write.
self.skipWaiting()
clientsClaim()

cleanupOutdatedCaches()
precacheAndRoute(self.__WB_MANIFEST)

// The one feed's producers (inbox-notify, db/049) send a `tag` and a `family`
// alongside the title and body. Both earn their place:
//
//   tag    — the OS COLLAPSES notifications that share one. Five failures of the
//            same workflow become one line in Notification Centre instead of five,
//            which is the difference between a feed and a pile. It is the group
//            key when there is one, so what the app folds and what the phone
//            folds are the same fold.
//   family — travels on to the open tabs so the feed can refetch just itself
//            rather than reloading everything on every push.
// What a push LOOKS like (Ivan, 2026-09-06: "make the pwa notifications look
// cooler and have a nicer logo and image"). Three pieces, each doing the most
// its platform allows:
//   icon  — the app mark (public/icon-192.png). On iOS the OS shows the app
//           icon regardless, so the icon set itself is the whole look there.
//   badge — Android's status-bar silhouette: a white glyph on clear. The old
//           build pointed this at the colour icon, which Android flattens into
//           a grey square.
//   image — the big picture Chrome (desktop, Android) hangs under the text: a
//           2:1 card per FAMILY, so a reply, a draft, a Claude turn, an alarm
//           and a digest each read at a glance before the title does. A
//           producer that sends its own `image` wins over the family card.
const PUSH_ART: Record<string, string> = {
  inbound_reply_notice: 'reply', reply_draft_pending: 'reply',
  drafts: 'content', content_board_activity: 'content', content_sourcing_pipeline: 'content',
  post_generation_failed: 'content', draft_generation_error: 'content',
  claude_turn: 'claude',
  engine_error: 'alarm', system_infra_alarm: 'alarm', send_failed_alert: 'alarm',
  seat_health: 'alarm', outreach_engine_ops: 'alarm', scan_quality_alert: 'alarm',
  reporting_digest: 'digest', system_watchdog_digest: 'digest', health_reminder: 'digest',
}
function pushArt(family: unknown): string {
  const f = typeof family === 'string' ? family : ''
  const known = PUSH_ART[f]
  if (known) return `./push-${known}.png`
  // A family the map has never met still gets the nearest card by its name.
  if (/reply|inbound|dm/.test(f)) return './push-reply.png'
  if (/draft|content|post|magnet/.test(f)) return './push-content.png'
  if (/claude|turn/.test(f)) return './push-claude.png'
  if (/error|alarm|fail|health|watchdog/.test(f)) return './push-alarm.png'
  if (/digest|report/.test(f)) return './push-digest.png'
  return './push-inbox.png'
}

self.addEventListener('push', (e) => {
  const d = e.data?.json() ?? { title: 'Inbox', body: '' }
  const url = d.url ?? './'
  e.waitUntil((async () => {
    await self.registration.showNotification(d.title, {
      body: d.body, icon: './icon-192.png', badge: './badge-96.png',
      image: typeof d.image === 'string' ? d.image : pushArt(d.family),
      data: { url, family: d.family },
      ...(d.tag ? { tag: d.tag } : {}),
      // Explicitly non-silent so the OS plays its notification sound (macOS:
      // Settings → Notifications → browser → "Play sound" must be on).
      silent: false,
    })
    // A tab that is already open must not have to be tapped to learn something
    // arrived. Without this the badge on the surface Ivan is LOOKING AT only
    // updates on the next refetch, which is the state that makes an operator
    // stop trusting a feed.
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const c of clients) c.postMessage({ type: 'push', url, family: d.family })
  })())
})

// Tapping a notification must land IN the app, on the thing the notification is
// about. openWindow() alone opens a SECOND copy of the PWA every time — the
// phone ends up with a stack of them, none of them the one holding the session.
// So: reuse an open window if there is one, and navigate it.
self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  const raw = e.notification.data?.url ?? './'
  // Producers write a relative './#exp/...' precisely so it resolves against
  // wherever the app is served from rather than being pinned to a host.
  const target = new URL(raw, self.registration.scope).href
  e.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const open = clients.find(c => c.url.startsWith(self.registration.scope)) ?? clients[0]
    if (open) {
      // focus() first: on iOS a navigate() on an unfocused client can be
      // dropped, and a focused window on the wrong route is still recoverable.
      await open.focus().catch(() => {})
      // matchAll passes includeUncontrolled, so this client may be one this
      // worker does not control, and navigate() rejects on those. Swallowing the
      // rejection and returning is a tap that does nothing, which is the whole
      // complaint. Fall through to openWindow instead.
      const navigated = await open.navigate(target).then(() => true).catch(() => false)
      if (navigated) return
    }
    await self.clients.openWindow(target)
  })())
})

// THE BROWSER TELLING US THE SUBSCRIPTION DIED. There was no handler for this
// until 2026-08-23, which is half of why Ivan's phone went quiet for a month
// while the server logged "sent" 80 times in five days: the push service rotated
// or expired his endpoint, fired this event, nothing listened, and the database
// kept the dead token forever.
//
// The page-side repair is `reconcilePush()` in src/lib/push.ts and it is the
// one that does the real work, because it can reach Supabase with Ivan's
// session. This handler is the belt to that braces: it re-subscribes
// immediately so the device is never without a subscription between the
// expiry and his next launch of the app, and the next `reconcilePush()` writes
// the new endpoint.
//
// It cannot write to the database itself. The worker has no auth session, and
// an anon insert would be refused by RLS. Re-subscribing here and letting the
// page reconcile is the honest split.
self.addEventListener('pushsubscriptionchange', (e) => {
  const ev = e as ExtendableEvent & { oldSubscription?: PushSubscription | null }
  ev.waitUntil((async () => {
    try {
      const old = ev.oldSubscription ?? await self.registration.pushManager.getSubscription()
      const key = old?.options?.applicationServerKey
      if (!key) return
      await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
    } catch {
      // Nothing useful to do from here. The next reconcilePush() on launch
      // subscribes from scratch, which is the path that has a session.
    }
  })())
})
