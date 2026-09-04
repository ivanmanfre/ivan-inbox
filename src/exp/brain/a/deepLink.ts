// deepLink.ts - where a tap on a feed card actually goes. `notificationDeepLink`
// (lib/turns.ts) already turns a notification's raw url into a safe in-app
// hash; this file's only job is deciding whether that hash means "open the Ask
// thread" (the `ask` segment inbox-notify writes, which is not a real Job) or
// "switch to this lane", so the candidate never navigates itself out of its
// own experiment id by writing a raw hash into the address bar.
import { notificationDeepLink, type Notification } from '../../../lib/turns'
import { parseWbHash } from '../../v2c/route'
import type { Job } from '../../v2c/layout'

export type ResolvedRoute =
  | { place: 'ask'; thread: string | null }
  | { place: 'lane'; job: Job }

const ASK_SEG_RE = /^#exp\/(?:v2c?|brain-[abc])\/ask\b/

/** Pure: a notification's url in, where this candidate should go out. */
export function resolveNotificationRoute(n: Pick<Notification, 'url'>): ResolvedRoute {
  const hash = notificationDeepLink(n)
  if (ASK_SEG_RE.test(hash)) {
    const route = parseWbHash(hash)
    return { place: 'ask', thread: route.thread ?? null }
  }
  return { place: 'lane', job: parseWbHash(hash).job }
}
