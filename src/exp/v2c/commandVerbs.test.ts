import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { groupThreads, type InboxMessage } from '../../lib/inbox'
import { e4Commands, peopleFromThreads, type VerbCtx } from './commandVerbs'

const SRC = readFileSync(join(process.cwd(), 'src/exp/v2c/commandVerbs.ts'), 'utf8')

const base: InboxMessage = {
  id: '1', prospect_id: 'p1', direction: 'inbound', message_text: 'hello',
  message_type: 'dm', channel: 'linkedin', sent_at: '2026-09-10T10:00:00Z',
  approved_at: null, read_at: null, created_at: '2026-09-10T10:00:00Z',
  send_blocked_at: null, send_blocked_reason: null, unipile_chat_id: null,
  ai_model: null, prospect_name: 'Kemal Atdayev', prospect_company: 'Northbeam',
  prospect_headline: null, prospect_stage: 'replied', prospect_email: null,
  profile_photo_url: null, campaign_name: 'c', client_id: 'risedtc',
  prospect_linkedin_url: 'https://www.linkedin.com/in/k', chat_provider_id: null,
  snoozed_until: null, snoozed_at: null,
}

const threads = (rows: Partial<InboxMessage>[]) =>
  groupThreads(rows.map(r => ({ ...base, ...r })), new Set(), Date.parse('2026-09-12T12:00:00Z'))

const ctx = (over: Partial<VerbCtx> = {}): VerbCtx => {
  const noop = () => {}
  return {
    people: [], openPerson: noop, openChat: noop, newChatThread: noop,
    threadOpen: false, snoozeOn: null, snooze: noop, ...over,
  }
}

// ---------------------------------------------------------------------------
// 🔴 THE PIN. E4's whole premise is that a palette is a fast way to REACH
// things, never a fast way to do the one thing that cannot be undone. Every
// handler in this file is walked, by its own source, and the ways a write could
// enter are named one by one. A screenshot cannot prove this; this can.
// ---------------------------------------------------------------------------
describe('the E4 verb registry cannot approve anything or put a message out', () => {
  // `run: () => c.openPerson(p.id)` — the whole callee expression, per verb.
  const handlers = [...SRC.matchAll(/run:\s*\(\)\s*=>\s*([^\n,]+)/g)].map(m => m[1].trim())

  it('finds one handler per verb and no verb without one', () => {
    expect(handlers.length).toBe(4)
  })

  it('no handler names approve or send', () => {
    for (const h of handlers) expect(h).not.toMatch(/approve|send/i)
  })

  it('every handler is one of the four openers this file declares', () => {
    // An allowlist, not a denylist: a fifth callee appearing here has to be
    // added deliberately, which is the moment to ask what it does.
    const allowed = ['c.openChat()', 'c.newChatThread()', 'c.snooze()', 'c.openPerson(p.id)']
    for (const h of handlers) expect(allowed).toContain(h)
  })

  it('the context this file is handed carries no write it could reach', () => {
    for (const k of Object.keys(ctx())) {
      expect(k).not.toMatch(/approve|send|promote|delete|discard/i)
    }
  })

  it('names no write helper anywhere in the file', () => {
    for (const banned of [
      'approveDraft', 'approved_at', 'sent_at', 'snoozeDraft', 'runBulk',
      'supabase', 'RowCap',
    ]) expect(SRC).not.toContain(banned)
  })

  it('adds no verb to the Act band, which is where the capability ledger lives', () => {
    const cmds = e4Commands(ctx({ people: peopleFromThreads(threads([{}])) }))
    expect(cmds.some(c => c.group === 'Act')).toBe(false)
    expect(new Set(cmds.map(c => c.group))).toEqual(new Set(['Go', 'Claude', 'Thread', 'People']))
  })

  it('no verb title or context offers to approve, or to put a message out', () => {
    for (const c of e4Commands(ctx({ people: peopleFromThreads(threads([{}])) }))) {
      expect(`${c.title} ${c.hint}`).not.toMatch(/\bapprove|\bsends?\b/i)
    }
  })
})

describe('the Thread verb refuses in words rather than disappearing', () => {
  it('is unavailable with no conversation open, and says which', () => {
    const later = e4Commands(ctx()).find(c => c.id === 'thread.later')!
    expect(later.ready).toBe(false)
    expect(later.reason).toBe('no conversation is open beside your work')
  })

  it('is unavailable on a conversation with nothing to push, and says which', () => {
    const later = e4Commands(ctx({ threadOpen: true })).find(c => c.id === 'thread.later')!
    expect(later.ready).toBe(false)
    expect(later.reason).toBe('this conversation has nothing waiting that could be pushed')
  })

  it('names the person once the conversation draws its own Later control', () => {
    const later = e4Commands(ctx({ threadOpen: true, snoozeOn: 'Kemal Atdayev' }))
      .find(c => c.id === 'thread.later')!
    expect(later.ready).toBe(true)
    expect(later.hint).toContain('Kemal Atdayev')
    // The date is the sheet's, and the write is Conversation.tsx's.
    expect(later.hint).toContain('nothing is written from here')
  })
})

describe('peopleFromThreads — the context line is the row’s own two facts', () => {
  it('prints lane · stage, in the words the filter tokens use', () => {
    const [p] = peopleFromThreads(threads([{}]))
    expect(p.id).toBe('p1')
    expect(p.name).toBe('Kemal Atdayev')
    expect(p.sub).toBe('Rise · Replied')
  })

  it('keeps the company out of the verb and in the searchable text', () => {
    const [p] = peopleFromThreads(threads([{}]))
    expect(p.search).toBe('Northbeam')
    expect(e4Commands(ctx({ people: [p] })).find(c => c.id === 'person.p1')!.title)
      .toBe('Open Kemal Atdayev')
  })

  it('a stage this app has not been taught prints the lane alone, not a guess', () => {
    const [p] = peopleFromThreads(threads([{ prospect_stage: 'lunar_orbit' }]))
    expect(p.sub).toBe('Rise')
  })

  it('a row with no company searches on nothing rather than on an empty guess', () => {
    const [p] = peopleFromThreads(threads([{ prospect_company: null }]))
    expect(p.search).toBe('')
  })
})
