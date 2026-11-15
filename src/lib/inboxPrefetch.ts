import { assembleInbox, loadInbox } from './inboxLoad'
import { changedSince } from './inboxDelta'
import { readInboxSnapshot, snapshotDelta, writeInboxSnapshot } from './inboxSnapshot'
import type { Thread } from './inbox'

/**
 * The worker's push-time DMs read (src/sw.ts prefetchInbox), lifted out so it can be tested.
 * 2026-11-15 speed review: every push while the app was closed read the whole message view (~7 MB);
 * the phone started ~31 of those a day. It now starts from the device snapshot the page keeps
 * (lib/inboxSnapshot, the same IndexedDB store) plus the conversations that moved, and falls back
 * to the whole read only when the snapshot is missing or cannot be trusted. Either way it writes the
 * snapshot back, so the next open of the app starts warm too. Never writes for an empty result.
 */
export async function prefetchInboxThreads(user: string, knownThreads: number, now: number = Date.now()): Promise<{ threads: Thread[]; via: 'snapshot' | 'whole' }> {
  const snap = await readInboxSnapshot(user, now).catch(() => null)
  if (snap) {
    const d = await snapshotDelta(snap).catch(() => null)
    if (d) {
      const { threads } = await assembleInbox(d.rows)
      if (threads.length > 0) await writeInboxSnapshot({ user, rows: d.rows, watermark: d.watermark, fullAt: snap.fullAt })
      return { threads, via: 'snapshot' }
    }
  }
  const mark = changedSince(null).then(c => c.now, () => null)
  const startedAt = Date.now()
  const res = await loadInbox(knownThreads)
  const watermark = await mark
  if (res.threads.length > 0 && watermark) await writeInboxSnapshot({ user, rows: res.viewRows, watermark, fullAt: startedAt })
  return { threads: res.threads, via: 'whole' }
}
