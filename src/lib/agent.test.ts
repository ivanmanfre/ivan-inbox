import { describe, it, expect } from 'vitest'
import {
  ALERT_TABLE, ALERT_FIELD, ALERT_WINDOW_DAYS, REMINDER_TABLE, REMINDER_FIELD,
  alertWindowCutoff, chatDayKey, needsDaySeparator, startsTurn, unsentAlerts, latestAssistantId,
  type AgentAlert, type AgentMessage,
} from './agent'

const msg = (o: Partial<AgentMessage>): AgentMessage => ({
  id: 1, role: 'user', content: 'hi', created_at: '2026-07-30T10:00:00Z', ...o,
})
const alert = (o: Partial<AgentAlert>): AgentAlert => ({
  id: 'a', alert_type: 'pipeline_stall', title: 't', body: null,
  sent: false, sent_at: null, created_at: '2026-07-30T10:00:00Z', ...o,
})

describe('dashboard_action field allowlist', () => {
  // dashboard_action is one generic SECURITY DEFINER field-setter shared by the
  // whole system, and its server-side allowlist includes
  // outreach_campaigns.is_active and outreach_prospects.stage — i.e. it can ARM
  // OUTREACH (client_autofix.sql:37-38). If the inbox ever took table/field as
  // arguments, one careless caller could reach those from a phone. These two
  // pairs are the entire surface the inbox is allowed to write through, the
  // dispatcher is module-private, and widening it has to be an edit to
  // agent.ts. This test is the tripwire on that decision.
  it('pins the alert ack to n8nclaw_proactive_alerts.sent', () => {
    expect(ALERT_TABLE).toBe('n8nclaw_proactive_alerts')
    expect(ALERT_FIELD).toBe('sent')
  })
  it('pins the reminder ack to n8nclaw_reminders.status', () => {
    expect(REMINDER_TABLE).toBe('n8nclaw_reminders')
    expect(REMINDER_FIELD).toBe('status')
  })
  it('never names an outreach table or an arming field', () => {
    const surface = [ALERT_TABLE, ALERT_FIELD, REMINDER_TABLE, REMINDER_FIELD]
    expect(surface.some(s => s.startsWith('outreach_'))).toBe(false)
    expect(surface).not.toContain('is_active')
    expect(surface).not.toContain('stage')
  })
})

describe('day separators', () => {
  // Chat is fetched newest-first and reversed for render, so the separator has
  // to be computed against the PREVIOUS rendered row, not the previous fetched
  // one. Getting that backwards puts the date label under the wrong message.
  it('always separates the first message', () => {
    expect(needsDaySeparator('2026-07-30T10:00:00Z', null)).toBe(true)
  })
  it('separates across a day boundary and not within one', () => {
    const a = '2026-07-30T13:00:00Z'
    const b = '2026-07-30T18:00:00Z'
    const c = '2026-07-31T13:00:00Z'
    expect(needsDaySeparator(b, a)).toBe(false)
    expect(needsDaySeparator(c, b)).toBe(true)
  })
  it('returns a stable empty key for an unparseable timestamp instead of throwing', () => {
    expect(chatDayKey('not-a-date')).toBe('')
    expect(needsDaySeparator('not-a-date', 'also-not-a-date')).toBe(false)
  })
})

describe('startsTurn', () => {
  it('marks the first message of each speaker run', () => {
    const msgs = [
      msg({ id: 1, role: 'user' }),
      msg({ id: 2, role: 'user' }),
      msg({ id: 3, role: 'assistant' }),
      msg({ id: 4, role: 'user' }),
    ]
    expect(msgs.map((_, i) => startsTurn(msgs, i))).toEqual([true, false, true, true])
  })
})

describe('unsentAlerts', () => {
  // The panel opens itself when anything is unacknowledged. `sent` arrives as a
  // real boolean today, but a null from a partially-written row must count as
  // unsent — an alert that quietly reads as acknowledged is an alert nobody
  // ever sees.
  it('treats false and null alike as unacknowledged', () => {
    const rows = [
      alert({ id: 'x', sent: false }),
      alert({ id: 'y', sent: true }),
      alert({ id: 'z', sent: null as unknown as boolean }),
    ]
    expect(unsentAlerts(rows).map(a => a.id)).toEqual(['x', 'z'])
  })
})

describe('alertWindowCutoff', () => {
  // The first tournament render opened on two 60+day-old unsent pipeline_stall
  // alerts, at the top, styled exactly like today's. Nothing had acked them
  // because nobody was ever going to act on them. Stale unsent ≠ actionable
  // today, so the fetch windows to 14 days and the rest collapse to a count.
  it('is a fixed 14-day window measured back from now', () => {
    expect(ALERT_WINDOW_DAYS).toBe(14)
    const now = Date.parse('2026-07-31T12:00:00.000Z')
    expect(alertWindowCutoff(now)).toBe('2026-07-17T12:00:00.000Z')
  })

  it('puts a 60-day-old alert outside the window and a 2-day-old one inside', () => {
    const now = Date.parse('2026-07-31T12:00:00.000Z')
    const cutoff = alertWindowCutoff(now)
    const stale = alert({ created_at: '2026-05-30T09:00:00.000Z' })
    const fresh = alert({ created_at: '2026-07-29T09:00:00.000Z' })
    expect(stale.created_at < cutoff).toBe(true)
    expect(fresh.created_at >= cutoff).toBe(true)
  })

  it('emits a Z instant, never a +00:00 offset', () => {
    // A literal '+' in a PostgREST timestamp filter is decoded as a space and
    // the comparison silently stops matching.
    expect(alertWindowCutoff(Date.now())).toMatch(/Z$/)
    expect(alertWindowCutoff(Date.now())).not.toContain('+')
  })

  it('accepts a Date as readily as an epoch', () => {
    const d = new Date('2026-07-31T12:00:00.000Z')
    expect(alertWindowCutoff(d)).toBe(alertWindowCutoff(d.getTime()))
  })
})

describe('latestAssistantId', () => {
  // "Sending" clears when a NEWER assistant message arrives. Reading the last
  // row instead of the last assistant row would clear the spinner off Ivan's
  // own echoed message and make an unanswered send look answered.
  it('ignores user messages and picks the highest assistant id', () => {
    const msgs = [
      msg({ id: 10, role: 'assistant' }),
      msg({ id: 11, role: 'user' }),
      msg({ id: 12, role: 'assistant' }),
      msg({ id: 13, role: 'user' }),
    ]
    expect(latestAssistantId(msgs)).toBe(12)
  })
  it('returns null when the agent has never answered', () => {
    expect(latestAssistantId([msg({ id: 1, role: 'user' })])).toBeNull()
    expect(latestAssistantId([])).toBeNull()
  })
})
