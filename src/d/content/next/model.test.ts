import { describe, expect, it } from 'vitest'
import { nextPostOf, type NextPost } from '../../../lib/contentNext'
import { parseDHash } from '../../route'
import { NOTE_LARGE, NOTE_READING, NOTE_SYNC, anyHeld, hookOf, keepKeyOf, nextLanding, nextRows, slotWords, statusOf } from './model'

const post = (o: Partial<NextPost> = {}): NextPost => ({
  queue_id: 'q1', draft_id: 'd1', slot_at: '2026-11-16T13:00:00Z', state: 'ready', origin: 'autopilot', kept: false, fails: [],
  post_text: 'Hook line.\n\nBody.', post_format: 'text', in_sync: true, urls: [], media_urls: [], ...o,
})
const OK = { status: 'ok' as const, files: [] }

describe('nextRows', () => {
  it('is empty with no upcoming post', () => { expect(nextRows([])).toEqual([]) })
  it('shows the soonest post as Next whatever its state, then every later held post', () => {
    const rows = nextRows([
      post({ queue_id: 'c', slot_at: '2026-11-20T17:30:00Z', state: 'held' }),
      post({ queue_id: 'a', slot_at: '2026-11-16T13:00:00Z', origin: 'own' }),
      post({ queue_id: 'b', slot_at: '2026-11-17T14:30:00Z' }),
      post({ queue_id: 'd', slot_at: '2026-11-23T12:00:00Z', state: 'checking' }),
      post({ queue_id: 'e', slot_at: '2026-11-25T12:00:00Z', state: 'held' }),
    ])
    expect(rows.map(r => [r.post.queue_id, r.tag])).toEqual([['a', 'Next'], ['c', 'Held'], ['e', 'Held']])
  })
  it('a held post that is next is one row, tagged Next', () => {
    expect(nextRows([post({ state: 'held' })]).map(r => r.tag)).toEqual(['Next'])
  })
  it('anyHeld reads every upcoming post', () => {
    expect(anyHeld([post(), post({ state: 'checking' })])).toBe(false)
    expect(anyHeld([post(), post({ state: 'held' })])).toBe(true)
  })
})

describe('status line', () => {
  it('says the Warsaw day and time (13:00 UTC is 14:00 in Warsaw in November)', () => {
    expect(slotWords('2026-11-16T13:00:00Z')).toBe('Mon 16 Nov at 14:00')
  })
  it('ready, by who placed it and whether he kept it', () => {
    expect(statusOf(post({ origin: 'own' })).text).toBe('Goes out Mon 16 Nov at 14:00. You placed it.')
    expect(statusOf(post()).text).toBe('Goes out Mon 16 Nov at 14:00. Checked by the autopilot.')
    expect(statusOf(post({ kept: true })).text).toBe('Goes out Mon 16 Nov at 14:00. You kept it.')
  })
  it('checking and held', () => {
    expect(statusOf(post({ state: 'checking' }))).toEqual({ tone: 'wait', text: 'Being re-checked. Nothing to do.' })
    expect(statusOf(post({ state: 'held', fails: ['animated GIF needs a full-frame review'] }))).toEqual({
      tone: 'held', text: 'Will not go out as it stands.', reason: 'The loop needs your look. The automatic check only sees its first frame.' })
  })
})

describe('Keep key', () => {
  it('is only for autopilot posts he has not kept, and not while the check runs', () => {
    expect(keepKeyOf(post({ origin: 'own' }), OK)).toEqual({ show: false })
    expect(keepKeyOf(post({ origin: 'own', state: 'held' }), OK)).toEqual({ show: false })
    expect(keepKeyOf(post({ kept: true }), OK)).toEqual({ show: false })
    expect(keepKeyOf(post({ state: 'checking' }), OK)).toEqual({ show: false })
  })
  it('is the main key on a held post and a quiet one on a ready post', () => {
    expect(keepKeyOf(post({ state: 'held' }), OK)).toEqual({ show: true, primary: true, enabled: true, note: null })
    expect(keepKeyOf(post(), OK)).toEqual({ show: true, primary: false, enabled: true, note: null })
  })
  it('waits, with a short note, while the queue catches up or the files cannot be checked', () => {
    expect(keepKeyOf(post({ state: 'held', in_sync: false }), OK)).toEqual({ show: true, primary: true, enabled: false, note: NOTE_SYNC })
    expect(keepKeyOf(post({ urls: ['u'] }), { status: 'too_large' })).toMatchObject({ enabled: false, note: NOTE_LARGE })
    expect(keepKeyOf(post({ urls: ['u'] }), { status: 'failed' })).toMatchObject({ enabled: false, note: NOTE_LARGE })
    expect(keepKeyOf(post({ urls: ['u'] }), null)).toMatchObject({ enabled: false, note: NOTE_READING })
    expect(NOTE_SYNC).toBe('The queue is catching up. Try in a minute.')
    expect(NOTE_LARGE).toBe('Too large to check here.')
  })
})

describe('row read', () => {
  it('reads a row and treats anything but an explicit true as not in step', () => {
    const raw = { queue_id: 'q', draft_id: 'd', slot_at: '2026-11-16T13:00:00Z', state: 'held', origin: 'autopilot', kept: false, fails: ['x', 3], post_text: 'T', post_format: 'text', body_sha256: 'ab', urls: ['u', ''] }
    expect(nextPostOf(raw)).toEqual({ queue_id: 'q', draft_id: 'd', slot_at: '2026-11-16T13:00:00Z', state: 'held', origin: 'autopilot', kept: false, fails: ['x'], post_text: 'T', post_format: 'text', in_sync: false, urls: ['u'], media_urls: ['u'] })
    expect(nextPostOf({ ...raw, in_sync: true, origin: 'own' })).toMatchObject({ in_sync: true, origin: 'own' })
  })
  it('drops a row it cannot stand behind', () => {
    expect(nextPostOf(null)).toBeNull()
    expect(nextPostOf({ queue_id: 'q', draft_id: 'd', slot_at: 'soon', state: 'ready' })).toBeNull()
    expect(nextPostOf({ queue_id: 'q', draft_id: 'd', slot_at: '2026-11-16T13:00:00Z', state: 'published' })).toBeNull()
  })
  it('the hook is the first line with text', () => {
    expect(hookOf('\n\n  First line.  \nSecond.')).toBe('First line.')
    expect(hookOf('')).toBe('')
  })
})

describe('landing', () => {
  const landing = parseDHash('#exp/d/content'), review = parseDHash('#exp/d/content/now'), pushed = parseDHash('#exp/d/content/today')
  it('lands on Review while a post is held, after its read arrives', () => {
    expect(nextLanding(landing, null, false, false)).toBe('wait')
    expect(nextLanding(landing, null, true, true)).toBe('held')
    expect(nextLanding(landing, null, true, false)).toBeNull()
  })
  it("today's waiting card keeps its own landing", () => {
    expect(nextLanding(landing, 'card', true, true)).toBeNull()
    expect(nextLanding(landing, 'wait', true, true)).toBeNull()
  })
  it('only the landing moves: a sub-page or the card address stays', () => {
    expect(nextLanding(review, null, true, true)).toBeNull()
    expect(nextLanding(pushed, null, true, true)).toBeNull()
    expect(nextLanding(parseDHash('#exp/d/content?lane=arch'), null, true, true)).toBeNull()
  })
})
