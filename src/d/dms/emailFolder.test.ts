import { describe, expect, it } from 'vitest'
import { emailWaiting, splitEmail } from './emailFolder'
import { NOW, iso, msg, threads, waiting } from './fixtures'
import { seatView } from './model'

const H = 3_600_000, D = 24 * H
const email = { channel: 'email' as const, message_type: 'email' }

describe('Email folder: only what waits on him', () => {
  const rows = [
    // an old campaign email reply on an archived person (the 24 of Ivan's 26)
    msg({ prospect_id: 'old', prospect_name: 'Old Reply', direction: 'outbound', sent_at: iso(80 * D), created_at: iso(80 * D), ...email }),
    msg({ prospect_id: 'old', prospect_name: 'Old Reply', direction: 'inbound', created_at: iso(70 * D), message_text: 'Can you tell me more?', prospect_stage: 'archived', ...email }),
    // our own email send on a LinkedIn conversation, no email reply
    ...waiting('sent', { prospect_name: 'Our Send' }),
    msg({ prospect_id: 'sent', prospect_name: 'Our Send', direction: 'outbound', sent_at: iso(2 * H), created_at: iso(2 * H), ...email }),
    // a fresh email reply nobody answered
    msg({ prospect_id: 'fresh', prospect_name: 'Fresh', direction: 'outbound', sent_at: iso(3 * D), created_at: iso(3 * D), ...email }),
    msg({ prospect_id: 'fresh', prospect_name: 'Fresh', direction: 'inbound', created_at: iso(5 * H), message_text: 'Yes, send the pricing please?', ...email }),
    // a fresh email reply we already answered
    msg({ prospect_id: 'done', prospect_name: 'Answered', direction: 'inbound', created_at: iso(9 * H), message_text: 'What does it cost?', ...email }),
    msg({ prospect_id: 'done', prospect_name: 'Answered', direction: 'outbound', sent_at: iso(4 * H), created_at: iso(4 * H), ...email }),
    // a pending email draft
    msg({ prospect_id: 'leg', prospect_name: 'Email Draft', direction: 'inbound', created_at: iso(30 * H), message_text: 'How would this work for us?' }),
    msg({ prospect_id: 'leg', prospect_name: 'Email Draft', direction: 'outbound', created_at: iso(20 * H), message_text: 'Here is how', ...email }),
  ]
  const ts = threads(rows)
  const by = (pid: string) => ts.find(t => t.prospect_id === pid)!

  it('an old archived email reply and our own sends are not waiting', () => {
    expect(emailWaiting(by('old'), NOW)).toBe(false)
    expect(emailWaiting(by('sent'), NOW)).toBe(false)
    expect(emailWaiting(by('done'), NOW)).toBe(false)
  })

  it('a fresh unanswered email reply and a pending email leg are waiting', () => {
    expect(emailWaiting(by('fresh'), NOW)).toBe(true)
    expect(emailWaiting(by('leg'), NOW)).toBe(true)
  })

  it('a solved email reply stops waiting', () => {
    const t = { ...by('fresh'), solvedAt: iso(1 * H) }
    expect(emailWaiting(t, NOW)).toBe(false)
  })

  it('the seat view splits the folder: tab counts waiting only, the rest goes under All email', () => {
    const v = seatView(ts, 'ivan', NOW)
    expect(v.email.length).toBe(5)
    expect(v.emailWaiting.map(t => t.prospect_name).sort()).toEqual(['Email Draft', 'Fresh'])
    expect(v.emailRest.map(t => t.prospect_name).sort()).toEqual(['Answered', 'Old Reply', 'Our Send'])
    expect(splitEmail(v.email, NOW).waiting.length).toBe(2)
  })
})
