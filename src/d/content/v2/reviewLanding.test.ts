import { describe, expect, it } from 'vitest'
import type { ContentDraft } from '../../../lib/content'
import { reviewLanding } from './reviewLanding'
const row = (id: string, client_id: string | null, source_ref: string | null, created_at: string) => ({ id, client_id, source_ref, created_at, status: 'review', published_at: null, board_visible: false } as ContentDraft)
describe('Ideas → Review landing', () => {
  const rows = [row('exact','risedtc','idea:abc','2026-10-01'),row('new','risedtc',null,'2026-10-08'),row('other','arch','abc','2026-10-09')]
  it('selects the exact source draft in the requested seat ahead of a newer draft', () => expect(reviewLanding(rows,'risedtc','abc')).toBe('exact'))
  it('falls back to the newest review draft in that seat and never crosses a seat', () => { expect(reviewLanding(rows,'risedtc','missing')).toBe('new');expect(reviewLanding(rows,'ivan','abc')).toBeNull() })
  it('ignores published drafts', () => expect(reviewLanding([{ ...rows[0], published_at: '2026-10-08' },rows[1]],'risedtc','abc')).toBe('new'))
})
