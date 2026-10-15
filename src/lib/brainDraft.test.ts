import { expect, it } from 'vitest'
import { brainDraftSource } from './brainDraft'

it('uses the verified display name for the recorded original LinkedIn handle', () => {
 expect(brainDraftSource({ taxonomy: { source: 'content-brain', brain_brief: { slot: 'winner', source_url: 'https://www.linkedin.com/posts/davegerhardt_original' } }, source_ref: 'outlier:linkedin:7510681708631875584' })).toMatchObject({ isOutlier: true, sourceAuthor: 'Dave Gerhardt' })
})
it('does not mistake a pattern example or own winner URL for an outlier', () => {
 expect(brainDraftSource({ taxonomy: { source: 'content-brain', brain_brief: { slot: 'pattern', source_url: 'https://www.linkedin.com/posts/someone_example' } }, source_ref: 'pattern:hook:claim' }).isOutlier).toBe(false)
 expect(brainDraftSource({ taxonomy: { source: 'content-brain', brain_brief: { slot: 'winner', source_url: 'https://www.linkedin.com/posts/ivan_original' } }, source_ref: null }).isOutlier).toBe(false)
})
it('only extracts handles from supported original-post URLs on the actual platform host', () => {
 for (const source_url of ['https://www.linkedin.com.evil.test/posts/someone_original', 'https://www.linkedin.com/feed/update/urn:li:activity:123', 'https://x.com/home']) {
  expect(brainDraftSource({ taxonomy: { brain_brief: { source_url } }, source_ref: 'outlier:linkedin:123' }).sourceAuthor).toBeNull()
 }
})

it('preserves other source handles without guessing a display name', () => {
 expect(brainDraftSource({ taxonomy: { brain_brief: { source_url: 'https://www.linkedin.com/posts/some-other-author_original' } }, source_ref: 'outlier:linkedin:123' }).sourceAuthor).toBe('some-other-author')
})
