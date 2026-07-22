/// <reference lib="webworker" />
declare const self: ServiceWorkerGlobalScope
import { precacheAndRoute } from 'workbox-precaching'
precacheAndRoute(self.__WB_MANIFEST)

self.addEventListener('push', (e) => {
  const d = e.data?.json() ?? { title: 'Inbox', body: '' }
  e.waitUntil(self.registration.showNotification(d.title, {
    body: d.body, icon: './icon-192.png', badge: './icon-192.png', data: { url: d.url ?? './' },
  }))
})
self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  e.waitUntil(self.clients.openWindow(e.notification.data?.url ?? './'))
})
