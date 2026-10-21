// @vitest-environment jsdom
// Send-path re-audit 2 (2026-10-21): held labels tell the truth, deliberate stops never offer Send anyway,
// superseded is never a failure, and the Held list / counts only carry real holds.
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { History } from './History'
import { heldItems } from './model'
import { blockedFollowup } from './upcoming'
import { msg, threads, waiting } from './fixtures'
import { heldSend, isHeldSend, isNotAFailureReason, isStoppedOnPurposeReason, sendFailed, stopLabel, STOPPED_ON_PURPOSE_SQL } from '../../lib/inbox'
import { canEditHeldDm, canSendRejectedDm } from '../../lib/rejectedDm'
import { buildSendLog, FAILED_SEND_FILTER, LOGGED_BLOCK_FILTER } from '../../lib/sends'

afterEach(cleanup)

// The live reasons from the audit's 37 "Held, older than 30 days" rows and the B table.
const KILLS = [
  'ivan_disqualify_war_room_2026-07-17', 'revival_cancelled_too_old_ivan_2026-07-09', 'revival_lane_killed_ivan_2026-07-09',
  'vetting_2026-07-09: dead thread (explicit no / defer / already answered) - do not send', 'duplicate_already_delivered_war_room_2026-07-17',
  'ivan_rejected: 30-ideas signup, not a cold profile viewer', 'auto_reply_ooo', 'wrong_branch_manual_reply_not_counted_as_dm1_2026-09-22',
  'phishing_link_confirmed_2026-07-31', 'cross_tenant_leak_ivan_draft_on_client_prospect_2026-07-30', 'drafter_echoed_linkedin_notice_2026-07-29',
  'stale_draft_voided_2026-07-16', 'superseded: Ivan sent the scan link manually in-thread 2026-07-17 (with calendly); do not send this draft',
]
const stopRow = (reason: string, extra: object = {}) => msg({ prospect_id: 'k', message_text: 'Hey Barry, been a while', created_at: '2026-07-10T09:00:00Z', send_blocked_at: '2026-07-17T09:00:00Z', send_blocked_reason: reason, ...extra })

describe('stopped on purpose', () => {
  it('matches public.send_rejected_inbox_draft character for character', () => {
    expect(STOPPED_ON_PURPOSE_SQL).toBe('^(ivan_disqualify|ivan_rejected|revival_cancelled|revival_lane_killed|vetting_|duplicate_already_delivered|superseded_war_room|stale_convo_closed|stale_draft_voided|phishing_link|cross_tenant_leak|drafter_echoed|model_meta_no_reply|wrong_branch|replied_stop|auto_reply_ooo)')
    expect(isStoppedOnPurposeReason('anything; DO NOT SEND')).toBe(true)
  })
  it('is never Held, never a failure, never Send anyway, and says Stopped in plain words', () => {
    for (const r of KILLS) {
      const m = stopRow(r)
      expect(isStoppedOnPurposeReason(r) || r.startsWith('superseded'), r).toBe(true)
      expect(isHeldSend(m), r).toBe(false)
      expect(sendFailed(m), r).toBe(false)
      expect(canSendRejectedDm(m), r).toBe(false)
      expect(canEditHeldDm(m), r).toBe(false)
      expect(isNotAFailureReason(r), r).toBe(true)
      expect(stopLabel(m), r).toMatch(/^(Stopped|Not sent): [a-z]/)
      expect(stopLabel(m), r).not.toContain('_')
    }
    expect(stopLabel(stopRow('ivan_disqualify_war_room_2026-07-17'))).toBe('Stopped: you disqualified this person')
    expect(stopLabel(stopRow('auto_reply_ooo'))).toBe('Stopped: their message was an out-of-office auto-reply')
    // Approved rows too (the DB refuses them whatever the approval says).
    expect(canSendRejectedDm(stopRow('ivan_rejected: x', { approved_at: '2026-07-17T08:00:00Z' }))).toBe(false)
  })
  it('drops out of "Held, older than 30 days"', () => {
    const ts = threads(KILLS.map((r, i) => stopRow(r, { prospect_id: `k${i}` })))
    expect(heldItems(ts, new Set(), Date.parse('2026-10-21T21:00:00Z'))).toEqual({ recent: [], older: [] })
  })
  it('shows a quiet Stopped line with Discard only', () => {
    const m = stopRow('ivan_disqualify_war_room_2026-07-17')
    const [t] = threads([m])
    const { container } = render(<History t={t} onSendAnyways={() => {}} onDiscardHeld={() => {}} onEditHeld={async () => true} />)
    const bubble = container.querySelector(`[data-msg="${m.id}"]`)!
    expect(bubble.textContent).toContain('Stopped: you disqualified this person')
    expect(bubble.hasAttribute('data-held')).toBe(false)
    expect(bubble.classList.contains('dm-h-fail')).toBe(false)
    expect([...bubble.querySelectorAll('button[data-verb]')].map(b => b.getAttribute('data-verb'))).toEqual(['discard-held'])
  })
  it('a review hold whose release IS Send anyway keeps the key, with words', () => {
    const m = stopRow('wins_operator_review_required')
    expect(isHeldSend(m)).toBe(true)
    expect(canSendRejectedDm(m)).toBe(true)
    const [t] = threads([m])
    const { container } = render(<History t={t} onSendAnyways={() => {}} onDiscardHeld={() => {}} />)
    const bubble = container.querySelector(`[data-msg="${m.id}"]`)!
    expect(bubble.textContent).toContain('Needs your review before it sends.')
    expect(bubble.textContent).not.toContain('wins_operator_review_required')
    expect(bubble.querySelector('button[data-verb="send-anyways"]')).not.toBeNull()
  })
})

describe('not connected', () => {
  it('no Send anyway (the same 422 comes back); Discard stays', () => {
    const m = msg({ prospect_id: 'nc', message_text: 'Hey there', send_blocked_at: '2026-10-21T10:00:00Z', send_blocked_reason: 'send_failed_verified: chat create failed: Request failed with status code 422 [errors/no_connection_with_recipient]' })
    expect(canSendRejectedDm(m)).toBe(false)
    expect(canSendRejectedDm({ ...m, send_blocked_reason: 'no_connection_with_recipient' })).toBe(false)
    const [t] = threads([m])
    const { container } = render(<History t={t} onSendAnyways={() => {}} onDiscardHeld={() => {}} />)
    const bubble = container.querySelector(`[data-msg="${m.id}"]`)!
    expect(bubble.textContent).toContain('Not connected on LinkedIn: send an invite first.')
    expect(bubble.querySelector('button[data-verb="send-anyways"]')).toBeNull()
    expect(bubble.querySelector('button[data-verb="discard-held"]')).not.toBeNull()
  })
})

describe('superseded (Krishna Solanki 6c22c6f3)', () => {
  it('an approved InMail rerouted to an invite is a quiet line, not a red Send failed', () => {
    const m = msg({ prospect_id: 'ks', message_type: 'inmail', approved_at: '2026-10-07T23:20:53Z', send_blocked_at: '2026-10-20T18:56:11Z',
      send_blocked_reason: 'superseded: not an open profile on Sales Navigator, rerouted to invite (invite sent)' })
    expect(sendFailed(m)).toBe(false)
    expect(canSendRejectedDm(m)).toBe(false)
    const [t] = threads([m])
    const { container } = render(<History t={t} onSendAnyways={() => {}} onDiscardHeld={() => {}} />)
    const bubble = container.querySelector(`[data-msg="${m.id}"]`)!
    expect(bubble.textContent).toContain('Not sent: sent an invite instead')
    expect(bubble.textContent).not.toMatch(/Send failed/)
    expect(bubble.querySelector('button[data-verb]')).toBeNull()
  })
})

describe('held "sent since" (Alicia Yingru WANG, Aurimas Gackas, Nicole Sumner)', () => {
  // Alicia: written 10-11 23:07, three sends 10-11/12, Ivan approved 10-15 08:07, held 08:08 (dm_dispatch:claim_changed).
  const alicia = () => [
    msg({ prospect_id: 'aw', message_type: 'email', created_at: '2026-10-11T22:50:00Z', approved_at: '2026-10-11T23:39:35Z', sent_at: '2026-10-11T23:40:45Z', message_text: 'email' }),
    msg({ prospect_id: 'aw', message_type: 'connection_note', created_at: '2026-10-11T22:50:00Z', approved_at: '2026-10-11T23:39:34Z', sent_at: '2026-10-11T23:42:40Z', message_text: 'note' }),
    msg({ prospect_id: 'aw', message_type: 'inmail', created_at: '2026-10-11T22:50:00Z', approved_at: '2026-10-12T07:38:52Z', sent_at: '2026-10-12T07:38:53Z', message_text: 'first inmail' }),
    msg({ id: '06aaab91', prospect_id: 'aw', message_type: 'inmail', created_at: '2026-10-11T23:07:52Z', approved_at: '2026-10-15T08:07:21Z', send_blocked_at: '2026-10-15T08:08:40Z',
      send_blocked_reason: 'dm_dispatch:claim_changed', message_text: 'Second InMail, Alicia' }),
  ]
  it('a hold Ivan approved after every send shows in Held', () => {
    const [t] = threads(alicia())
    expect(heldSend(t)?.id).toBe('06aaab91')
    expect(heldItems([t], new Set(), Date.parse('2026-10-21T21:00:00Z')).recent.map(i => i.m.id)).toEqual(['06aaab91'])
  })
  it('a send after the hold still hides it', () => {
    const [t] = threads([...alicia(), msg({ prospect_id: 'aw', sent_at: '2026-10-16T09:00:00Z', message_text: 'later dm' })])
    expect(heldSend(t)).toBeNull()
  })
  it('the same words delivered by hand (a manual_mirror seconds after the reservation) hide the hold', () => {
    const text = 'Hey Aurimas,  quick one on the\nscan you asked about'
    const rows = [
      msg({ prospect_id: 'ag', created_at: '2026-10-18T14:34:00Z', approved_at: '2026-10-19T08:59:00Z', send_blocked_at: '2026-10-19T09:00:00Z',
        send_blocked_reason: 'provider_success_unconfirmed: first bubble absent from current native reads; reservation retained', message_text: text }),
      msg({ prospect_id: 'ag', ai_model: 'manual_mirror', created_at: '2026-10-19T09:01:00Z', sent_at: '2026-10-19T08:59:20Z', message_text: 'hey aurimas, quick one on the scan you asked about' }),
    ]
    expect(heldSend(threads(rows)[0])).toBeNull()
    // Different words, sent before Ivan approved this one: still a hold nobody acted on.
    rows[1] = { ...rows[1], message_text: 'something else', sent_at: '2026-10-18T20:00:00Z' }
    expect(heldSend(threads(rows)[0])?.id).toBe(rows[0].id)
  })
})

describe('counts and Blocked follow-ups', () => {
  it('the Lanes / send log filters drop superseded, expired, invite-instead, replied and stopped rows', () => {
    for (const f of [FAILED_SEND_FILTER, LOGGED_BLOCK_FILTER]) {
      expect(f).toContain('send_blocked_reason.not.match."^(discarded|superseded|')
      expect(f).toContain('send_blocked_reason.not.imatch."do not send"')
    }
    const lr = (id: string, reason: string) => ({ id, prospect_id: id, prospect_name: id, client_id: 'ivan', message_type: 'dm', ai_model: null, message_text: 'x', sent_at: null, send_blocked_at: '2026-10-21T10:00:00Z', send_blocked_reason: reason })
    const log = buildSendLog([], [lr('sup', 'superseded: rerouted to invite'), lr('exp', 'stale_draft_expired_10d'), lr('war', 'superseded_war_room_2026-07-17'),
      lr('kill', 'ivan_disqualify_war_room_2026-07-17'), lr('rep', 'replied_stop'), lr('inv', 'routed_to_invite: x'), lr('real', 'send_failed_verified: hard error: Request failed with status code 404')] as never)
    expect(log.map(i => i.id)).toEqual(['real'])
    for (const r of ['send_failed_verified: x', 'inmail_failed_422: limit', 'dispatch_error: x', 'wins_operator_review_required']) expect(isNotAFailureReason(r), r).toBe(false)
  })
  it('a blocked follow-up speaks plain words and ignores stops', () => {
    const bump = (reason: string, extra: object = {}) => {
      const rows = waiting('b', { client_id: 'ivan' })
      rows.push(msg({ prospect_id: 'b', ai_model: 'ivan_stall_bump_ctx_v1', created_at: '2026-09-29T09:00:00Z', send_blocked_at: '2026-09-29T09:01:00Z', send_blocked_reason: reason, ...extra }))
      return blockedFollowup(threads(rows)[0])
    }
    expect(bump('send_failed_verified: chat create failed: Request failed with status code 422 [errors/no_connection_with_recipient]')?.reason).toBe('Not connected on LinkedIn: send an invite first')
    for (const r of ['superseded: rerouted to invite', 'stale_draft_expired_3d', 'ivan_disqualify_war_room_2026-07-17', 'replied_stop', 'routed_to_invite: x'])
      expect(bump(r, { approved_at: '2026-09-29T08:00:00Z' }), r).toBeNull()
  })
})
