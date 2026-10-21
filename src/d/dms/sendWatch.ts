// After a send, watch the row (Ivan 10-21, Leighton Penrose). The only feedback after Send used to be
// "Queued ... about 2 minutes". When the sender then held the row and cleared its approval, the bubble
// quietly turned back into a held card and nothing said so: he read it as the app deleting his message.
//
// Each row sent from this screen is read every WATCH_EVERY_MS for WATCH_MS (the sender picks a row up
// within about 2 minutes and holds it within seconds). If it comes back held, one failure toast names the
// reason. A row seen sent on two reads in a row is done (the sender can stamp sent_at for ~3 s before it
// reverts a hold, so one read is not proof). A failed read is skipped, never reported.
import { isHeldSend, readSendState, type InboxMessage, type SendState } from '../../lib/inbox'

export const WATCH_MS = 180_000
export const WATCH_EVERY_MS = 15_000

type Watch = { until: number; sentSeen: number; onHeld: (row: SendState) => void }
const watching = new Map<string, Watch>()
let timer: ReturnType<typeof setTimeout> | null = null
let reading = false

/** Watch these rows for a hold. Watching a row again restarts its window with the new callback. */
export function watchSend(ids: string[], onHeld: (row: SendState) => void, now = Date.now()): void {
  for (const id of ids) watching.set(id, { until: now + WATCH_MS, sentSeen: 0, onHeld })
  if (ids.length && timer === null) timer = setTimeout(tick, WATCH_EVERY_MS)
}

/** Tests only. */
export function stopWatching(): void {
  watching.clear()
  if (timer !== null) clearTimeout(timer)
  timer = null
  reading = false
}
export const watchedIds = () => [...watching.keys()]

async function tick(): Promise<void> {
  timer = null
  if (reading) return
  const ids = [...watching.keys()]
  if (!ids.length) return
  reading = true
  try {
    const rows = await readSendState(ids)
    for (const r of rows) {
      const w = watching.get(r.id)
      if (!w) continue
      if (r.sent_at) {
        if (++w.sentSeen >= 2) watching.delete(r.id)
        continue
      }
      w.sentSeen = 0
      if (isHeldSend(r as InboxMessage)) { watching.delete(r.id); w.onHeld(r) }
    }
  } catch { /* a failed read is skipped; the window still ends on time */ } finally { reading = false }
  const now = Date.now()
  for (const [id, w] of watching) if (now >= w.until) watching.delete(id)
  if (watching.size && timer === null) timer = setTimeout(tick, WATCH_EVERY_MS)
}
