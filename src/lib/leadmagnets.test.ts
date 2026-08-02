import { describe, expect, it } from 'vitest'
import {
  groupByLmStage, isStuckGeneratingLm, LM_PIPELINE_STAGES, normalizeLmStatus, stageOfLm,
  type Resource,
} from './styles'
import {
  elapsedMinutes, generatingSince, ideaKindOf, isStuckGenerating, splitIdeas,
  STUCK_GENERATING_MINUTES,
  type ContentDraft, type IdeaCandidate,
} from './content'

// The phase-6 additions, pinned by tests rather than by clicking. Every case
// below is a rule that produced a wrong NUMBER on the shipped surface, not a
// styling preference.

const res = (o: Partial<Resource>): Resource => ({
  id: 'r', topic: null, format: null, status: 'idea', resource_url: null,
  landing_url: null, cover_url: null, landing_slug: null,
  updated_at: new Date().toISOString(), ...o,
})

const draft = (o: Partial<ContentDraft>): ContentDraft => ({
  id: 'd', client_id: null, status: 'generating', type: null, title: null, topic: null,
  post_body: null, scheduled_at: null, source_post_id: null, image_urls: null,
  taxonomy: null, updated_at: new Date().toISOString(), created_at: '2026-01-01T00:00:00Z',
  ...o,
})

describe('normalizeLmStatus — the legacy fold', () => {
  // 🔴 37 of 127 live rows sit at `pending` (count=exact, 2026-08-02). Unfolded,
  // the largest group in the table renders as a phantom status in no pipeline.
  it('folds every alias the old dashboard folds', () => {
    expect(normalizeLmStatus('pending')).toBe('idea')
    expect(normalizeLmStatus('draft')).toBe('idea')
    expect(normalizeLmStatus('complete')).toBe('published')
    expect(normalizeLmStatus('ready')).toBe('published')
    expect(normalizeLmStatus('lm_review')).toBe('review')
    expect(normalizeLmStatus('generating_content')).toBe('generating')
  })

  it('leaves a canonical status alone', () => {
    for (const s of LM_PIPELINE_STAGES) expect(normalizeLmStatus(s)).toBe(s)
  })

  // The fold is not allowed to grow by accident: `live` is a real live value and
  // is NOT in the old alias table, so it must survive as itself and land in
  // `other` rather than being quietly called published.
  it('does not invent an alias for `live`', () => {
    expect(normalizeLmStatus('live')).toBe('live')
    expect(stageOfLm(res({ status: 'live' }))).toBe('other')
  })

  it('treats a blank status as idea, never as a stage of its own', () => {
    expect(normalizeLmStatus(null)).toBe('idea')
    expect(normalizeLmStatus('   ')).toBe('idea')
  })
})

describe('stageOfLm / groupByLmStage', () => {
  it('routes a folded legacy value to the canonical stage', () => {
    expect(stageOfLm(res({ status: 'pending' }))).toBe('idea')
    expect(stageOfLm(res({ status: 'lm_review' }))).toBe('review')
    expect(stageOfLm(res({ status: 'complete' }))).toBe('published')
  })

  it('keeps generating_assets separate from generating', () => {
    expect(stageOfLm(res({ status: 'generating' }))).toBe('generating')
    expect(stageOfLm(res({ status: 'generating_assets' }))).toBe('generating_assets')
  })

  it('never drops a row it cannot classify', () => {
    const rows = [res({ id: 'a', status: 'live' }), res({ id: 'b', status: 'what_even' })]
    const g = groupByLmStage(rows)
    const total = Object.values(g).reduce((n, xs) => n + xs.length, 0)
    expect(total).toBe(2)
    expect(g.other.map(r => r.id)).toEqual(['a', 'b'])
  })
})

describe('stuck generation — the 20-minute threshold ported from genAge.ts', () => {
  const now = Date.parse('2026-08-02T12:00:00Z')
  const ago = (m: number) => new Date(now - m * 60_000).toISOString()

  it('is 20 minutes, the old dashboard\'s own constant', () => {
    expect(STUCK_GENERATING_MINUTES).toBe(20)
  })

  it('fires on a draft past the threshold and not before', () => {
    expect(isStuckGenerating(draft({ updated_at: ago(19) }), now)).toBe(false)
    expect(isStuckGenerating(draft({ updated_at: ago(21) }), now)).toBe(true)
  })

  // Only an in-flight row can stall. Asking it of a published row answers a
  // question nobody asked.
  it('never fires on a row that is not generating', () => {
    expect(isStuckGenerating(draft({ status: 'published', updated_at: ago(9999) }), now)).toBe(false)
    expect(isStuckGenerating(draft({ status: 'review', updated_at: ago(9999) }), now)).toBe(false)
  })

  it('prefers taxonomy.generating_started_at over updated_at', () => {
    // A rewrite bumps updated_at and would restart the clock; the real start is
    // in taxonomy where the generator writes it.
    const d = draft({ updated_at: ago(2), taxonomy: { generating_started_at: ago(90) } })
    expect(generatingSince(d)).toBe(ago(90))
    expect(isStuckGenerating(d, now)).toBe(true)
  })

  it('covers BOTH LM generating stages', () => {
    expect(isStuckGeneratingLm(res({ status: 'generating', updated_at: ago(45) }), now)).toBe(true)
    expect(isStuckGeneratingLm(res({ status: 'generating_assets', updated_at: ago(45) }), now)).toBe(true)
    expect(isStuckGeneratingLm(res({ status: 'review', updated_at: ago(45) }), now)).toBe(false)
  })

  // null, never 0: no timestamp is "unknown", and 0 would claim the run just
  // started.
  it('returns null rather than 0 when there is nothing to measure', () => {
    expect(elapsedMinutes(null, now)).toBe(null)
    expect(elapsedMinutes('not a date', now)).toBe(null)
  })
})

describe('idea split — the conflation fix', () => {
  const idea = (content_type: string | null, id = 'i'): IdeaCandidate =>
    ({ id, content_type } as IdeaCandidate)

  it('reads the real discriminator values', () => {
    expect(ideaKindOf(idea('post'))).toBe('post')
    expect(ideaKindOf(idea('lead_magnet'))).toBe('lead_magnet')
  })

  // 🔴 The reason this is a partition and not a `.eq('content_type', …)` filter:
  // under an equality filter a NULL row would match NEITHER lane and appear on
  // no surface at all. 235 rows in the table carry a NULL content_type.
  it('keeps an unclassified row instead of dropping it from both lanes', () => {
    const s = splitIdeas([idea('post', 'a'), idea('lead_magnet', 'b'), idea(null, 'c'), idea('', 'd')])
    expect(s.post.map(i => i.id)).toEqual(['a'])
    expect(s.lead_magnet.map(i => i.id)).toEqual(['b'])
    expect(s.other.map(i => i.id)).toEqual(['c', 'd'])
    expect(s.post.length + s.lead_magnet.length + s.other.length).toBe(4)
  })

  it('is case- and whitespace-tolerant about the stored value', () => {
    expect(ideaKindOf(idea(' Post '))).toBe('post')
    expect(ideaKindOf(idea('LEAD_MAGNET'))).toBe('lead_magnet')
  })
})
