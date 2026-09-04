import { describe, expect, it } from 'vitest'
import {
  answerHeadline, FAMILY_LABEL, familyLabel, groupStateWord, looksRaw, sanitizeBody,
  severityShape, stateWord, stripMarkdown, type FamilyKey,
} from './families'
import type { Notification } from '../../../lib/turns'

// Every body below is copied verbatim (or near-verbatim, trimmed) from
// 00-notification-families.md §3 "Verbatim examples per family" — the brief's
// own instruction: "tested against the verbatim bodies ... it must produce a
// sane word for every family's examples and never a raw token like
// PARENT_CONNECTING."

function n(family: FamilyKey, body: string, extra: Partial<Notification> = {}): Notification {
  return {
    id: 'x', family, source: null, severity: 'info', title: body.slice(0, 40),
    body, url: null, media: null, group_key: null, tenant: null, count: 1,
    first_seen_at: '', last_seen_at: '', created_at: '', read_at: null, dismissed_at: null,
    ...extra,
  }
}

const ALL_FAMILIES: FamilyKey[] = [
  'reply_draft_pending', 'system_infra_alarm', 'outreach_engine_ops',
  'post_generation_failed', 'content_board_activity', 'health_reminder',
  'content_sourcing_pipeline', 'system_watchdog_digest', 'inbound_reply_notice',
  'reporting_digest', 'scan_quality_alert', 'comment_engagement_notice',
  'booking_notice', 'arch_build_progress', 'seat_health',
  'draft_generation_error', 'send_failed_alert', 'chat',
  // Not one of the 17 measured WhatsApp families: this app writes it about
  // itself when a turn finishes while the phone is away. It is the single
  // highest-volume family on the live feed.
  'claude_turn',
]

describe('FAMILY_LABEL', () => {
  it('covers all 17 keys plus chat and claude_turn', () => {
    expect(Object.keys(FAMILY_LABEL).sort()).toEqual([...ALL_FAMILIES].sort())
  })
  it('never leaks a raw DB value as the label', () => {
    for (const f of ALL_FAMILIES) {
      expect(FAMILY_LABEL[f]).not.toBe(f)
      expect(FAMILY_LABEL[f]).not.toMatch(/_/)
    }
  })
  it('falls back for an unknown key rather than throwing', () => {
    expect(familyLabel('some_new_family_nobody_named_yet')).toBe('Notification')
  })
})

describe('looksRaw', () => {
  it('flags an ALL_CAPS_WITH_UNDERSCORES token', () => {
    expect(looksRaw('PARENT_CONNECTING')).toBe(true)
    expect(looksRaw('NEEDS_REGENERATE')).toBe(true)
  })
  it('does not flag ordinary words or a plain acronym', () => {
    expect(looksRaw('Halted')).toBe(false)
    expect(looksRaw('OK')).toBe(false)
    expect(looksRaw('Running again')).toBe(false)
  })
})

describe('stateWord — every family, on its own verbatim bodies', () => {
  it('reply_draft_pending', () => {
    const body = "[risedtc seat] Stalled convo bump drafted for Alec Lorenzo (ICP 7, silent 8d, judged interest_then_silence):\n\nAlec -- Want to get some time next week to have a look at this? Cheers"
    expect(stateWord(n('reply_draft_pending', body))).toBe('Draft waiting')
    expect(stateWord(n('reply_draft_pending', body, { count: 3 }))).toBe('3 waiting')
  })

  it('system_infra_alarm', () => {
    const body = '⚠️ Railway OAuth: Railway OAuth critically low or failed: 1h remaining'
    expect(stateWord(n('system_infra_alarm', body))).toBe('Broke')
  })

  it('outreach_engine_ops — halted', () => {
    const body = '🛑 RISE Warm Engager HALTED — Apify MTD $120.57 >= cap $120'
    expect(stateWord(n('outreach_engine_ops', body))).toBe('Halted')
  })

  it('outreach_engine_ops — under delivery', () => {
    const body = '⚠ UNDER-DELIVERY: full slice drained, 0 staged'
    expect(stateWord(n('outreach_engine_ops', body))).toBe('Under floor')
  })

  it('outreach_engine_ops — recovered reads as running again', () => {
    const body = 'Fri-Sat the senders were silent because of a scheduling bug on my side (trigger cron was weekdays-only) - fixed, the lane now runs Sun-Fri as you asked.'
    expect(stateWord(n('outreach_engine_ops', body))).toBe('Running again')
  })

  it('outreach_engine_ops — routine pace line reads as running', () => {
    const body = '❄️ RISE Cold Engine [pace 30 @ yield 7%]\nqueue 249→236 (swept 0)'
    expect(stateWord(n('outreach_engine_ops', body))).toBe('Running')
  })

  it('post_generation_failed', () => {
    const body = '⚠️ Post Generation FAILED (no draft id recovered)\nexec 1314612 at "Execute Carousel Workflow"\naborted'
    expect(stateWord(n('post_generation_failed', body))).toBe('Failed')
    expect(stateWord(n('post_generation_failed', body, { count: 8 }))).toBe('8 failed')
  })

  it('content_board_activity — count of taps becomes the word', () => {
    const body = "Rise DTC board: 6 taps · SET SCHEDULE 'Carousel: The $6k Meta teardown'"
    expect(stateWord(n('content_board_activity', body))).toBe('6 today')
  })

  it('content_board_activity — no tap count falls back cleanly', () => {
    const body = 'RISE weekly note for Monday, already on the board.'
    expect(stateWord(n('content_board_activity', body))).toBe('Board updated')
  })

  it('health_reminder', () => {
    expect(stateWord(n('health_reminder', '⏰ Reminder: Take your TRT 💉'))).toBe('Reminder')
  })

  it('content_sourcing_pipeline', () => {
    const body = 'Idea Supply LOW — topping up\nFresh high-ICP (<=3d): 7 / floor 10'
    expect(stateWord(n('content_sourcing_pipeline', body))).toBe('New ideas')
  })

  it('system_watchdog_digest — all clear', () => {
    expect(stateWord(n('system_watchdog_digest', '✅ memory watchdog: all checks clear again'))).toBe('All clear')
  })

  it('system_watchdog_digest — failed', () => {
    const body = '🌙 Dreaming 2026-08-23\n⚠ GATE SELF-TEST FAILED — LLM lane skipped'
    expect(stateWord(n('system_watchdog_digest', body))).toBe('Checks failed')
  })

  it('inbound_reply_notice', () => {
    const body = '🟢 RISE DTC — new inbound reply on Mattan\'s campaigns:\n\n• Alec Lorenzo — RISE lane:\n  "Yes"'
    expect(stateWord(n('inbound_reply_notice', body))).toBe('Replied')
    expect(stateWord(n('inbound_reply_notice', body, { count: 8 }))).toBe('8 replied')
  })

  it('reporting_digest', () => {
    const body = 'Thursday brief ready: ARCH onboarding built out plus a real Apify cap and Smartlead cleanup.'
    expect(stateWord(n('reporting_digest', body))).toBe('Ready')
  })

  it('scan_quality_alert — blocked', () => {
    const body = '⛔ Audit BLOCKED for humann.com — Apify nearly out ($220.02/$220). Top up to resume audits.'
    expect(stateWord(n('scan_quality_alert', body))).toBe('Blocked')
  })

  it('scan_quality_alert — degrading', () => {
    const body = '⚠️ Audit enrichment credits LOW — Apify 97% ($266.69/$275). Audits are degrading silently'
    expect(stateWord(n('scan_quality_alert', body))).toBe('Degrading')
  })

  it('comment_engagement_notice', () => {
    const body = '1 new comment on Davorin\'s posts (ARCH):\n\nAnna Romaniuk: "And then you..."'
    expect(stateWord(n('comment_engagement_notice', body))).toBe('New comment')
  })

  it('booking_notice', () => {
    const body = '📊 RISE booking attribution\n\n1 booking attributed:\n\n• Mace Peter · mattan5\n  unattributed · no evidence trail'
    expect(stateWord(n('booking_notice', body))).toBe('Booked')
  })

  it('arch_build_progress', () => {
    const body = '✅ Client board ready: focuswp-co\nhttps://inboundonsteroids.com/client/focuswp-co?k=0b556bb12062db3226fd8838'
    expect(stateWord(n('arch_build_progress', body))).toBe('Ready')
  })

  it('seat_health — a bad transition never leaks the raw target token', () => {
    const body = 'SEAT HEALTH\n🔴 Seat Mattan Danino Sales Navigator: OK → PARENT_CONNECTING'
    const word = stateWord(n('seat_health', body, { severity: 'error' }))
    expect(word).toBe('Disconnected')
    expect(word).not.toMatch(/PARENT_CONNECTING/)
    expect(looksRaw(word)).toBe(false)
  })

  it('seat_health — CREDENTIALS transition also reads as disconnected, not the raw word', () => {
    const body = 'SEAT HEALTH\n🔴 Seat Davorin Smit account: OK → CREDENTIALS'
    const word = stateWord(n('seat_health', body, { severity: 'error' }))
    expect(word).toBe('Disconnected')
    expect(word).not.toMatch(/CREDENTIALS/)
  })

  it('seat_health — recovered', () => {
    const body = '✅ Seat Davorin Smit account: OK'
    expect(stateWord(n('seat_health', body))).toBe('Reconnected')
  })

  it('draft_generation_error', () => {
    const body = "⚠ Warm drafter couldn't write a reply for Gemma Telford (ICP 7): proxy call error: timeout of 60000ms exceeded."
    expect(stateWord(n('draft_generation_error', body))).toBe('Failed')
  })

  it('send_failed_alert', () => {
    const body = 'Send FAILED (verified not delivered) to Sarah Francis. Row reset + blocked. Reason: hard error: Request failed with status code 422'
    expect(stateWord(n('send_failed_alert', body))).toBe('Send failed')
  })

  it('chat is never rendered as a family card, but resolves to a safe word if asked', () => {
    expect(stateWord(n('chat', 'Found it — that is likely...'))).toBe('Message')
  })

  it('every family in the doc produces a word that is never a raw enum token', () => {
    for (const f of ALL_FAMILIES) {
      const word = stateWord(n(f, 'some body text OK → PARENT_CONNECTING NEEDS_REGENERATE', { severity: 'error' }))
      expect(looksRaw(word)).toBe(false)
    }
  })

  it('an unknown family falls back on severity rather than throwing', () => {
    // @ts-expect-error deliberately an unlisted key, to prove the fallback holds
    const word = stateWord(n('made_up_family', 'anything', { severity: 'urgent' as never }))
    expect(typeof word).toBe('string')
    expect(looksRaw(word)).toBe(false)
  })
})

describe('sanitizeBody', () => {
  it('strips the leading status emoji and the raw arrow-transition token', () => {
    const body = 'SEAT HEALTH\n🔴 Seat Mattan Danino Sales Navigator: OK → PARENT_CONNECTING'
    const out = sanitizeBody(body)
    expect(out).not.toMatch(/PARENT_CONNECTING/)
    expect(out).not.toMatch(/🔴/)
    expect(out).toMatch(/disconnected/)
  })
  it('never leaves a raw enum token standing anywhere in the line', () => {
    const body = 'Board note NEEDS_REGENERATE for two drafts, otherwise fine'
    expect(looksRaw(sanitizeBody(body))).toBe(false)
  })
  it('strips emoji that are not a leading status mark', () => {
    expect(sanitizeBody('⏰ Reminder: Take your TRT 💉')).not.toMatch(/[⏰💉]/u)
  })
  it('collapses newlines into a single readable line', () => {
    expect(sanitizeBody('line one\nline two')).toBe('line one line two')
  })
  it('never leaves an em dash on screen (the source corpus uses it as a clause break)', () => {
    const body = 'RISE Warm Engager HALTED — Apify MTD $120.57 >= cap $120'
    const out = sanitizeBody(body)
    expect(out).not.toMatch(/—/)
    expect(out).toBe('RISE Warm Engager HALTED. Apify MTD $120.57 >= cap $120')
  })
})

describe('groupStateWord', () => {
  it('puts the count first, on a counted noun that agrees with it', () => {
    expect(groupStateWord(6, 'reply_draft_pending')).toBe('6 drafts waiting')
    expect(groupStateWord(1, 'reply_draft_pending')).toBe('1 draft waiting')
    expect(groupStateWord(3, 'inbound_reply_notice')).toBe('3 replies')
    expect(groupStateWord(2, 'claude_turn')).toBe('2 answers')
  })
  it('never pastes a raw family key or a label with a stray article after the digit', () => {
    for (const f of ALL_FAMILIES) {
      const out = groupStateWord(4, f)
      expect(out.startsWith('4 ')).toBe(true)
      expect(out).not.toMatch(/_/)
      expect(out).not.toMatch(/\b(?:a|an|on you)\b/)
    }
  })
  it('falls back for a family nobody has named yet', () => {
    expect(groupStateWord(2, 'some_new_family')).toBe('2 updates')
  })
})

describe('claude_turn — the family the live feed is mostly made of', () => {
  it('has a human label and no lane button', () => {
    expect(familyLabel('claude_turn')).toBe('Claude answered')
  })

  it('stripMarkdown keeps the words and drops the authoring marks', () => {
    expect(stripMarkdown('**File:** `project/ops-board-task-system.md`'))
      .toBe('File: project/ops-board-task-system.md')
    expect(stripMarkdown('### What is waiting')).toBe('What is waiting')
    expect(stripMarkdown('- three drafts are waiting on you')).toBe('three drafts are waiting on you')
    expect(stripMarkdown('1. three drafts are waiting')).toBe('three drafts are waiting')
    expect(stripMarkdown('> quoted line')).toBe('quoted line')
    expect(stripMarkdown('see [the ledger](https://example.com/x) for it'))
      .toBe('see the ledger for it')
    expect(stripMarkdown('*emphasis* holds')).toBe('emphasis holds')
    expect(stripMarkdown('```')).toBe('')
  })

  it('answerHeadline takes the first line that is actually words', () => {
    expect(answerHeadline('```\n# Nothing waiting\nsecond line')).toBe('Nothing waiting')
    expect(answerHeadline('**Three drafts** are waiting on you.\nmore'))
      .toBe('Three drafts are waiting on you.')
    expect(answerHeadline('')).toBe(null)
    expect(answerHeadline(null)).toBe(null)
    expect(answerHeadline('```\n```')).toBe(null)
  })

  it('falls back to a state word when the answer never arrived', () => {
    expect(stateWord(n('claude_turn', '', { severity: 'info' }))).toBe('Answered')
    expect(stateWord(n('claude_turn', '', { severity: 'error' }))).toBe('The turn failed')
  })
})

describe('severityShape', () => {
  it('maps the three severities to the three drawn shapes', () => {
    expect(severityShape('error')).toBe('bar')
    expect(severityShape('attention')).toBe('square')
    expect(severityShape('info')).toBe('dot')
  })
})
