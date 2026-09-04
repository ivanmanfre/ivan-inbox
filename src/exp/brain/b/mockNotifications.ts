// mockNotifications.ts — a fixture reachable ONLY behind `?wbmock=feed:demo`,
// in the same idiom v2c/mock.ts already uses for `wbmock=chat:...` (a query
// flag, read once, invisible unless someone asks for it by name).
//
// Why this exists: an offline surface for developing the feed without touching
// live rows. It is NOT what the Phase 3 evidence is shot against any more —
// `03-build/b/scripts/seed-feed.mjs` writes one real row per family through
// `inbox-notify` and `shots/feed.png` is the live table. The fixture stays
// because it is the only way to render all seventeen shapes at once with no
// network, and every body in it is a trimmed verbatim example from
// 00-notification-families.md, not invented copy.

import type { Notification } from '../../../lib/turns'

let seq = 0
function row(partial: Omit<Notification, 'id' | 'first_seen_at' | 'last_seen_at' | 'created_at' | 'read_at' | 'dismissed_at' | 'media' | 'source' | 'group_key' | 'count'> & {
  ageMin: number; read?: boolean; count?: number; groupKey?: string | null
}): Notification {
  seq += 1
  const at = new Date(Date.now() - partial.ageMin * 60_000).toISOString()
  return {
    id: `mock-${seq}`, source: null, media: null, group_key: partial.groupKey ?? null,
    count: partial.count ?? 1,
    first_seen_at: at, last_seen_at: at, created_at: at,
    read_at: partial.read ? at : null, dismissed_at: null,
    family: partial.family, severity: partial.severity, title: partial.title,
    body: partial.body, url: partial.url, tenant: partial.tenant,
  }
}

export function mockNotificationRows(): Notification[] {
  return [
    row({
      family: 'reply_draft_pending', severity: 'attention', tenant: 'rise',
      title: 'Stalled convo bump drafted for Alec Lorenzo', ageMin: 6,
      body: "[risedtc seat] Stalled convo bump drafted for Alec Lorenzo (ICP 7, silent 8d):\n\nAlec -- Want to get some time next week to have a look at this? Cheers",
      url: './#exp/v2/dms',
    }),
    row({
      family: 'system_infra_alarm', severity: 'error', tenant: null,
      title: 'GITHUB BACKUPS failed', ageMin: 42,
      body: '⚠️ Workflow Error\n\nGITHUB BACKUPS\nNode: Push Repos\n\nService unavailable — try again later.',
      url: null,
    }),
    row({
      family: 'outreach_engine_ops', severity: 'attention', tenant: 'rise',
      title: 'RISE Warm Engager', ageMin: 12,
      body: '🛑 RISE Warm Engager HALTED — Apify MTD $120.57 >= cap $120', url: './#exp/v2/sends',
    }),
    row({
      family: 'post_generation_failed', severity: 'error', tenant: 'ivan', count: 8,
      title: 'Post Generation failed', ageMin: 90,
      body: '⚠️ Post Generation FAILED (no draft id recovered)\nexec 1314612 at "Execute Carousel Workflow"\naborted',
      url: './#exp/v2/content',
    }),
    row({
      family: 'inbound_reply_notice', severity: 'attention', tenant: 'rise', count: 2, read: false,
      title: 'New inbound replies', ageMin: 3, groupKey: 'inbound-demo',
      body: '🟢 RISE DTC — new inbound replies (2) on Mattan\'s campaigns:\n\n• Ben Spell (GOOD RANCHERS): "Ben reacted 👍"\n• Chris Harwood (ENHANCD): "Sure"',
      url: './#exp/v2/dms',
    }),
    row({
      family: 'inbound_reply_notice', severity: 'attention', tenant: 'rise', read: true,
      title: 'New inbound reply', ageMin: 55, groupKey: 'inbound-demo',
      body: '🟢 RISE DTC — new inbound reply on Mattan\'s campaigns:\n\n• Alec Lorenzo — RISE lane:\n  "Yes"',
      url: './#exp/v2/dms',
    }),
    row({
      family: 'scan_quality_alert', severity: 'error', tenant: 'rise',
      title: 'Audit BLOCKED for humann.com', ageMin: 200, read: true,
      body: '⛔ Audit BLOCKED for humann.com — Apify nearly out ($220.02/$220). Top up to resume audits.',
      url: './#exp/v2/ops',
    }),
    row({
      family: 'comment_engagement_notice', severity: 'attention', tenant: 'arch',
      title: 'New comment on Davorin\'s posts', ageMin: 25,
      body: '1 new comment on Davorin\'s posts (ARCH):\n\nAnna Romaniuk: "And then you, as the client..."',
      url: './#exp/v2/dms',
    }),
    row({
      family: 'booking_notice', severity: 'attention', tenant: 'rise',
      title: 'RISE booking attribution', ageMin: 130, read: true,
      body: '📊 RISE booking attribution\n\n1 booking attributed:\n\n• Mace Peter · mattan5\n  unattributed · no evidence trail',
      url: './#exp/v2/ops',
    }),
    row({
      family: 'arch_build_progress', severity: 'info', tenant: 'arch',
      title: 'Client board ready: focuswp-co', ageMin: 300, read: true,
      body: '✅ Client board ready: focuswp-co\nhttps://inboundonsteroids.com/client/focuswp-co',
      url: './#exp/v2/ops',
    }),
    row({
      family: 'seat_health', severity: 'error', tenant: 'arch',
      title: 'Seat Mattan Danino', ageMin: 8,
      body: 'SEAT HEALTH\n🔴 Seat Mattan Danino account: OK → CONNECTING\nReconnect: https://account.unipile.com/…',
      url: './#exp/v2/ops',
    }),
    row({
      family: 'draft_generation_error', severity: 'error', tenant: 'ivan',
      title: 'Warm drafter failed for Gemma Telford', ageMin: 15,
      body: "⚠ Warm drafter couldn't write a reply for Gemma Telford (ICP 7): proxy call error: timeout of 60000ms exceeded.",
      url: './#exp/v2/dms',
    }),
    row({
      family: 'send_failed_alert', severity: 'error', tenant: null,
      title: 'Send FAILED to Sarah Francis', ageMin: 20,
      body: 'Send FAILED (verified not delivered) to Sarah Francis. Row reset + blocked. Reason: hard error: 422',
      url: './#exp/v2/sends',
    }),
    row({
      family: 'reporting_digest', severity: 'info', tenant: null, read: true,
      title: 'Thursday brief ready', ageMin: 500,
      body: 'Thursday brief ready: ARCH onboarding built out plus a real Apify cap and Smartlead cleanup. 4 things need you.',
      url: './#exp/v2/today',
    }),
    row({
      family: 'content_board_activity', severity: 'info', tenant: 'rise', read: true,
      title: 'Rise DTC board activity', ageMin: 60,
      body: "Rise DTC board: 6 taps · SET SCHEDULE 'Carousel: The $6k Meta teardown'",
      url: './#exp/v2/content',
    }),
    row({
      family: 'content_sourcing_pipeline', severity: 'info', tenant: 'rise', read: true,
      title: 'Idea Supply LOW', ageMin: 400,
      body: 'Idea Supply LOW — topping up\nFresh high-ICP (<=3d): 7 / floor 10',
      url: './#exp/v2/content',
    }),
    row({
      family: 'system_watchdog_digest', severity: 'info', tenant: null, read: true,
      title: 'memory watchdog', ageMin: 700,
      body: '✅ memory watchdog: all checks clear again',
      url: null,
    }),
    row({
      family: 'health_reminder', severity: 'info', tenant: null, read: true,
      title: 'Take your TRT', ageMin: 800,
      body: '⏰ Reminder: Take your TRT 💉',
      url: null,
    }),
    row({
      // The family this app writes about itself, and the majority of the live
      // feed. `title` is the PROMPT, `body` is the ANSWER: that is the way
      // inbox-turn-run fills the row, and the card reads them in that order.
      family: 'claude_turn', severity: 'info', tenant: null, count: 2,
      title: 'What is waiting on me right now?',
      body: 'Three reply drafts are waiting on you, and one seat needs reconnecting before the RISE lane can send again.',
      url: './#exp/v2/ask?thread=8f1d1b7c-2f6a-4a1e-9a2b-1c6f3d4e5a6b&turn=1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
      ageMin: 7,
    }),
  ]
}
