// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { cleanup, screen } from '@testing-library/react'
import { renderInFrame } from '../test-utils'
import { RepeatEngagersBody } from './RepeatEngagers'
afterEach(cleanup)
it('names the returning person and real engaged posts without outreach controls', () => {
 renderInFrame(<RepeatEngagersBody lane="risedtc" error={null} onRetry={() => {}} data={{ client: 'risedtc', state: 'ready', reason: null, returned: 1, nextAfterPerson: null, sendCapable: false, limitation: 'Fixture evidence', rows: [{ personKey: 'person-fixture', name: 'Fixture person', profileUrl: 'https://www.linkedin.com/in/fixture', engagedPosts: 2, totalEvents: 3, firstSeen: '2026-09-20', lastSeen: '2026-09-30', confirmedReturn: true, postsComplete: false, returnTiming: 'Fixture observed', relationshipState: 'no_tracked_conversation', relationshipBasis: 'Fixture current relationship proof', posts: [{ postId: 'post-fixture', platform: 'linkedin', url: 'https://www.linkedin.com/feed/update/fixture', publishedAt: null }] }] }} />)
 expect(screen.getByRole('link', { name: 'Fixture person ↗' })).toBeTruthy()
 expect(screen.getByRole('link', { name: 'Open engaged post ↗' })).toBeTruthy()
 expect(screen.queryByRole('button', { name: /send|contact|draft/i })).toBeNull()
 expect(screen.getByText(/No conversation is recorded in this client’s CRM or message history/)).toBeTruthy()
 expect(screen.getByText('This covers recorded conversations; activity outside these records may be missing.')).toBeTruthy()
 expect(screen.getByText('Fixture current relationship proof').closest('details')?.hasAttribute('open')).toBe(false)
 expect(screen.getByText('The stored post list is incomplete.')).toBeTruthy()
})
it('unsupported client evidence never becomes an empty eligible population', () => {
 renderInFrame(<RepeatEngagersBody lane="ivan" error={null} onRetry={() => {}} data={{ client: 'ivan', state: 'source_unavailable', reason: 'verified_repeat_activation_source_supports_RISE_only', returned: 0, nextAfterPerson: null, sendCapable: false, limitation: 'Uncaptured history is not proved absent.', rows: [] }} />)
 expect(screen.getByText(/The verified repeat-engager source covers RISE/)).toBeTruthy()
 expect(screen.queryByText(/No eligible repeat engagers/)).toBeNull()
})
it('shows errors as errors instead of an empty engager list', () => {
 renderInFrame(<RepeatEngagersBody lane="ivan" data={null} error="Fixture network failed" onRetry={() => {}} />)
 expect(screen.getByText('Fixture network failed')).toBeTruthy()
 expect(screen.queryByText(/No eligible repeat engagers/)).toBeNull()
})
it('never renders a different client person or unsafe link', () => {
 renderInFrame(<RepeatEngagersBody lane="risedtc" error={null} onRetry={() => {}} data={{ client: 'ivan', state: 'source_unavailable', reason: 'Fixture unavailable', returned: 0, nextAfterPerson: null, sendCapable: false, limitation: 'Fixture evidence', rows: [] }} />)
 expect(screen.getByText('The engager list returned a different client.')).toBeTruthy()
})

it('does not turn unknown relationship evidence into a no-conversation claim and deduplicates technical basis', () => {
 const person = { personKey: 'unknown', name: 'Unknown evidence', profileUrl: null, engagedPosts: 2, totalEvents: 2, firstSeen: '2026-09-20', lastSeen: '2026-09-30', confirmedReturn: false, postsComplete: true, returnTiming: 'unconfirmed', relationshipState: 'relationship_unknown', relationshipBasis: 'Shared technical basis', posts: [] }
 renderInFrame(<RepeatEngagersBody lane="risedtc" error={null} onRetry={() => {}} data={{ client: 'risedtc', state: 'ready', reason: null, returned: 2, nextAfterPerson: null, sendCapable: false, limitation: 'Source caveat', rows: [person, { ...person, personKey: 'other', name: 'Other unknown evidence' }] }} />)
 expect(screen.queryByText(/No conversation is recorded/)).toBeNull()
 expect(screen.getAllByText(/Relationship evidence: relationship unknown/)).toHaveLength(2)
 expect(screen.getAllByText('Shared technical basis')).toHaveLength(1)
 expect(screen.getByText('Shared technical basis').closest('details')).toBeTruthy()
})
