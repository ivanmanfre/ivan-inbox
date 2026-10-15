// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { BrainDraftBadge } from './BrainDraftBadge'
import { brainDraftSource } from '../../lib/brainDraft'
afterEach(cleanup)
const draft = { taxonomy: { source: 'content-brain', brain_brief: { source_url: 'https://www.linkedin.com/posts/fixture', source_ref: 'outlier:linkedin:fixture', why_this_post: 'Uses the source shape with recorded client facts.', pattern: { dimension: 'hook', value: 'receipt', n: 45, study_id: 'fixture' } } }, source_ref: null }
it('shows stored source, reason and supported pattern denominator', () => {
 render(<BrainDraftBadge draft={draft} />)
 expect(screen.getByRole('link', { name: 'Original post ↗' }).getAttribute('href')).toBe(draft.taxonomy.brain_brief.source_url)
 expect(screen.getByText(/Uses the source shape/)).toBeTruthy()
 expect(screen.getByText('hook: receipt · n=45')).toBeTruthy()
})
it('does not fabricate missing evidence or link unsafe URLs or show unsupported small cells', () => {
 const row = { ...draft, taxonomy: { ...draft.taxonomy, brain_brief: { ...draft.taxonomy.brain_brief, source_url: 'javascript:alert(1)', pattern: { ...draft.taxonomy.brain_brief.pattern, n: 24 } } } }
 expect(brainDraftSource(row)).toMatchObject({ sourceUrl: null, pattern: null })
 render(<BrainDraftBadge draft={row} />)
 expect(screen.queryByRole('link')).toBeNull()
 // nothing recorded, nothing said
 expect(screen.queryByText(/n=24/)).toBeNull()
 expect(screen.getByLabelText('Content brain source').querySelectorAll('p')).toHaveLength(1)
})
it('leaves ordinary draft source treatment intact', () => {
 render(<BrainDraftBadge draft={{ taxonomy: { source: 'call' }, source_ref: null }} />)
 expect(screen.queryByLabelText('Content brain source')).toBeNull()
})

it('identifies membership even when taxonomy metadata was erased, with truthful unavailable evidence', () => {
 render(<BrainDraftBadge draft={{ taxonomy: null, source_ref: null, cb34_p2_member: true }} />)
 expect(screen.getByText('Brain')).toBeTruthy()
 expect(screen.getByText('Reason not recorded.')).toBeTruthy()
})

it('names the original outlier author in the draft window without using the target writer', () => {
 render(<BrainDraftBadge draft={{ taxonomy: JSON.stringify({ source: 'content-brain', brain_brief: { slot: 'winner', author: 'Ivan', source_author: 'davegerhardt', source_ref: 'outlier:linkedin:7510681708631875584', source_url: 'https://www.linkedin.com/posts/davegerhardt_original', why_this_post: 'Adapts the source.' } }), source_ref: null }} />)
 expect(screen.getByText('Repurposed outlier')).toBeTruthy()
 expect(screen.getByText('From Dave Gerhardt')).toBeTruthy()
 expect(screen.queryByText('From Ivan')).toBeNull()
 expect(screen.getByRole('link', { name: 'Original post ↗' }).getAttribute('href')).toBe('https://www.linkedin.com/posts/davegerhardt_original')
})
it('shows an honest missing-author message for an outlier with no recorded author', () => {
 render(<BrainDraftBadge draft={{ taxonomy: { source: 'content-brain', brain_brief: { slot: 'winner', author: 'Ivan', source_ref: 'outlier:linkedin:123' } }, source_ref: null }} />)
 expect(screen.getByText('Author not recorded')).toBeTruthy()
})
