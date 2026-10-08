import { describe, expect, it } from 'vitest'
import { bodyKey, buildCalendarItems, itemDayISO, queueDraftId, queueOnlyItems } from '../../lib/calendarItems'
import type { ContentDraft, ScheduledQueueRow } from '../../lib/content'
import { warsawDay } from '../ui/time'
import { seatItems, type PlanItem } from './planModel'
import type { Lane } from './model'

// PERF-SMOOTH (2026-10-08): seatItems was rewritten to compute each key once. This is the
// pre-rewrite body, verbatim, as the reference the new one must match item for item.
function seatItemsReference(rows: ContentDraft[], lane: Lane, queue: ScheduledQueueRow[] | null, now: number): PlanItem[] {
  const items = buildCalendarItems(rows, lane === 'ivan' ? queue ?? [] : [], now)
    .map(it => {
      const draft = it.source === 'draft' ? rows.find(r => r.id === it.id) : null
      const posted = lane === 'ivan' && it.stage === 'published' ? (queue ?? []).filter(q => q.status === 'posted' && !!q.unipile_share_url) : []
      const exact = posted.find(q => it.source === 'queue' ? q.id === it.id : queueDraftId(q) === it.id)
      const bodyMatches = draft && bodyKey(draft.post_body) ? posted.filter(q => bodyKey(q.post_text) === bodyKey(draft.post_body)) : []
      const q = exact ?? (bodyMatches.length === 1 ? bodyMatches[0] : null)
      const postedAt = q?.posted_at && Number.isFinite(Date.parse(q.posted_at)) ? q.posted_at : it.postedAt
      return { ...it, lane, postedAt, day: warsawDay(itemDayISO(it.at, postedAt)), unpublishId: q?.id ?? null, postedUrl: q?.unipile_share_url ?? null }
    })
  if (lane === 'ivan') {
    const represented = new Set(items.map(it => it.unpublishId).filter(Boolean))
    for (const q of queue ?? []) {
      if (q.status !== 'posted' || !q.unipile_share_url || represented.has(q.id)) continue
      const presentation = !q.scheduled_at && q.posted_at && Number.isFinite(Date.parse(q.posted_at)) ? { ...q, scheduled_at: q.posted_at } : q
      for (const it of queueOnlyItems([], [presentation], now)) {
        items.push({ ...it, lane, day: warsawDay(itemDayISO(it.at, it.postedAt)), unpublishId: q.id, postedUrl: q.unipile_share_url })
        represented.add(q.id)
      }
    }
  }
  return items
}

const NOW = Date.parse('2026-10-08T12:00:00Z')
const uuid = (n: number) => `${n.toString(16).padStart(8, '0')}-0000-4000-8000-${n.toString(16).padStart(12, '0')}`

// A small deterministic generator, so a failure replays.
function rng(seed: number) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32) }

function world(seed: number) {
  const r = rng(seed)
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)]
  const bodies = ['Hook one\n\nbody', 'Hook  one body', 'Second post\ttext', '', 'Third\n post', 'Fourth', null]
  const statuses = ['scheduled', 'published', 'review', 'approved', 'disqualified', 'posting']
  const day = (k: number) => new Date(NOW + Math.round((r() - 0.6) * 40) * 86_400_000 + k * 60_000).toISOString()
  const rows: ContentDraft[] = []
  for (let i = 0; i < 60; i++) {
    const status = pick(statuses)
    const sched = r() < 0.8 ? day(i) : null
    rows.push({
      id: r() < 0.05 && i > 0 ? rows[i - 1].id : uuid(i + 1), client_id: pick([null, 'ivan', 'risedtc']), status, type: pick(['text', 'carousel']), title: `t${i}`, topic: null,
      post_body: pick(bodies), scheduled_at: sched, published_at: status === 'published' && sched ? sched : null,
      created_at: day(0), updated_at: day(0), image_urls: null, taxonomy: null, board_visible: pick([null, true, false]),
    } as unknown as ContentDraft)
  }
  const queue: ScheduledQueueRow[] = []
  for (let i = 0; i < 40; i++) {
    const posted = r() < 0.6
    queue.push({
      id: `q${i}`, clickup_task_id: r() < 0.5 ? pick(rows).id : r() < 0.5 ? 'clickup-123' : null, post_text: pick(bodies),
      scheduled_at: r() < 0.85 ? day(i) : null, posted_at: posted ? day(i) : null, status: posted ? 'posted' : pick(['pending', 'cancelled', 'failed']),
      platform: 'linkedin', is_repost: null, error_message: null, created_at: day(0), post_kind: null, unipile_share_url: posted && r() < 0.8 ? `https://x/${i}` : null,
    } as unknown as ScheduledQueueRow)
  }
  return { rows, queue }
}

describe('seatItems (PERF-SMOOTH rewrite)', () => {
  it('matches the pre-rewrite answer on 200 generated seats, every lane, with and without a queue', () => {
    let linked = 0
    for (let seed = 1; seed <= 200; seed++) {
      const { rows, queue } = world(seed)
      for (const lane of ['ivan', 'risedtc', 'arch'] as Lane[]) {
        const got = seatItems(rows, lane, queue, NOW)
        linked += got.filter(i => i.source === 'draft' && i.unpublishId).length
        expect(got).toEqual(seatItemsReference(rows, lane, queue, NOW))
        expect(seatItems(rows, lane, null, NOW)).toEqual(seatItemsReference(rows, lane, null, NOW))
      }
    }
    // The generator really exercises the published-draft join (id link and body match).
    expect(linked).toBeGreaterThan(50)
  })
})

describe('bodyKey (PERF-SMOOTH memo)', () => {
  it('answers exactly the whitespace-normalised body, first call and every call after, past the cap too', () => {
    const plain = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim()
    const inputs = [null, undefined, '', '  ', 'a', ' a\n\nb\t c ', 'x'.repeat(5000) + '\n y']
    for (let round = 0; round < 3; round++) for (const s of inputs) expect(bodyKey(s)).toBe(plain(s))
    for (let i = 0; i < 7000; i++) expect(bodyKey(`b ${i}\n`)).toBe(`b ${i}`)
    for (const s of inputs) expect(bodyKey(s)).toBe(plain(s))
  })
})
