import { describe, it, expect } from 'vitest'
import { buildLanes, laneStatus, sendKind, type SendRow, type DailyRow } from './sends'

const row = (over: Partial<SendRow>): SendRow => ({
  client_id: 'ivan', message_type: 'dm', channel: 'linkedin',
  sent_total: 0, sent_24h: 0, sent_7d: 0, sent_30d: 0, blocked: 0, last_sent: null,
  ...over,
})

describe('buildLanes rollup', () => {
  it('sums two channel rows for the same lane and takes max(last_sent)', () => {
    const rows: SendRow[] = [
      row({ message_type: 'dm', channel: 'linkedin', sent_24h: 6, sent_7d: 30, sent_total: 100, blocked: 5, last_sent: '2026-07-22T08:00:00Z' }),
      row({ message_type: 'dm', channel: 'linkedin_inmail', sent_24h: 4, sent_7d: 14, sent_total: 40, blocked: 2, last_sent: '2026-07-22T10:00:00Z' }),
    ]
    const lanes = buildLanes(rows, [], 'ivan')
    const dm = lanes.find(l => l.key === 'dm')!
    expect(dm.sent_24h).toBe(10)
    expect(dm.sent_7d).toBe(44)
    expect(dm.sent_total).toBe(140)
    expect(dm.blocked).toBe(7)
    expect(dm.last_sent).toBe('2026-07-22T10:00:00Z')
  })

  it('client=all sums both clients per lane', () => {
    const rows: SendRow[] = [
      row({ client_id: 'ivan', message_type: 'connection_note', sent_24h: 7, sent_7d: 69 }),
      row({ client_id: 'risedtc', message_type: 'connection_note', sent_24h: 29, sent_7d: 29 }),
    ]
    const all = buildLanes(rows, [], 'all').find(l => l.key === 'connection_note')!
    expect(all.sent_24h).toBe(36)
    expect(all.sent_7d).toBe(98)

    const ivan = buildLanes(rows, [], 'ivan').find(l => l.key === 'connection_note')!
    expect(ivan.sent_24h).toBe(7)
  })

  it('always returns four lanes in canonical order with labels', () => {
    const lanes = buildLanes([], [], 'all')
    expect(lanes.map(l => l.key)).toEqual(['connection_note', 'dm', 'inmail', 'email'])
    expect(lanes.map(l => l.label)).toEqual(['Connections', 'DMs', 'InMails', 'Emails'])
  })

  it('shares a 14-day x-axis and fills missing days with 0', () => {
    const daily: DailyRow[] = [
      { client_id: 'ivan', message_type: 'dm', day: '2026-07-20', sent: 3 },
      { client_id: 'ivan', message_type: 'dm', day: '2026-07-22', sent: 5 },
      { client_id: 'risedtc', message_type: 'dm', day: '2026-07-21', sent: 2 },
    ]
    const dm = buildLanes([], daily, 'ivan').find(l => l.key === 'dm')!
    // axis = 2026-07-20, 21, 22 (distinct across whole result); ivan dm has 0 on the 21st
    expect(dm.daily).toEqual([3, 0, 5])
  })
})

describe('laneStatus thresholds', () => {
  const now = '2026-07-22T12:00:00Z'
  it('live within 48h (47h)', () => {
    const t = new Date(new Date(now).getTime() - 47 * 3_600_000).toISOString()
    expect(laneStatus(t, now)).toBe('live')
  })
  it('slowing within 7d (5d)', () => {
    const t = new Date(new Date(now).getTime() - 5 * 24 * 3_600_000).toISOString()
    expect(laneStatus(t, now)).toBe('slowing')
  })
  it('stale older than 7d (96d)', () => {
    const t = new Date(new Date(now).getTime() - 96 * 24 * 3_600_000).toISOString()
    expect(laneStatus(t, now)).toBe('stale')
  })
  it('stale when null', () => {
    expect(laneStatus(null, now)).toBe('stale')
  })
})

describe('buildSendLog', () => {
  const lr = (over: Record<string, unknown>) => ({
    id: 'x', prospect_id: 'p1', prospect_name: 'A', client_id: 'ivan',
    message_type: 'dm', message_text: 'hey',
    sent_at: null, send_blocked_at: null, send_blocked_reason: null,
    ...over,
  })
  it('merges sent + failed chronologically desc, collapsing phantom dupes', async () => {
    const { buildSendLog } = await import('./sends')
    const sent = [
      lr({ id: 's1', sent_at: '2026-07-22T10:00:00Z' }),
      lr({ id: 's1dup', sent_at: '2026-07-22T10:00:00Z' }), // phantom copy
      lr({ id: 's2', sent_at: '2026-07-22T08:00:00Z', message_text: 'older' }),
    ]
    const failed = [
      lr({ id: 'f1', send_blocked_at: '2026-07-22T09:00:00Z', send_blocked_reason: 'chat create failed: 422' }),
      lr({ id: 'f2', send_blocked_at: '2026-07-22T09:30:00Z', send_blocked_reason: 'discarded_in_inbox' }), // Ivan's discard, excluded
    ]
    const log = buildSendLog(sent as never, failed as never)
    expect(log.map(i => i.id)).toEqual(['s1', 'f1', 's2'])
    expect(log[1].kind).toBe('failed')
    expect(log[1].reason).toContain('422')
  })

  // Open-profile sends are message_type='dm' on channel='linkedin_inmail', so ai_model is the
  // only field that separates a free open-profile message from a normal DM or a paid InMail.
  // If it stops being carried through, the log silently mislabels the whole lane again.
  it('carries ai_model through so open-profile sends stay distinguishable', async () => {
    const { buildSendLog } = await import('./sends')
    const sent = [
      lr({ id: 'op', sent_at: '2026-07-27T20:00:47Z', ai_model: 'template/rise_openprofile_v1' }),
      lr({ id: 'im', sent_at: '2026-07-27T19:00:00Z', message_type: 'inmail', ai_model: 'template/rise_inmail_client_v1' }),
      lr({ id: 'plain', sent_at: '2026-07-27T18:00:00Z', ai_model: null }),
    ]
    const log = buildSendLog(sent as never, [] as never)
    expect(log.find(i => i.id === 'op')!.ai_model).toBe('template/rise_openprofile_v1')
    expect(log.find(i => i.id === 'im')!.ai_model).toBe('template/rise_inmail_client_v1')
    expect(log.find(i => i.id === 'plain')!.ai_model).toBeNull()
  })

  // 2026-07-28: the writer (Send Connection / Pick + Invite) was fixed to log a note-less
  // invite instead of silently dropping the outreach_messages row. A note-less row survives
  // buildSendLog's shaping like any other sent row (sent_at present, not a phantom dupe) —
  // the bug this regression test guards is a DIFFERENT one: the log rendering used to give
  // every message_type='connection_note' row the same 'CONN' chip regardless of whether it
  // carried a real note, so a note-less send was in the feed but visually identical to a
  // noted one. See the sendKind tests below for the fix.
  it('a note-less connection invite survives the query shaping and keeps its placeholder text', async () => {
    const { buildSendLog } = await import('./sends')
    const sent = [
      lr({
        id: 'blank1', sent_at: '2026-07-27T05:11:36.382Z', message_type: 'connection_note',
        message_text: '(blank invite - no note by design)', ai_model: 'phase3_backfill_2026-07-28',
      }),
      lr({
        id: 'bare1', sent_at: '2026-07-27T06:00:00Z', message_type: 'connection_note',
        message_text: '(connection sent without note)', ai_model: 'inmail_followup_connect_v1',
      }),
    ]
    const log = buildSendLog(sent as never, [] as never)
    expect(log.map(i => i.id)).toEqual(['bare1', 'blank1'])
    expect(log.find(i => i.id === 'blank1')!.message_text).toBe('(blank invite - no note by design)')
    expect(log.find(i => i.id === 'bare1')!.message_text).toBe('(connection sent without note)')
  })
})

describe('sendKind', () => {
  it('keeps a real note-bearing connection as connection_note', () => {
    expect(sendKind({ message_type: 'connection_note', ai_model: null, message_text: 'Hey Rayson, loved your post on...' }))
      .toBe('connection_note')
  })

  it('splits out the deliberate blank-arm invite so it never renders identically to a noted one', () => {
    expect(sendKind({ message_type: 'connection_note', ai_model: 'phase3_backfill_2026-07-28', message_text: '(blank invite - no note by design)' }))
      .toBe('connection_note_blank')
  })

  it('splits out the degraded/quota bare-fallback invite, distinct from the deliberate blank arm', () => {
    expect(sendKind({ message_type: 'connection_note', ai_model: 'inmail_followup_connect_v1', message_text: '(connection sent without note)' }))
      .toBe('connection_note_bare')
  })

  it('still recognizes a variant "without note" fallback phrase (e.g. a manual-probe row)', () => {
    expect(sendKind({ message_type: 'connection_note', ai_model: null, message_text: '(connection sent without note - manual throttle probe 2026-07-25)' }))
      .toBe('connection_note_bare')
  })

  it('open-profile detection (message_type=dm) is unaffected by the connection-note text sniffing', () => {
    expect(sendKind({ message_type: 'dm', ai_model: 'template/rise_openprofile_v1', message_text: 'hey there' }))
      .toBe('open_profile')
  })
})
