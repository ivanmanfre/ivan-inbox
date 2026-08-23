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

self.addEventListener('push', (e) => {
  const d = e.data?.json() ?? { title: 'Inbox', body: '' }
  e.waitUntil(self.registration.showNotification(d.title, {
    body: d.body, icon: './icon-192.png', badge: './icon-192.png', data: { url: d.url ?? './' },
    // Explicitly non-silent so the OS plays its notification sound (macOS:
    // Settings → Notifications → browser → "Play sound" must be on).
    silent: false,
  }))
})
self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  e.waitUntil(self.clients.openWindow(e.notification.data?.url ?? './'))
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
