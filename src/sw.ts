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
