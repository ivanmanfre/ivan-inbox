import { describe, expect, it, beforeEach } from 'vitest'
import { BODY_CAP, buildInboxCache, keepWhole, orderForCache, projectThread, readInboxCache, writeInboxCache, INBOX_QUERY } from './inboxCache'
import { swrKey } from './swr'
import { searchThreads } from './inbox'
import type { InboxMessage, Thread } from './inbox'
import { dmsEmptyKind } from '../wb/dms/InboxList'

class MemStore {
  map = new Map<string, string>()
  get length() { return this.map.size }
  key(i: number) { return [...this.map.keys()][i] ?? null }
  getItem(k: string) { return this.map.get(k) ?? null }
  setItem(k: string, v: string) { this.map.set(k, v) }
  removeItem(k: string) { this.map.delete(k) }
}

const USER = 'uid-ivan'
let store: MemStore
beforeEach(() => {
  store = new MemStore()
  ;(globalThis as unknown as { localStorage: MemStore }).localStorage = store
  store.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', JSON.stringify({ user: { id: USER } }))
})

function msg(over: Partial<InboxMessage> = {}): InboxMessage {
  return {
    id: 'm1', prospect_id: 'p1', direction: 'inbound', message_text: 'hello',
    message_type: null, channel: 'linkedin', sent_at: null, approved_at: null,
    read_at: null, created_at: '2026-09-08T10:00:00Z', send_blocked_at: null,
    send_blocked_reason: null, unipile_chat_id: null, ai_model: null,
    prospect_name: 'Dom', prospect_company: null, prospect_headline: null,
    prospect_stage: 'replied', prospect_email: null, profile_photo_url: null,
    prospect_linkedin_url: null, chat_provider_id: null, campaign_name: 'c',
    client_id: 'ivan', snoozed_until: null, snoozed_at: null, ...over,
  }
}

// An ORDINARY row by default: the last word is ours, so nothing on the screen
// counts it. Work rows are built explicitly in the tests that want one.
function thread(id: string, over: Partial<Thread> = {}): Thread {
  // An inbound they sent, and our answer after it: a real conversation
  // (isConversation) that owes nobody a reply (threadBucket 'waiting').
  const inb = msg({ id: `i-${id}`, prospect_id: id, prospect_name: id, created_at: '2026-09-07T10:00:00Z', read_at: '2026-09-07T11:00:00Z' })
  const m = msg({ id: `m-${id}`, prospect_id: id, prospect_name: id, direction: 'outbound', created_at: '2026-09-08T10:00:00Z', sent_at: '2026-09-08T10:00:00Z' })
  return {
    prospect_id: id, prospect_name: id, prospect_company: null, client_id: 'ivan',
    channel: 'linkedin', stage: 'replied', linkedin_url: null, chat_provider_id: null,
    last: m, unread: 0, draft: null, messages: [inb, m], spam: false,
    companionDraft: null, ownerConfirmation: null, draftStale: false,
    draftSnoozedUntil: null, needsManualReply: false, ...over,
  }
}

describe('the budget', () => {
  it('keeps every row a count on the screen is about to state', () => {
    const work = thread('draft', { draft: msg({ id: 'd', approved_at: null }) })
    const spam = thread('spam', { spam: true })
    const pushed = thread('pushed', { draftSnoozedUntil: '2026-09-20T10:00:00Z' })
    const filler = Array.from({ length: 40 }, (_, i) => thread(`f${i}`))
    // A budget too small for even one ordinary row still keeps all three work rows.
    const c = buildInboxCache([...filler, work, spam, pushed], 1)
    expect(c.threads.map(t => t.prospect_id).sort()).toEqual(['draft', 'pushed', 'spam'])
    expect(c.total).toBe(43)
  })
  it('fills the rest with the newest ordinary rows and stops at the budget', () => {
    const rows = Array.from({ length: 30 }, (_, i) => {
      const day = String(i + 1).padStart(2, '0')
      const t = thread(`f${i}`)
      const inb = { ...t.messages[0], created_at: `2026-08-${day}T09:00:00Z`, read_at: `2026-08-${day}T09:30:00Z` }
      const out = { ...t.last, created_at: `2026-08-${day}T10:00:00Z`, sent_at: `2026-08-${day}T10:00:00Z` }
      return { ...t, last: out, messages: [inb, out] }
    })
    // The premise of the test, asserted rather than assumed: none of these is a
    // row a count reads, so all 30 are droppable.
    expect(rows.filter(keepWhole).length).toBe(0)
    expect(orderForCache(rows)[0].last.sent_at).toBe('2026-08-30T10:00:00Z')
    const c = buildInboxCache(rows, 3000)
    expect(c.threads.length).toBeGreaterThan(0)
    expect(c.threads.length).toBeLessThan(30)
    // Newest first, so the fold is the part that survives.
    expect(c.threads[0].last.sent_at).toBe('2026-08-30T10:00:00Z')
  })
  it('states the counts from the FULL list, never from what it kept', () => {
    const rows = Array.from({ length: 30 }, (_, i) => thread(`f${i}`, { spam: true }))
    const c = buildInboxCache(rows, 1)
    expect(c.spam).toBe(30)
    expect(c.total).toBe(30)
  })
})

describe('the projection', () => {
  it('drops the drafter evidence blob and keeps everything the row draws', () => {
    const t = thread('a', { messages: [msg({ draft_evidence: { note: 'huge' } as never })] })
    const p = projectThread(t)
    expect('draft_evidence' in p.messages[0]).toBe(false)
    expect(p.messages[0].message_text).toBe('hello')
    expect(p.prospect_name).toBe('a')
  })
  it('counts the chips from the SAME array the rows come from', () => {
    const c = buildInboxCache([thread('a'), thread('b', { spam: true })])
    expect(c.threads.length).toBe(2)
    expect(c.spam).toBe(1)
  })
})

describe('the write-from-reconciled rule', () => {
  it('a later write with a row removed does not leave the row behind', () => {
    writeInboxCache([thread('a'), thread('b')])
    expect(readInboxCache()?.cache.threads.map(t => t.prospect_id)).toEqual(['a', 'b'])
    // What useInbox does after the app removes a row locally: it writes the
    // array on screen, not the response it came from.
    writeInboxCache([thread('a')])
    expect(readInboxCache()?.cache.threads.map(t => t.prospect_id)).toEqual(['a'])
  })
  it('stores a body with the capability link taken out, and keeps the rest', () => {
    // N3b-4. This used to refuse the WHOLE payload, so one scan link in one
    // message froze the cache for good. The token is what may not be stored;
    // the words around it are what the list draws.
    const t = thread('a', { messages: [msg({ message_text: 'here it is https://x.dev/scan?k=tok have a look' })] })
    expect(writeInboxCache([t])).toBe('written')
    const body = readInboxCache()?.cache.threads[0].messages[0].message_text ?? ''
    expect(body).toContain('here it is')
    expect(body).toContain('have a look')
    expect(body).not.toContain('k=tok')
  })
  it('drops a body whose token is not inside a URL at all', () => {
    const t = thread('a', { messages: [msg({ message_text: 'the approve_url field is broken' })] })
    expect(writeInboxCache([t])).toBe('written')
    expect(readInboxCache()?.cache.threads[0].messages[0].message_text)
      .toBe('[hidden from the saved copy]')
  })
})

describe('N3b-5, the body cap', () => {
  const long = 'x'.repeat(900)
  it('clips a received body to the cap and marks the clip', () => {
    const t = thread('a', { messages: [msg({ message_text: long })] })
    const p = projectThread(t)
    expect(p.messages[0].message_text.length).toBe(BODY_CAP)
    expect(p.messages[0].message_text.endsWith('…')).toBe(true)
  })
  it('never clips a PENDING DRAFT, because approving one sends the text it holds', () => {
    const draft = msg({ id: 'd', direction: 'outbound', sent_at: null, approved_at: null, message_text: long })
    const t = thread('a', { draft, messages: [draft] })
    const p = projectThread(t)
    expect(p.draft?.message_text.length).toBe(900)
    expect(p.messages[0].message_text.length).toBe(900)
  })
  it('search still finds a thread by a word in its preview', () => {
    const t = thread('a', { messages: [msg({ message_text: `we run outreach for supplement brands. ${long}` })] })
    const cached = buildInboxCache([t]).threads
    expect(searchThreads(cached, 'supplement').length).toBe(1)
  })
})

describe('a stored shape that cannot be trusted whole is a miss', () => {
  it('refuses an entry with a row missing its last message', () => {
    store.setItem(swrKey(USER, INBOX_QUERY), JSON.stringify({
      savedAt: '2026-09-08T10:00:00Z', user: USER,
      payload: { threads: [{ prospect_id: 'a' }], waiting: 1, spam: 0 },
    }))
    expect(readInboxCache()).toBeNull()
  })
  it('reads nothing for a different account on the same device', () => {
    writeInboxCache([thread('a')])
    store.setItem('sb-bjbvqvzbzczjbatgmccb-auth-token', JSON.stringify({ user: { id: 'uid-other' } }))
    expect(readInboxCache()).toBeNull()
  })
})

describe('a cache-only paint is never a verified read', () => {
  it('dmsEmptyKind still says loading when the host has no live stamp', () => {
    // The host passes `verifiedAt={loadedAt}`, and loadedAt is stamped ONLY by a
    // fetch that resolved. A seeded paint therefore cannot reach the honest-empty
    // copy even when the cached list is itself empty.
    expect(dmsEmptyKind(0, '', null)).toBe('loading')
    expect(dmsEmptyKind(0, '', '2026-09-08T10:00:00Z')).toBe('verified')
  })
})
