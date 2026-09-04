// demoNotifications.ts — a small seeded set spanning real families, gated
// behind `?wbmock=notif:demo`.
//
// Why this exists: the live `inbox_notifications` table (db/049) is real but
// young — on the day this was built it held only smoke/gate-probe rows, none
// of the 17 families 00-notification-families.md measured from the WhatsApp
// history. Screenshotting the family-label map, severity-as-shape and the
// quiet fold honestly needs SOME row from each shape on screen, and there is
// no live row to point a camera at yet. This is that camera's stand-in: seven
// bodies lifted near-verbatim from the family doc's own verbatim examples, so
// the shapes shown are the real shapes, not invented ones.
import type { Notification } from '../../../lib/turns'

const NOW = Date.parse('2026-09-04T14:00:00Z')
const at = (minsAgo: number) => new Date(NOW - minsAgo * 60_000).toISOString()

function row(over: Partial<Notification> & Pick<Notification, 'id' | 'family' | 'severity' | 'title'>): Notification {
  return {
    source: null, body: null, url: null, media: null, group_key: null, tenant: null,
    count: 1, first_seen_at: at(60), last_seen_at: at(30), created_at: at(60),
    read_at: null, dismissed_at: null,
    ...over,
  }
}

export const DEMO_NOTIFICATIONS: Notification[] = [
  row({
    id: 'demo-1', family: 'reply_draft_pending', severity: 'attention', tenant: 'RISE',
    title: 'Stalled convo bump drafted for Alec Lorenzo',
    body: 'Alec, want to get some time next week to have a look at this? Cheers\nApprove in dashboard Review tab.',
    last_seen_at: at(4), created_at: at(4),
  }),
  row({
    id: 'demo-2', family: 'seat_health', severity: 'error', tenant: 'ARCH',
    title: 'Seat Davorin Smit account: OK to CONNECTING',
    body: 'Reconnect from the seat health card.',
    last_seen_at: at(9), created_at: at(9),
  }),
  row({
    id: 'demo-3', family: 'inbound_reply_notice', severity: 'attention', tenant: 'RISE',
    title: 'New inbound reply on Mattans campaigns',
    body: 'Ben Spell (GOOD RANCHERS), CompEngagers lane: "Sure"',
    last_seen_at: at(18), created_at: at(18),
  }),
  row({
    id: 'demo-4a', family: 'post_generation_failed', severity: 'error',
    title: 'Post Generation FAILED (no draft id recovered)',
    body: 'exec 1314612 at "Execute Carousel Workflow", aborted.',
    group_key: 'demo-post-fail', count: 1, last_seen_at: at(50), created_at: at(50),
  }),
  row({
    id: 'demo-4b', family: 'post_generation_failed', severity: 'error',
    title: 'Post Generation FAILED (no draft id recovered)',
    body: 'A second attempt also failed QA (NEEDS_REGENERATE 0/?).',
    group_key: 'demo-post-fail', count: 1, last_seen_at: at(35), created_at: at(35),
  }),
  row({
    id: 'demo-5', family: 'health_reminder', severity: 'info',
    title: 'Reminder: Take your supplement',
    body: 'Routine, personal, not a work notification.',
    last_seen_at: at(90), created_at: at(90),
  }),
  row({
    id: 'demo-6', family: 'content_sourcing_pipeline', severity: 'info',
    title: 'Idea Supply topped up',
    body: 'Fresh high-ICP (<=3d): 7 / floor 10. New ideas appear in Ideas after scoring.',
    last_seen_at: at(75), created_at: at(75),
  }),
  row({
    id: 'demo-7', family: 'system_watchdog_digest', severity: 'info',
    title: 'Memory watchdog: all checks clear again',
    last_seen_at: at(120), created_at: at(120),
  }),
  row({
    id: 'demo-8', family: 'booking_notice', severity: 'attention', tenant: 'ARCH',
    title: 'ARCH booking attribution: 2 bookings attributed',
    body: 'Ivan Kapetanovic, screening interview, unattributed, no evidence trail.',
    last_seen_at: at(200), created_at: at(200),
  }),
]
