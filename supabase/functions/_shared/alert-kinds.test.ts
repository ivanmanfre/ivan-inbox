// Vitest, not deno test: vitest.config.ts includes supabase/**/*.test.ts (see
// bot-actions.test.ts's own note on this). Table-driven over the 30-day family
// census (OUT/tools/alert-map.mjs pulls the live counts) plus the exact
// sample title/body pairs from the run brief, so this pins both "every real
// family resolves to something sane" and "these specific known-bad rows come
// out fixed".
import { describe, expect, it } from 'vitest'
import { ALERT_KINDS, kindFor, presentPush, type Kind, type Severity } from './alert-kinds.ts'

const EM_DASH = '—'

// Every family the 30-day live census (run 2026-09-25) showed at least one row
// for, paired with a severity that family actually carried, plus
// `thursday_brief` (a PUSH_DEFAULT family the census month happened not to
// fire).
const CENSUS: ReadonlyArray<{ family: string; severity: Severity }> = [
  { family: 'reply_draft_pending', severity: 'info' },
  { family: 'reply_draft_pending', severity: 'attention' },
  { family: 'reply_draft_pending', severity: 'error' },
  { family: 'system_watchdog_digest', severity: 'info' },
  { family: 'system_watchdog_digest', severity: 'attention' },
  { family: 'system_watchdog_digest', severity: 'error' },
  { family: 'outreach_engine_ops', severity: 'info' },
  { family: 'outreach_engine_ops', severity: 'attention' },
  { family: 'outreach_engine_ops', severity: 'error' },
  { family: 'post_generation_failed', severity: 'error' },
  { family: 'post_generation_failed', severity: 'attention' },
  { family: 'content_sourcing_pipeline', severity: 'info' },
  { family: 'content_sourcing_pipeline', severity: 'error' },
  { family: 'content_sourcing_pipeline', severity: 'attention' },
  { family: 'content_board_activity', severity: 'info' },
  { family: 'content_board_activity', severity: 'error' },
  { family: 'content_board_activity', severity: 'attention' },
  { family: 'reporting_digest', severity: 'info' },
  { family: 'reporting_digest', severity: 'attention' },
  { family: 'bot', severity: 'attention' },
  { family: 'reminder', severity: 'info' },
  { family: 'inbound_reply_notice', severity: 'info' },
  { family: 'inbound_reply_notice', severity: 'attention' },
  { family: 'system_infra_alarm', severity: 'error' },
  { family: 'system_infra_alarm', severity: 'attention' },
  { family: 'system_infra_alarm', severity: 'info' },
  { family: 'booking_notice', severity: 'info' },
  { family: 'booking_notice', severity: 'attention' },
  { family: 'send_failed_alert', severity: 'error' },
  { family: 'send_failed_alert', severity: 'info' },
  { family: 'comment_engagement_notice', severity: 'info' },
  { family: 'comment_engagement_notice', severity: 'attention' },
  { family: 'arch_build_progress', severity: 'info' },
  { family: 'health_reminder', severity: 'info' },
  { family: 'draft_generation_error', severity: 'error' },
  { family: 'scan_quality_alert', severity: 'error' },
  { family: 'scan_quality_alert', severity: 'attention' },
  { family: 'seat_health', severity: 'error' },
  { family: 'seat_health', severity: 'info' },
  { family: 'lane_supply_alarm', severity: 'error' },
  { family: 'lane_supply_alarm', severity: 'attention' },
  { family: 'ops_other', severity: 'info' },
  { family: 'ops_other', severity: 'attention' },
  { family: 'runner_job', severity: 'info' },
  { family: 'claude_turn', severity: 'info' },
  { family: 'lane_run_summary', severity: 'info' },
  { family: 'night_brief', severity: 'info' },
  { family: 'thursday_brief', severity: 'info' },
  { family: 'page_open_notice', severity: 'attention' },
  { family: 'runner_sync', severity: 'attention' },
  { family: 'runner_sync', severity: 'error' },
  { family: 'smoke_push', severity: 'attention' },
  { family: 'chat', severity: 'info' },
  { family: 'relay_smoke', severity: 'info' },
  { family: 'smoke_test', severity: 'info' },
]

describe('kindFor: every census family resolves to a real kind', () => {
  it.each(CENSUS)('$family / $severity', ({ family, severity }) => {
    const kind = kindFor(family, severity)
    expect(Object.keys(ALERT_KINDS)).toContain(kind)
    if (severity === 'error') expect(kind).toBe('failed')
  })

  it('an unseen family still resolves, never throws', () => {
    expect(() => kindFor('a_brand_new_family_nobody_wrote_yet', 'info')).not.toThrow()
    expect(Object.keys(ALERT_KINDS)).toContain(kindFor('a_brand_new_family_nobody_wrote_yet', 'info'))
  })

  it('a name-shaped unseen family still reads honestly', () => {
    expect(kindFor('vendor_sync_failed', 'info')).toBe('failed')
    expect(kindFor('client_approval_pending', 'info')).toBe('needs_you')
    expect(kindFor('lead_booked_notice', 'info')).toBe('booking')
  })
})

describe('the kinds a lock screen has to tell apart are actually distinct', () => {
  // The gate this run reports against (G11): done, needs you, failed, new
  // lead/reply, reminder, and a bot turn with an action (which this file
  // deliberately maps to the same kind as "needs you": see BASE_KIND's own
  // comment on `bot`).
  const core: Kind[] = ['done', 'needs_you', 'failed', 'reply', 'reminder']
  it.each(core.flatMap((a, i) => core.slice(i + 1).map((b) => [a, b] as const)))('%s vs %s', (a, b) => {
    expect(ALERT_KINDS[a].glyph).not.toBe(ALERT_KINDS[b].glyph)
    expect(ALERT_KINDS[a].label).not.toBe(ALERT_KINDS[b].label)
  })

  it('every kind in the table has a unique glyph and a unique label', () => {
    const kinds = Object.keys(ALERT_KINDS) as Kind[]
    const glyphs = kinds.map((k) => ALERT_KINDS[k].glyph)
    const labels = kinds.map((k) => ALERT_KINDS[k].label)
    expect(new Set(glyphs).size).toBe(kinds.length)
    expect(new Set(labels).size).toBe(kinds.length)
  })

  it('a bot turn with an action reads the same as a reply draft waiting on Ivan', () => {
    expect(kindFor('bot', 'attention')).toBe(kindFor('reply_draft_pending', 'attention'))
  })
})

describe('presentPush: table-driven over the census, plus the run brief\'s live sample rows', () => {
  it.each(CENSUS)('$family / $severity never repeats the title in the body, never carries an em dash', ({ family, severity }) => {
    const out = presentPush({ family, severity, title: 'A producer title', body: 'A producer title' })
    expect(out.body).not.toBe(out.title)
    expect(out.title).not.toContain(EM_DASH)
    expect(out.body).not.toContain(EM_DASH)
    expect(out.title.length).toBeLessThanOrEqual(60)
  })

  // The exact rows pasted into the run brief (Ivan's live sample,
  // 2026-09-25), each pinned to the specific defect it demonstrates.
  const SAMPLES: ReadonlyArray<{ name: string; family: string; severity: Severity; title: string; body: string }> = [
    {
      name: 'reminder: title and body were byte-identical',
      family: 'reminder',
      severity: 'info',
      title: '⏰ Reminder: \u{1F48A} Take your ZINC!',
      body: '⏰ Reminder: \u{1F48A} Take your ZINC!',
    },
    {
      name: 'send_failed_alert: body equals title',
      family: 'send_failed_alert',
      severity: 'error',
      title: 'Bubble 2/2 FAILED to Anna Mihno -- earlier bubbles DELIVERED. Send the',
      body: 'Bubble 2/2 FAILED to Anna Mihno -- earlier bubbles DELIVERED. Send the',
    },
    {
      name: 'reply_draft_pending: body repeats title then appends a URL',
      family: 'reply_draft_pending',
      severity: 'info',
      title: 'Scan draft ready for review: Elias Nolin - Suno',
      body: 'Scan draft ready for review: Elias Nolin - Suno | Review and approve: https://example.com/review/1',
    },
    {
      name: 'page_open_notice: body repeats title then appends geo',
      family: 'page_open_notice',
      severity: 'attention',
      title: '\u{1F440} Page opened: leading-social',
      body: '\u{1F440} Page opened: leading-social\nChase City, United States (Microsoft Limited)\n',
    },
    {
      name: 'system_infra_alarm: body wraps the title in markdown and adds an em dash elsewhere',
      family: 'system_infra_alarm',
      severity: 'error',
      title: '\u{1F534} Ivan System',
      body: `\u{1F534} *Ivan System* | ⚠️ *Outreach ${EM_DASH} Conversational Agent Planner* _(Sep 24, 3:12pm)_`,
    },
    {
      name: 'booking_notice: tenant tag plus an em dash, body equals title',
      family: 'booking_notice',
      severity: 'info',
      title: `[ARCH] \u{1F4CA} ARCH booking attribution ${EM_DASH} 1 attributed`,
      body: `[ARCH] \u{1F4CA} ARCH booking attribution ${EM_DASH} 1 attributed`,
    },
    {
      name: 'inbound_reply_notice: tenant tag, body repeats title then appends sender',
      family: 'inbound_reply_notice',
      severity: 'attention',
      title: '[ARCH] Email to madebyarch.com from an unknown sender',
      body: '[ARCH] Email to madebyarch.com from an unknown sender | From: someone@example.com',
    },
    {
      name: 'scan_quality_alert: a LIVE confirmation, not a review nudge',
      family: 'scan_quality_alert',
      severity: 'attention',
      title: '✅ PROFILE comment gate is LIVE (post urn:li:activity:1)',
      body: '✅ PROFILE comment gate is LIVE (post urn:li:activity:1)',
    },
  ]

  it.each(SAMPLES)('$name', ({ family, severity, title, body }) => {
    const out = presentPush({ family, severity, title, body })
    expect(out.body).not.toBe(out.title)
    expect(out.body).not.toBe(title)
    expect(out.title).not.toContain(EM_DASH)
    expect(out.body).not.toContain(EM_DASH)
    expect(out.title.length).toBeLessThanOrEqual(60)
  })

  it('the reminder sample keeps its glyph+label lead and does not just echo the raw body twice', () => {
    const out = presentPush({
      family: 'reminder',
      severity: 'info',
      title: '⏰ Reminder: \u{1F48A} Take your ZINC!',
      body: '⏰ Reminder: \u{1F48A} Take your ZINC!',
    })
    expect(out.title.startsWith(ALERT_KINDS.reminder.glyph)).toBe(true)
    expect(out.body.toLowerCase()).toContain('zinc')
  })

  it('the LIVE confirmation resolves to done, not needs_you, despite its family default', () => {
    const out = presentPush({
      family: 'scan_quality_alert',
      severity: 'attention',
      title: '✅ PROFILE comment gate is LIVE (post urn:li:activity:1)',
      body: '✅ PROFILE comment gate is LIVE (post urn:li:activity:1)',
    })
    expect(out.title.startsWith(ALERT_KINDS.done.glyph)).toBe(true)
  })

  it('a genuine scan_quality_alert review nudge (no LIVE/checkmark wording) stays needs_you', () => {
    const out = presentPush({
      family: 'scan_quality_alert',
      severity: 'attention',
      title: 'Profile comment gate degrading on 3 anchors',
      body: 'Profile comment gate degrading on 3 anchors',
    })
    expect(out.title.startsWith(ALERT_KINDS.needs_you.glyph)).toBe(true)
  })

  it('the ARCH tenant tag survives cleanup on both the booking and inbound-reply samples', () => {
    const booking = presentPush({
      family: 'booking_notice',
      severity: 'info',
      title: `[ARCH] \u{1F4CA} ARCH booking attribution ${EM_DASH} 1 attributed`,
      body: `[ARCH] \u{1F4CA} ARCH booking attribution ${EM_DASH} 1 attributed`,
    })
    expect(booking.title).toContain('[ARCH]')
    const reply = presentPush({
      family: 'inbound_reply_notice',
      severity: 'attention',
      title: '[ARCH] Email to madebyarch.com from an unknown sender',
      body: '[ARCH] Email to madebyarch.com from an unknown sender | From: someone@example.com',
    })
    expect(reply.title).toContain('[ARCH]')
  })

  it('an empty body falls back to the cleaned subject, never to an empty string', () => {
    const out = presentPush({ family: 'claude_turn', severity: 'info', title: 'Todays wrap is ready', body: null })
    expect(out.body.trim().length).toBeGreaterThan(0)
    expect(out.body).not.toBe(out.title)
  })
})
