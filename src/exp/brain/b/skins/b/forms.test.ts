import { describe, expect, it } from 'vitest'
import type { Notification } from '../../../../../lib/turns'
import { mockNotificationRows } from '../../mockNotifications'
import { dayWord, fileSize, formFor, pageCard, quoteCard, raised, tileCard, timeCard } from './forms'

const rows = mockNotificationRows()
const byFamily = (f: string): Notification => {
  const r = rows.find(x => x.family === f)
  if (!r) throw new Error(`no fixture row for ${f}`)
  return r
}

describe('formFor', () => {
  it('gives the three families that carry someone\'s words the quote form', () => {
    expect(formFor('reply_draft_pending')).toBe('quote')
    expect(formFor('inbound_reply_notice')).toBe('quote')
    expect(formFor('comment_engagement_notice')).toBe('quote')
  })
  it('gives every failure the strip', () => {
    for (const f of ['system_infra_alarm', 'send_failed_alert', 'draft_generation_error', 'post_generation_failed', 'scan_quality_alert']) {
      expect(formFor(f)).toBe('strip')
    }
  })
  it('gives a booking the time block and an answer the page', () => {
    expect(formFor('booking_notice')).toBe('time')
    expect(formFor('claude_turn')).toBe('page')
  })
  it('falls back to the tile rather than promising a shape the row cannot fill', () => {
    expect(formFor('a_family_that_does_not_exist_yet')).toBe('tile')
    expect(formFor('seat_health')).toBe('tile')
  })
})

describe('raised', () => {
  it('puts what needs him on the raised plate and information flat', () => {
    expect(raised('attention')).toBe(true)
    expect(raised('error')).toBe(true)
    expect(raised('info')).toBe(false)
  })
})

describe('quoteCard', () => {
  it('reads a drafted reply and the lead it was drafted for', () => {
    const { quote, subject } = quoteCard(byFamily('reply_draft_pending'))
    expect(subject).toBe('Alec Lorenzo')
    expect(quote).toContain('Want to get some time next week')
    // sanitizeBody breaks the corpus double dash into a sentence, so no dash
    // ever reaches the quote.
    expect(quote).not.toContain('--')
  })

  it('reads a quoted inbound reply and the person who sent it', () => {
    const row = rows.find(r => r.family === 'inbound_reply_notice' && r.count === 1)!
    const { quote, subject } = quoteCard(row)
    expect(quote).toBe('Yes')
    expect(subject).toBe('Alec Lorenzo')
  })

  it('reads a comment and its author', () => {
    const { quote, subject } = quoteCard(byFamily('comment_engagement_notice'))
    expect(quote).toBe('And then you, as the client...')
    expect(subject).toBe('Anna Romaniuk')
  })

  it('never returns the same string as both the quote and the person', () => {
    for (const r of rows) {
      const { quote, subject } = quoteCard(r)
      if (quote && subject) expect(subject).not.toBe(quote)
    }
  })

  it('returns null rather than inventing a quote for an empty body', () => {
    const { quote, subject } = quoteCard({ family: 'reply_draft_pending', title: null, body: null })
    expect(quote).toBeNull()
    expect(subject).toBeNull()
  })
})

describe('timeCard', () => {
  it('names the person a booking is attributed to', () => {
    expect(timeCard(byFamily('booking_notice')).who).toBe('Mace Peter')
  })
})

describe('dayWord', () => {
  const now = new Date('2026-09-04T12:00:00Z')
  it('says Today, Yesterday, or the weekday', () => {
    expect(dayWord(new Date('2026-09-04T09:00:00Z').toISOString(), now)).toBe('Today')
    expect(dayWord(new Date('2026-09-03T09:00:00Z').toISOString(), now)).toBe('Yesterday')
    expect(dayWord(new Date('2026-08-30T09:00:00Z').toISOString(), now)).toMatch(/^[A-Z][a-z]{2}$/)
  })
})

describe('tileCard', () => {
  it('uses the row\'s own subject as the label, never the family name twice', () => {
    const t = tileCard(byFamily('seat_health'))
    expect(t.label).toBe('Seat Mattan Danino')
    expect(t.state).toBe('Disconnected')
  })
  it('never lets a raw enum token reach the state', () => {
    for (const r of rows) {
      expect(tileCard(r).state).not.toMatch(/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/)
    }
  })
})

describe('pageCard', () => {
  it('carries the state word OUTSIDE the snippet, so a card with its body hidden still names its state', () => {
    const p = pageCard(byFamily('claude_turn'))
    expect(p.state).toBe('Answered')
    expect(p.snippet).toContain('Three reply drafts are waiting on you')
    expect(p.snippet).not.toContain('Answered')
    expect(p.asked).toBe('What is waiting on me right now?')
  })
  it('says the turn failed when it did', () => {
    const p = pageCard({ family: 'claude_turn', title: 'x', body: null, severity: 'error', count: 1 })
    expect(p.state).toBe('The turn failed')
  })
  it('reads a digest through the same form without a prompt line', () => {
    const p = pageCard(byFamily('reporting_digest'))
    expect(p.state).toBe('Ready')
    expect(p.asked).toBeNull()
  })
})

describe('fileSize', () => {
  it('reads as a size a person would say', () => {
    expect(fileSize(880)).toBe('880 B')
    expect(fileSize(421_888)).toBe('412 KB')
    expect(fileSize(1_258_291)).toBe('1.2 MB')
  })
})
