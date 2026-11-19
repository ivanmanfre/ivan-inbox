// Made-up data only (the repo is public).
import { assertEquals } from 'jsr:@std/assert@1'
import { draftCards, normQuote, quotedSpans } from './cards.ts'
import type { Draft } from './brief.ts'

const d = (id: string, first_line: string, extra: Partial<Draft> = {}): Draft => ({
  id, status: 'review', type: 'text', scheduled_at: null, published_at: null, first_line, title: '', belief: null, vehicle: null, recipe: null,
  qa_verdict: 'PASS', is_copy: false, photos: 0, brain: false, human_edited: false, slot_kind: null, selling: false, chars: 100, created_at: '2026-11-10T10:00:00Z', fixture: null, ...extra,
})
const pool = new Map<string, Draft>([
  ['#a1', d('id-1', 'Snow in the park this morning and nobody was in a hurry.')],
  ['#b2', d('id-2', 'The tram at rush hour is the best market research I do.', { status: 'scheduled', scheduled_at: '2027-03-16T09:45:00Z' })],
  ['#c3', d('id-3', 'The tram to the old town was empty today.')],
  ['#d4', d('id-4', 'Creators who doubled their reach did one thing.', { status: 'published', published_at: '2026-11-17T14:34:00Z' })],
])

Deno.test('cards: a quoted opener names its one draft; order kept, no repeats', () => {
  const c = draftCards('- "Snow in the park this..." (no date)\n- "Creators who doubled their reach" did well\n- "Snow in the park" again', pool)
  assertEquals(c.map((x) => x.id), ['id-1', 'id-4'])
  assertEquals(c[1].scheduled_at, '2026-11-17T14:34:00Z')   // a published post shows its publish time
  assertEquals(c[0].first_line, 'Snow in the park this morning and nobody was in a hurry.')   // the draft's own line, never the quote
})

Deno.test('cards: an ambiguous or short quote gets no card', () => {
  assertEquals(draftCards('"The tram" is next', pool), [])            // two drafts start with it
  assertEquals(draftCards('"The tram at rush hour" goes Tuesday', pool).map((x) => x.id), ['id-2'])
  assertEquals(draftCards('say "today" or "ok"', pool), [])
  assertEquals(draftCards('no quotes at all about the tram', pool), [])
})

Deno.test('cards: curly quotes, apostrophes and a mid-line quote of 5+ words', () => {
  assertEquals(draftCards('“Snow in the park this morning”', pool).map((x) => x.id), ['id-1'])
  assertEquals(draftCards('"best market research I do" is the line', pool).map((x) => x.id), ['id-2'])
  assertEquals(normQuote('It’s  done…'), "it's done")
  assertEquals(quotedSpans('"a b c d" and “e f g h”'), ['a b c d', 'e f g h'])
})

Deno.test('cards: whole words only, unless the quote is cut with an ellipsis', () => {
  const one = new Map<string, Draft>([['#s1', d('id-s', 'Tools for skincare that nobody talks about.')]])
  assertEquals(draftCards('"Tools for ski" is it', one), [])
  assertEquals(draftCards('"Tools for ski..." is it', one).map((x) => x.id), ['id-s'])
  assertEquals(draftCards('"Tools for skincare" is it', one).map((x) => x.id), ['id-s'])
})

Deno.test('cards: at most six', () => {
  const many = new Map<string, Draft>(Array.from({ length: 9 }, (_, i) => [`#h${i}`, d(`id-${i}`, `Post number ${'abcdefghi'[i]} about something real`)]))
  const reply = Array.from({ length: 9 }, (_, i) => `"Post number ${'abcdefghi'[i]} about"`).join('\n')
  assertEquals(draftCards(reply, many).length, 6)
})
