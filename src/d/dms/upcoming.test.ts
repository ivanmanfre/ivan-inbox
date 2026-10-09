import { describe, expect, it } from 'vitest'
import { blockedFollowup, projectFollowups, upcomingItems, type FollowupSource } from './upcoming'
import { msg, threads, waiting } from './fixtures'
const now = Date.parse('2026-09-30T12:00:00Z')
const source = (seat = 'arch'): FollowupSource => ({ seat, prospect: { id: 'p', icp_score: 8, stage: 'replied', enrichment_data: {} }, rows: [
  { id: 'i', direction: 'inbound', message_type: 'dm', message_text: 'Yes, send the scan', sent_at: '2026-09-29T10:00:00Z', channel: 'linkedin' },
  { id: 'o', direction: 'outbound', message_type: 'dm', message_text: 'Here is the scan', sent_at: '2026-09-29T11:00:00Z', channel: 'linkedin' },
] })
describe('upcoming follow-ups', () => {
  it('projects a quiet replied conversation before drafting; never adds an actionable draft', () => {
    const [p] = projectFollowups([source()], now)
    // Gap ends 13:00 Warsaw on 1 Oct; the morning batch makes it due at 05:00 Warsaw that day.
    expect(p.at).toBe('2026-10-01T03:00:00.000Z')
    expect(p.state).toBe('scheduled')
    expect(p.basis).toBe('estimate')
  })
  it('morning batch: due at 05:00 Warsaw of the due day, never later than the gap; the switch restores the gap time', () => {
    expect(projectFollowups([source()], now, false)[0].at).toBe('2026-10-01T11:00:00.000Z')
    const late = source(); late.rows[1].sent_at = '2026-09-29T21:59:00Z' // gap ends 23:59 Warsaw 1 Oct
    expect(projectFollowups([late], now)[0].at).toBe('2026-10-01T03:00:00.000Z')
    const night = source(); night.rows[1].sent_at = '2026-09-29T23:30:00Z' // gap ends 01:30 Warsaw 2 Oct, before 05:00
    expect(projectFollowups([night], now)[0].at).toBe('2026-10-01T23:30:00.000Z')
    const winter = source(); winter.rows[0].sent_at = '2026-11-01T09:00:00Z'; winter.rows[1].sent_at = '2026-11-01T15:00:00Z'
    expect(projectFollowups([winter], Date.parse('2026-11-02T12:00:00Z'))[0].at).toBe('2026-11-03T04:00:00.000Z')
  })
  it('filters bookings, declines, holds and pending messages', () => {
    const a = source(), b = source(), c = source(), d = source()
    a.prospect.call_booked_at = '2026-09-30T10:00:00Z'
    b.rows[0].message_text = 'No thanks, not interested'
    c.prospect.enrichment_data = { person_hold: true }
    d.rows.push({ id: 'pending', direction: 'outbound', message_type: 'manual_reply' })
    expect(projectFollowups([a,b,c,d], now)).toHaveLength(0)
  })
  it('applies Ivan’s five-day clock and the 72-hour horizon, including overdue candidates', () => {
    expect(projectFollowups([source('ivan')], now)).toHaveLength(0)
    const a = source('ivan'); a.rows[1].sent_at = '2026-09-25T11:00:00Z'; a.rows[0].sent_at = '2026-09-25T10:00:00Z'
    expect(projectFollowups([a], now)[0].state).toBe('due')
  })
  it('a closed judge review expires when either conversation turn changes', () => {
    const a = source(); a.prospect.enrichment_data = { followup_review: { latest_inbound_id:'i', latest_outbound_id:'o', verdict:{follow_up:false} } };
    expect(projectFollowups([a], now)).toHaveLength(0); a.rows[1].id='new-out';
    expect(projectFollowups([a], now)).toHaveLength(1)
  })
  it('an explicitly scheduled return uses its operator date', () => {
    const a = source(); a.prospect.skip_reason = 'follow_up_dated'; a.prospect.next_touch_after = '2026-10-02T09:00:00Z'
    expect(projectFollowups([a], now)[0].at).toBe('2026-10-02T09:00:00Z')
  })
  it('deduplicates the same person across projected and pushed dates', () => {
    const [t] = threads(waiting('p', { client_id: 'arch' }))
    const projected = projectFollowups([source()], now)
    expect(upcomingItems(projected, [{ t, at: '2026-10-02T09:00:00Z', kind: 'draft' }], new Map([['p',t]]), 'arch', now)).toHaveLength(1)
  })
})
describe('blocked follow-ups', () => {
  it('does not ask for review of deliberately discarded or retired historical drafts', () => {
    for (const reason of ['discarded_repeat_ask_bump','superseded_war_room_2026-07-17']) {
      const rows = waiting('b', { client_id:'ivan' });
      rows.push(msg({ prospect_id:'b', ai_model:'ivan_stall_bump_ctx_v1', created_at:'2026-09-29T09:00:00Z', send_blocked_at:'2026-09-29T09:01:00Z', send_blocked_reason:reason }));
      expect(blockedFollowup(threads(rows)[0])).toBeNull()
    }
  })
  it('keeps Nick’s July closed conversation out of the blocked review queue', () => {
    const rows = [
      msg({ prospect_id:'nick', prospect_name:'Nick Fouriezos', direction:'inbound', sent_at:'2026-07-09T00:04:09Z', created_at:'2026-07-09T00:17:10Z', message_text:"I'm not interested, but appreciate you sending it over" }),
      msg({ prospect_id:'nick', prospect_name:'Nick Fouriezos', sent_at:'2026-07-09T00:42:36Z', created_at:'2026-07-16T17:31:47Z', message_text:'No problem Nick, have a good one' }),
      msg({ prospect_id:'nick', prospect_name:'Nick Fouriezos', ai_model:'stall_bump_v1', created_at:'2026-07-12T04:00:48Z', send_blocked_at:'2026-07-16T17:40:27Z', send_blocked_reason:'stale_convo_closed_2026-07-16' }),
    ]
    expect(blockedFollowup(threads(rows)[0])).toBeNull()
  })
  it('surfaces ARCH ownership failures until a new message or draft supersedes them', () => {
    const rows = waiting('b', { client_id: 'arch' })
    rows.push(msg({ prospect_id: 'b', client_id: 'arch', ai_model: 'arch_stall_bump_ctx_v1', created_at: '2026-09-29T09:00:00Z', send_blocked_at: '2026-09-29T09:01:00Z', send_blocked_reason: 'arch_conversation_owner_only' }))
    const [t] = threads(rows)
    expect(blockedFollowup(t)?.reason).toMatch(/ownership/)
    t.messages.push(msg({ prospect_id: 'b', direction: 'inbound', sent_at: '2026-09-30T09:00:00Z', created_at: '2026-09-30T09:00:00Z' }))
    expect(blockedFollowup(t)).toBeNull()
  })
})
