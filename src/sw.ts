/// <reference lib="webworker" />
declare const self: ServiceWorkerGlobalScope
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching'
import { clientsClaim } from 'workbox-core'
import { supabase } from './lib/supabase'
import { loadInbox } from './lib/inboxLoad'
import { INBOX_QUERY, buildInboxCache, type InboxCache } from './lib/inboxCache'
import { CLAUDE_HANDOFF_KEY, SESSION_KEY, readHandoff, shouldPrefetch, swrHandoffKey, writeHandoff, type ClaudeHandoff } from './lib/handoff'
import type { SwrEntry } from './lib/swr'
import { getBotThread, isUuid, latestThread, listTurns } from './lib/turns'

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
  // The bot's own ask (2026-09-12). The name fall-through below matches
  // /claude|turn/, and 'bot' matches neither, so without this line an actionable
  // bot message would arrive wearing the generic inbox card.
  bot: 'claude',
  // The runner: a job that finished (or died) on the Railway mirror, and the
  // two-way sync that carries its work back to the Mac. Both are Claude doing
  // work, so both take the Claude card rather than the generic inbox one —
  // which is where the name fall-through below would otherwise put them.
  runner_job: 'claude', runner_sync: 'claude',
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
    // `image` is real in Chrome (desktop and Android) and simply ignored where
    // it is not; lib.dom's NotificationOptions never learned it, hence the cast.
    const options: NotificationOptions & { image?: string } = {
      body: d.body, icon: './icon-192.png', badge: './badge-96.png',
      image: typeof d.image === 'string' ? d.image : pushArt(d.family),
      data: { url, family: d.family },
      ...(d.tag ? { tag: d.tag } : {}),
      // Explicitly non-silent so the OS plays its notification sound (macOS:
      // Settings → Notifications → browser → "Play sound" must be on).
      silent: false,
    }
    await self.registration.showNotification(d.title, options)
    // A tab that is already open must not have to be tapped to learn something
    // arrived. Without this the badge on the surface Ivan is LOOKING AT only
    // updates on the next refetch, which is the state that makes an operator
    // stop trusting a feed.
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const c of clients) c.postMessage({ type: 'push', url, family: d.family })
    // A Claude push opens the Claude thread, so that read goes first; the two
    // run one after the other because either may rotate the refresh token.
    if (isClaudeFamily(d.family)) await prefetchClaude(clients.length, d.family, url)
    await prefetchInbox(clients.length)
  })())
})

// The push families whose tap lands on a Claude thread (the same four PUSH_ART
// gives the Claude card).
const CLAUDE_FAMILIES = new Set(['claude_turn', 'bot', 'runner_job', 'runner_sync'])
function isClaudeFamily(family: unknown): boolean {
  return typeof family === 'string' && CLAUDE_FAMILIES.has(family)
}

// THE CLAUDE THREAD, READ AT PUSH TIME (P1 speed, 2026-09-25), the same way and
// under the same rule as prefetchInbox below: only when no window is open (an
// open page owns the refresh token and refetches itself), session from the
// hand-off store, a rotated session written back. Which thread: the one the
// push links (`?thread=<uuid>`), else Claude's own thread for a bot push, else
// the latest ask thread, which is where a cold open lands. The raw rows go to
// the hand-off store; main.tsx adopts them into src/lib/threadCache.ts before
// the first render. An empty read is never saved (N3b).
async function prefetchClaude(windowClients: number, family: unknown, url: string): Promise<string> {
  try {
    const stored = await readHandoff<string>(SESSION_KEY)
    if (!shouldPrefetch({ windowClients, session: stored })) return windowClients > 0 ? 'app-open' : 'no-session'
    const parsed = JSON.parse(stored!) as { access_token: string; refresh_token: string }
    const { data, error } = await supabase.auth.setSession({ access_token: parsed.access_token, refresh_token: parsed.refresh_token })
    if (error || !data.session) return `auth: ${error?.message ?? 'no session'}`
    if (data.session.access_token !== parsed.access_token) await writeHandoff(SESSION_KEY, JSON.stringify(data.session))
    const linked = /[?&]thread=([0-9a-f-]{36})/i.exec(url)?.[1]
    const threadId = isUuid(linked) ? linked
      : (family === 'bot' ? (await getBotThread())?.id : (await latestThread())?.id) ?? null
    if (!threadId) return 'no thread'
    const rows = await listTurns(threadId)
    if (rows.length === 0) return 'empty read, not saved'
    // The replayed context block and raw error detail are never painted, so they never touch storage.
    const slim = rows.map(r => ({ ...r, context: null, error_detail: null }))
    const entry: ClaudeHandoff = { user: data.session.user.id, threadId, savedAt: new Date().toISOString(), rows: slim }
    await writeHandoff(CLAUDE_HANDOFF_KEY, entry)
    return `saved ${rows.length} turns`
  } catch (e) {
    return `failed: ${e instanceof Error ? e.message : String(e)}`
  }
}
;(self as unknown as { __claudePrefetch: typeof prefetchClaude }).__claudePrefetch = prefetchClaude

// FETCH THE DMs LIST NOW, WHILE THE APP IS CLOSED, so the tap on the
// notification opens on current rows instead of on a 3 s read (2026-09-14,
// Ivan: "how can it feel like a true app"). The session comes from the hand-off
// store (src/lib/handoff.ts); an expired access token is refreshed here and the
// rotated session written back, which is safe ONLY because shouldPrefetch
// refuses while any window is open: an open page owns the refresh token. The
// rows are assembled by the same loadInbox the screen uses and saved in the
// same SwrEntry shape, then adopted into localStorage by main.tsx on the next
// open. An empty read is never saved: the inbox is not empty, so an empty
// result is a failed read, not a truth (N3b rule).
async function prefetchInbox(windowClients: number): Promise<string> {
  try {
    const stored = await readHandoff<string>(SESSION_KEY)
    if (!shouldPrefetch({ windowClients, session: stored })) return windowClients > 0 ? 'app-open' : 'no-session'
    const parsed = JSON.parse(stored!) as { access_token: string; refresh_token: string }
    const { data, error } = await supabase.auth.setSession({ access_token: parsed.access_token, refresh_token: parsed.refresh_token })
    if (error || !data.session) return `auth: ${error?.message ?? 'no session'}`
    if (data.session.access_token !== parsed.access_token) await writeHandoff(SESSION_KEY, JSON.stringify(data.session))
    const prior = await readHandoff<SwrEntry<InboxCache>>(swrHandoffKey(INBOX_QUERY))
    const { threads } = await loadInbox(prior?.payload?.threads?.length ?? 0)
    if (threads.length === 0) return 'empty read, not saved'
    const entry: SwrEntry<InboxCache> = { savedAt: new Date().toISOString(), user: data.session.user.id, payload: buildInboxCache(threads) }
    await writeHandoff(swrHandoffKey(INBOX_QUERY), entry)
    return `saved ${entry.payload.threads.length} threads`
  } catch (e) {
    return `failed: ${e instanceof Error ? e.message : String(e)}`
  }
}
// Reachable from a test harness (worker.evaluate) so the prefetch can be driven
// without a real push.
;(self as unknown as { __inboxPrefetch: typeof prefetchInbox }).__inboxPrefetch = prefetchInbox

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
