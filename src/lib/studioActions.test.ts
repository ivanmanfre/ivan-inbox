import { describe, it, expect } from 'vitest'
import { canRetryLane, isHumanEdited, planRegen, regenWouldReplaceImage } from './studioActions'
import type { ContentDraft } from './content'

const base: ContentDraft = {
  id: 'd1', client_id: null, status: 'review', type: 'text', title: 'T', topic: 'Top',
  post_body: 'body', scheduled_at: null, source_post_id: null, image_urls: null,
  taxonomy: {}, updated_at: '2026-08-01T00:00:00Z', created_at: '2026-08-01T00:00:00Z',
}

describe('isHumanEdited — and the bare-string taxonomy shape', () => {
  it('reads the flag db/025 actually guards on', () => {
    expect(isHumanEdited({ taxonomy: { human_edited: 'true' } })).toBe(true)
    expect(isHumanEdited({ taxonomy: { human_edited: 'false' } })).toBe(false)
    expect(isHumanEdited({ taxonomy: {} })).toBe(false)
    expect(isHumanEdited({ taxonomy: null })).toBe(false)
  })
  it('survives taxonomy arriving as a bare STRING (both shapes are live)', () => {
    expect(isHumanEdited({ taxonomy: 'story_opener' })).toBe(false)
    expect(() => isHumanEdited({ taxonomy: 'x' })).not.toThrow()
  })
})

describe('planRegen — the format is read off the row, never assumed', () => {
  it('maps every type to its own post_format', () => {
    expect(planRegen({ ...base, type: 'carousel' }).postFormat).toBe('Carousel')
    expect(planRegen({ ...base, type: 'single_image' }).postFormat).toBe('Single Image')
    expect(planRegen({ ...base, type: 'text' }).postFormat).toBe('Text Post')
    expect(planRegen({ ...base, type: null }).postFormat).toBe('Text Post')
  })

  it('DEFAULTS TO COPY-ONLY so a hand-pinned photo survives a regen', () => {
    const pinned = { ...base, type: 'single_image', image_urls: ['https://x/y.png'] }
    const p = planRegen(pinned)
    expect(p.includeImage).toBe('No')
    expect(p.keepsPinnedImage).toBe(true)
    expect(regenWouldReplaceImage(pinned, false)).toBe(false)
  })

  it('only replaces the image when Ivan explicitly asks for a new one', () => {
    const pinned = { ...base, type: 'single_image', image_urls: ['https://x/y.png'] }
    const p = planRegen(pinned, true)
    expect(p.includeImage).toBe('Yes')
    expect(p.keepsPinnedImage).toBe(false)
    expect(regenWouldReplaceImage(pinned, true)).toBe(true)
  })

  it('a text post never asks for an image, even if told to', () => {
    expect(planRegen({ ...base, type: 'text' }, true).includeImage).toBe('No')
  })

  it('reports when db/025 will refuse the overwrite instead of firing blind', () => {
    expect(planRegen({ ...base, taxonomy: { human_edited: 'true' } }).blockedByGuard).toBe(true)
    expect(planRegen(base).blockedByGuard).toBe(false)
  })
})

describe('canRetryLane — a retry button only where a generator is listening', () => {
  // Ivan, 2026-08-24: "in the errors section there is no regen option, so I can
  // only delete it." The lane gate was `lane !== 'ivan'`, which refused the
  // client lanes outright rather than firing their own generator.
  it('allows Ivan and the lane whose generator is active', () => {
    expect(canRetryLane('ivan')).toBe(true)
    // CLIENT Rise DTC - Post Generation MAX (5WjbV0eks4d9Wyh5) is active and
    // reads body.draft_id straight into task_id, so it rewrites the row it is
    // given rather than creating one.
    expect(canRetryLane('risedtc')).toBe(true)
  })

  it('refuses a lane whose generator is born-dead', () => {
    // 🔴 CLIENT ARCH. Influencer Agency - Post Generation exists on the same
    // shape and is INACTIVE. A Retry there would flip the row to `generating`
    // with nothing listening — a silent stall, worse than no button. The lane's
    // absence from CLIENT_GEN is the enforcement; there is no disabled state to
    // forget to render.
    expect(canRetryLane('arch')).toBe(false)
  })
})
